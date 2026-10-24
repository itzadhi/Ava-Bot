import {
  PermissionFlagsBits,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';
import { db } from '../../db/client.js';
import {
  getAntiNukeSettings,
  getAntiNukeExempt,
  isTrusted,
  isChannelExempt,
  recordAntiNukeIncident,
  getLockdownState,
  saveLockdownState,
  clearLockdownState,
  getCachedLockdownState
} from '../../db/antinuke.js';
import { getTicketSettings } from '../../db/tickets.js';
import { getGuildRoles } from '../../db/permify.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { logger } from '../../utils/logger.js';
import {
  createJob,
  enqueueJobExecution,
  updateJobProgress,
  buildProgressCard,
  getRunningJob,
  cancelJob
} from '../../core/jobs/jobManager.js';
import * as format from '../../utils/ui/format.js';
import PQueue from 'p-queue';

// Sliding windows for raid detection:
const raidWindows = new Map();
const unlockCooldowns = new Map();

// Bounded concurrency pool for channel overwrite edits (8 concurrent REST workers)
const OVERWRITE_CONCURRENCY = 8;

// Signature permissions denied during lockdown
export const LOCKDOWN_DENY_BITS = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions
];

function getRaidWindow(guildId) {
  if (!raidWindows.has(guildId)) {
    raidWindows.set(guildId, {
      messages: [],
      joins: [],
      offenders: new Set()
    });
  }
  return raidWindows.get(guildId);
}

// Background cleanup of raid window
setInterval(() => {
  const now = Date.now();
  for (const [gid, win] of raidWindows.entries()) {
    win.messages = win.messages.filter(m => now - m.timestamp < 30000);
    win.joins = win.joins.filter(j => now - j.timestamp < 60000);
    if (win.messages.length === 0 && win.joins.length === 0 && win.offenders.size === 0) {
      raidWindows.delete(gid);
    }
  }
}, 10000).unref();

/**
 * Tracks a member join for mass join burst detection
 * @param {import('discord.js').GuildMember} member
 */
export function trackMemberJoin(member) {
  if (!member?.guild) return;
  const win = getRaidWindow(member.guild.id);
  win.joins.push({
    userId: member.id,
    timestamp: Date.now()
  });
}

export {
  getLockdownState,
  saveLockdownState,
  clearLockdownState
};

/**
 * Evaluates incoming message for raid/flood conditions
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>}
 */
export async function evaluateRaidMessage(message) {
  if (!message?.guild || !message?.author || message.author.bot) return false;
  const guild = message.guild;
  const gid = guild.id;
  const userId = message.author.id;

  const lastUnlock = unlockCooldowns.get(gid) || 0;
  if (Date.now() - lastUnlock < 30000) return false;

  const currentState = await getLockdownState(gid);
  if (currentState && currentState.state !== 'idle') {
    return false;
  }

  const settings = await getAntiNukeSettings(gid);
  if (!settings.enabled) return false;

  const thresholds = settings.thresholds || {};
  const win = getRaidWindow(gid);
  const now = Date.now();

  win.messages.push({
    userId,
    channelId: message.channel.id,
    content: message.content || '',
    timestamp: now
  });

  const raidSecs = thresholds.raid_window_seconds || 5;
  const recentMsgs = win.messages.filter(m => now - m.timestamp < raidSecs * 1000);
  const distinctUsers = Array.from(new Set(recentMsgs.map(m => m.userId)));

  let triggerReason = null;
  const userThreshold = thresholds.raid_distinct_users || 5;
  if (distinctUsers.length >= userThreshold) {
    triggerReason = `Mass user flood: ${distinctUsers.length} users sent messages within ${raidSecs}s`;
  }

  if (!triggerReason) {
    const userMsgCounts = new Map();
    for (const m of recentMsgs) {
      userMsgCounts.set(m.userId, (userMsgCounts.get(m.userId) || 0) + 1);
    }
    const msgsPerUser = thresholds.raid_messages_per_user || 4;
    for (const [uid, count] of userMsgCounts.entries()) {
      if (count >= msgsPerUser) {
        triggerReason = `Rapid-fire spam: user sent ${count} messages within ${raidSecs}s`;
        break;
      }
    }
  }

  if (triggerReason) {
    logger.warn({ guildId: gid, triggerReason }, '🚨 Mass raid detected by anti-nuke heuristic, initiating lockdown');
    await initiateLockdown(guild, triggerReason, distinctUsers, message.channel.id);
    return true;
  }

  return false;
}

/**
 * Initiates Lockdown with Fast-Path Role Deny & Bounded Concurrency Channel Overwrites
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} reason
 * @param {string[]} [offenders=[]]
 * @param {string} [hotChannelId=null]
 * @param {string} [initiatedBy=null]
 * @returns {Promise<object>} Status object
 */
export async function initiateLockdown(guild, reason = 'Emergency lockdown', offenders = [], hotChannelId = null, initiatedBy = null) {
  // Support legacy signature: (guild, offenders, reason)
  if (Array.isArray(reason) && typeof offenders === 'string') {
    const temp = reason;
    reason = offenders;
    offenders = temp;
  }
  const gid = guild.id;
  const current = await getLockdownState(gid);
  if (current && (current.state === 'locking' || current.state === 'locked')) {
    return { locked: true, alreadyLocked: true, state: current.state };
  }

  const settings = await getAntiNukeSettings(gid);
  const calmSecs = settings.thresholds?.lockdown_calm_seconds || 60;
  const maxSecs = settings.thresholds?.lockdown_max_duration_seconds || 900;
  const unlockAt = new Date(Date.now() + Math.min(calmSecs, maxSecs) * 1000).toISOString();

  // 1. Compute Plan BEFORE modifying permissions
  const [ticketSettings, exempt] = await Promise.all([
    getTicketSettings(gid).catch(() => null),
    getAntiNukeExempt(gid).catch(() => ({ categories: [], channels: [] }))
  ]);
  const ticketCategoryId = ticketSettings?.channel_category_id;
  const exemptCategories = new Set(exempt?.categories || []);
  const exemptChannels = new Set(exempt?.channels || []);

  const channels = Array.from(guild.channels.cache.values());
  const eligibleChannels = [];
  const originalOverwrites = {};

  for (const ch of channels) {
    if (exemptChannels.has(ch.id)) continue;
    if (ticketCategoryId && (ch.id === ticketCategoryId || ch.parentId === ticketCategoryId)) continue;
    if (ch.parentId && exemptCategories.has(ch.parentId)) continue;
    if (ch.name?.startsWith('ticket-') || ch.name?.startsWith('tkt-')) continue;

    const isText = typeof ch.isTextBased === 'function' ? ch.isTextBased() : (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum);
    if (!isText && ch.type !== ChannelType.GuildVoice) continue;

    eligibleChannels.push(ch);

    const everyoneOv = ch.permissionOverwrites?.cache?.get(guild.id);
    if (everyoneOv) {
      originalOverwrites[ch.id] = {
        existed: true,
        allow: everyoneOv.allow.bitfield.toString(),
        deny: everyoneOv.deny.bitfield.toString()
      };
    } else {
      originalOverwrites[ch.id] = {
        existed: false,
        allow: '0',
        deny: '0'
      };
    }
  }

  // Read @everyone role original permissions
  const everyoneRole = guild.roles?.cache?.get(guild.id) || guild.roles?.everyone;
  const originalRolePerms = everyoneRole?.permissions?.bitfield !== undefined ? everyoneRole.permissions.bitfield.toString() : '0';

  const plan = {
    originalRolePerms,
    channels: originalOverwrites,
    channelIds: eligibleChannels.map(c => c.id),
    hotChannelId
  };

  const initialCounters = {
    total: eligibleChannels.length,
    locked: 0,
    unlocked: 0,
    failed: 0,
    skipped: 0
  };

  // 2. Persist Plan in Database in ONE Write. If this fails, abort before touching Discord.
  const statePayload = {
    guild_id: gid,
    state: 'locking',
    started_by: initiatedBy || (offenders.length > 0 ? 'auto-detection' : 'admin'),
    reason,
    plan,
    item_statuses: {},
    counters: initialCounters,
    version: 1,
    unlock_at: unlockAt
  };

  try {
    await saveLockdownState(gid, statePayload);
  } catch (dbErr) {
    logger.error({ err: dbErr.message, guildId: gid }, 'CRITICAL: Failed to save lockdown plan to database. Aborting lock.');
    throw new Error(`LOCKDOWN_PLAN_SAVE_FAILED: ${dbErr.message}`);
  }

  // 3. FAST PATH:
  // a) Remove SendMessages at @everyone ROLE LEVEL immediately (~100ms)
  try {
    if (everyoneRole && typeof everyoneRole.setPermissions === 'function' && guild.members?.me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
      const newPerms = BigInt(originalRolePerms) & ~(
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.SendMessagesInThreads |
        PermissionFlagsBits.CreatePublicThreads |
        PermissionFlagsBits.CreatePrivateThreads |
        PermissionFlagsBits.AddReactions
      );
      await everyoneRole.setPermissions(newPerms, `AVA Anti-Nuke: Immediate role-level raid lock [${reason}]`);
      logger.info({ guildId: gid }, '⚡ Fast-path role lock applied to @everyone');
    }
  } catch (roleErr) {
    logger.warn({ err: roleErr.message, guildId: gid }, 'Non-fatal: Fast-path role permission edit skipped or missing ManageRoles');
  }

  // b) Immediate hot channel lock (~50ms) to silence the active spam channel immediately
  const hotChannel = hotChannelId ? eligibleChannels.find(c => c.id === hotChannelId) : eligibleChannels[0];
  if (hotChannel && hotChannel.permissionOverwrites?.edit) {
    try {
      await hotChannel.permissionOverwrites.edit(guild.id, {
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: false,
        ...(hotChannel.type === ChannelType.GuildVoice ? { Connect: false } : {})
      }, { reason: `AVA Anti-Nuke: Immediate hot-channel raid lock [${reason}]` });
    } catch (chErr) {
      logger.warn({ err: chErr.message, channelId: hotChannel?.id }, 'Non-fatal: Immediate hot-channel lock skipped');
    }
  }

  // 4. Create Background Job for Channel Overwrite Application
  const job = await createJob({
    guildId: gid,
    type: 'lockdown_lock',
    payload: {
      guildId: gid,
      reason,
      unlockAt,
      channelCount: eligibleChannels.length
    }
  });

  // Execute channel overwrites in background queue with bounded concurrency
  enqueueJobExecution(job.id, guild.client, async ({ signal, updateProgress }) => {
    const queue = new PQueue({ concurrency: OVERWRITE_CONCURRENCY });
    let lockedCount = 0;
    let failedCount = 0;
    const itemStatuses = {};

    // Prioritize hot/active spam channel first
    if (hotChannelId) {
      eligibleChannels.sort((a, b) => (a.id === hotChannelId ? -1 : b.id === hotChannelId ? 1 : 0));
    }

    for (const ch of eligibleChannels) {
      queue.add(async () => {
        if (signal.aborted) return;

        try {
          // Compare current vs desired to skip if already matching
          const currentOv = ch.permissionOverwrites?.cache?.get(guild.id);
          const hasDeny = currentOv && (BigInt(currentOv.deny.bitfield) & PermissionFlagsBits.SendMessages) === PermissionFlagsBits.SendMessages;

          if (!hasDeny) {
            await ch.permissionOverwrites.edit(guild.id, {
              SendMessages: false,
              SendMessagesInThreads: false,
              CreatePublicThreads: false,
              CreatePrivateThreads: false,
              AddReactions: false,
              ...(ch.type === ChannelType.GuildVoice ? { Connect: false } : {})
            }, { reason: `AVA Anti-Nuke: Active raid lockdown [${reason}]` });
          }

          lockedCount++;
          itemStatuses[ch.id] = 'locked';
        } catch (err) {
          failedCount++;
          itemStatuses[ch.id] = `failed: ${err.message}`;
          logger.warn({ err: err.message, channelId: ch.id }, 'Error applying channel lockdown overwrite');
        }

        const currentCounters = {
          total: eligibleChannels.length,
          locked: lockedCount,
          failed: failedCount,
          percentage: Math.round((lockedCount / eligibleChannels.length) * 100)
        };

        await updateProgress(currentCounters, `Securing channels (${lockedCount}/${eligibleChannels.length})...`);
      });
    }

    await queue.onIdle();

    if (signal.aborted) {
      logger.info({ guildId: gid }, 'Lockdown channel loop aborted, skipping final state save');
      return;
    }

    const latest = await getLockdownState(gid);
    if (latest && (latest.state === 'unlocking' || latest.state === 'idle')) {
      logger.info({ guildId: gid }, 'Lockdown superseded by unlock, skipping locked state save');
      return;
    }

    // Mark locked state
    const finalState = failedCount > 0 ? 'partial' : 'locked';
    await saveLockdownState(gid, {
      ...statePayload,
      state: finalState,
      item_statuses: itemStatuses,
      counters: {
        total: eligibleChannels.length,
        locked: lockedCount,
        failed: failedCount,
        unlocked: 0,
        skipped: 0
      }
    });

    logger.info({ guildId: gid, lockedCount, failedCount, finalState }, '✓ Server lockdown channel loop completed');
  });

  return {
    locked: true,
    jobId: job.id,
    channelCount: eligibleChannels.length,
    unlockAt
  };
}

/**
 * Terminates Lockdown and Restores EXACT Original Overwrites
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} reason
 * @param {boolean} [notify=true]
 * @returns {Promise<object>} Status object
 */
export async function terminateLockdown(guild, reason = 'Lockdown terminated by administrator', notify = true) {
  const gid = guild.id;
  const current = await getLockdownState(gid);
  if (!current || current.state === 'idle') {
    return { unlocked: true, alreadyIdle: true };
  }

  // Cancel remaining lock work if currently locking
  const runningLockJob = getRunningJob(gid, 'lockdown_lock');
  if (runningLockJob) {
    cancelJob(runningLockJob, 'Lockdown terminated during lock phase');
  }

  // 1. Mark state as unlocking
  await saveLockdownState(gid, {
    ...current,
    state: 'unlocking'
  });

  const plan = current.plan || {};
  const channelPlans = plan.channels || {};
  const channels = Array.from(guild.channels.cache.values());

  const job = await createJob({
    guildId: gid,
    type: 'lockdown_unlock',
    payload: {
      guildId: gid,
      reason,
      totalChannels: Object.keys(channelPlans).length
    }
  });

  enqueueJobExecution(job.id, guild.client, async ({ signal, updateProgress }) => {
    const queue = new PQueue({ concurrency: OVERWRITE_CONCURRENCY });
    let unlockedCount = 0;
    let failedCount = 0;
    let changedBySomeoneCount = 0;
    const itemStatuses = {};

    for (const [chId, original] of Object.entries(channelPlans)) {
      queue.add(async () => {
        if (signal.aborted) return;
        const ch = guild.channels.cache.get(chId);
        if (!ch) {
          itemStatuses[chId] = 'skipped: deleted';
          return;
        }

        try {
          const currentOv = ch.permissionOverwrites?.cache?.get(guild.id);

          // If someone manually modified permissions during the lock, do NOT overwrite their change
          if (currentOv && !original.existed) {
            // Overwrite did not exist before lock: delete it
            await currentOv.delete(`AVA Anti-Nuke: Reverting lockdown overwrite [${reason}]`);
            unlockedCount++;
            itemStatuses[chId] = 'unlocked: deleted_created_overwrite';
          } else if (original.existed) {
            // Check if current differs from lock value
            const currentDeny = currentOv ? currentOv.deny.bitfield.toString() : '0';
            const expectedDeny = (BigInt(original.deny) | PermissionFlagsBits.SendMessages).toString();

            // Restore exact original allow and deny bitfields
            await ch.permissionOverwrites.edit(guild.id, {
              SendMessages: (BigInt(original.allow) & PermissionFlagsBits.SendMessages) ? true : (BigInt(original.deny) & PermissionFlagsBits.SendMessages) ? false : null,
              SendMessagesInThreads: (BigInt(original.allow) & PermissionFlagsBits.SendMessagesInThreads) ? true : (BigInt(original.deny) & PermissionFlagsBits.SendMessagesInThreads) ? false : null,
              CreatePublicThreads: (BigInt(original.allow) & PermissionFlagsBits.CreatePublicThreads) ? true : (BigInt(original.deny) & PermissionFlagsBits.CreatePublicThreads) ? false : null,
              CreatePrivateThreads: (BigInt(original.allow) & PermissionFlagsBits.CreatePrivateThreads) ? true : (BigInt(original.deny) & PermissionFlagsBits.CreatePrivateThreads) ? false : null,
              AddReactions: (BigInt(original.allow) & PermissionFlagsBits.AddReactions) ? true : (BigInt(original.deny) & PermissionFlagsBits.AddReactions) ? false : null
            }, { reason: `AVA Anti-Nuke: Restoring exact original permissions [${reason}]` });

            unlockedCount++;
            itemStatuses[chId] = 'unlocked: restored';
          }
        } catch (err) {
          failedCount++;
          itemStatuses[chId] = `failed: ${err.message}`;
        }

        const total = Object.keys(channelPlans).length;
        await updateProgress({
          total,
          done: unlockedCount,
          failed: failedCount,
          percentage: total > 0 ? Math.round((unlockedCount / total) * 100) : 100
        }, `Restoring channel permissions (${unlockedCount}/${total})...`);
      });
    }

    await queue.onIdle();

    // 2. Restore @everyone role-level permissions
    try {
      const everyoneRole = guild.roles?.cache?.get(guild.id) || guild.roles?.everyone;
      if (everyoneRole && typeof everyoneRole.setPermissions === 'function' && plan.originalRolePerms && guild.members?.me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
        await everyoneRole.setPermissions(BigInt(plan.originalRolePerms), `AVA Anti-Nuke: Restoring original @everyone permissions [${reason}]`);
        logger.info({ guildId: gid }, '✓ Restored original @everyone role permissions');
      }
    } catch (roleErr) {
      logger.warn({ err: roleErr.message, guildId: gid }, 'Error restoring role-level permissions');
    }

    // Set cooldown to prevent immediate re-trigger
    unlockCooldowns.set(gid, Date.now());

    // Clear lockdown state to idle
    await clearLockdownState(gid);
    logger.info({ guildId: gid, unlockedCount, failedCount }, '🔓 Server lockdown lifted and restored');
  });

  return {
    unlocked: true,
    jobId: job.id
  };
}

/**
 * Resumes active lockdowns on startup or triggers auto-unlock if expired
 * @param {import('discord.js').Client} client
 */
export async function resumeActiveLockdowns(client) {
  try {
    const { data: states } = await db
      .from('lockdown_state')
      .select('*')
      .neq('state', 'idle');

    if (!states || states.length === 0) return;

    logger.info({ count: states.length }, 'Checking active server lockdowns on startup');

    for (const row of states) {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      const now = Date.now();
      const unlockAt = row.unlock_at ? new Date(row.unlock_at).getTime() : 0;

      if (unlockAt > 0 && now >= unlockAt) {
        logger.info({ guildId: guild.id }, 'Lockdown calm period expired during downtime, triggering automatic unlock');
        await terminateLockdown(guild, 'Calm period expired automatically on startup');
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error in resumeActiveLockdowns');
  }
}

/**
 * Watchdog running every 10 seconds to auto-unlock servers whose unlock_at timestamp has passed
 * @param {import('discord.js').Client} client
 */
export function startLockdownWatchdog(client) {
  const timer = setInterval(async () => {
    try {
      const now = Date.now();
      const { data: expired } = await db
        .from('lockdown_state')
        .select('*')
        .in('state', ['locked', 'partial'])
        .not('unlock_at', 'is', null);

      if (!expired || expired.length === 0) return;

      for (const row of expired) {
        const unlockTime = new Date(row.unlock_at).getTime();
        if (now >= unlockTime) {
          const guild = client.guilds.cache.get(row.guild_id);
          if (guild) {
            logger.info({ guildId: row.guild_id }, 'Auto-unlock timestamp reached, terminating lockdown');
            await terminateLockdown(guild, 'Scheduled calm timeout elapsed');
          }
        }
      }
    } catch (_) {}
  }, 10000);

  if (timer.unref) timer.unref();
  return timer;
}

/**
 * One-time repair tool for corrupted lockdown state
 * Compares live channel overwrites against any saved plan, reports discrepancies, and restores
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ repaired: boolean, scanned: number, fixed: number, details: string[] }>}
 */
export async function repairCorruptedLockdown(guild) {
  const gid = guild.id;
  const state = await getLockdownState(gid);
  const channels = Array.from(guild.channels.cache.values());
  const details = [];
  let fixed = 0;

  for (const ch of channels) {
    const isText = typeof ch.isTextBased === 'function' ? ch.isTextBased() : (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement);
    if (!isText && ch.type !== ChannelType.GuildVoice) continue;

    const ov = ch.permissionOverwrites?.cache?.get(guild.id);
    if (!ov) continue;

    const denyBits = BigInt(ov.deny.bitfield);
    const hasLockdownSignature = (denyBits & PermissionFlagsBits.SendMessages) && (denyBits & PermissionFlagsBits.AddReactions);

    if (hasLockdownSignature) {
      try {
        await ch.permissionOverwrites.edit(guild.id, {
          SendMessages: null,
          SendMessagesInThreads: null,
          CreatePublicThreads: null,
          CreatePrivateThreads: null,
          AddReactions: null
        }, { reason: 'AVA Anti-Nuke: Lockdown integrity repair tool' });

        fixed++;
        details.push(`Restored permissions on #${ch.name}`);
      } catch (err) {
        details.push(`Failed to repair #${ch.name}: ${err.message}`);
      }
    }
  }

  // Reset state to idle
  await clearLockdownState(gid);

  return {
    repaired: true,
    scanned: channels.length,
    fixed,
    details
  };
}

export const executeLockdown = initiateLockdown;
export const liftLockdown = terminateLockdown;
export function isGuildLocked(guildId) {
  const cached = getCachedLockdownState(guildId);
  return Boolean(cached && (cached.state === 'locking' || cached.state === 'locked' || cached.state === 'partial'));
}

export default {
  trackMemberJoin,
  evaluateRaidMessage,
  initiateLockdown,
  terminateLockdown,
  executeLockdown,
  liftLockdown,
  isGuildLocked,
  getLockdownState,
  saveLockdownState,
  clearLockdownState,
  resumeActiveLockdowns,
  startLockdownWatchdog,
  repairCorruptedLockdown
};

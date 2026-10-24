import {
  PermissionFlagsBits,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';
import {
  getAntiNukeSettings,
  isTrusted,
  isChannelExempt,
  getLockdownState,
  saveLockdownState,
  clearLockdownState,
  recordAntiNukeIncident
} from '../../db/antinuke.js';
import { getGuildRoles } from '../../db/permify.js';
import { normalizeText } from '../automod/normalizer.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { logger } from '../../utils/logger.js';
import * as format from '../../utils/ui/format.js';

// Sliding windows for raid detection:
// Map<guildId, {
//   messages: Array<{ userId: string, channelId: string, content: string, timestamp: number }>,
//   joins: Array<{ userId: string, timestamp: number }>,
//   offenders: Set<string>
// }>
const raidWindows = new Map();

// Active lockdown timer handles: Map<guildId, NodeJS.Timeout>
const lockdownTimers = new Map();

// Post-unlock cooldown: Map<guildId, number timestamp>
const unlockCooldowns = new Map();

// Concurrency locks per guild
const lockdownGuildLocks = new Set();

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

/**
 * Periodically prunes expired raid messages and join records (runs every 10 seconds)
 */
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

/**
 * Evaluates incoming message for mass raid conditions
 * Returns true if lockdown triggered
 *
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>}
 */
export async function evaluateRaidMessage(message) {
  if (!message?.guild || !message?.author || message.author.bot) return false;
  const guild = message.guild;
  const gid = guild.id;
  const userId = message.author.id;

  // Check cooldown
  const lastUnlock = unlockCooldowns.get(gid) || 0;
  if (Date.now() - lastUnlock < 30000) return false; // 30s cooldown

  // Check active lockdown
  const activeState = await getLockdownState(gid);
  if (activeState?.active) {
    // If lockdown is active, register message as potential offender
    if (!await isTrusted(guild, userId, message.member)) {
      activeState.offenders = Array.from(new Set([...(activeState.offenders || []), userId]));
      await saveLockdownState(gid, activeState);
      message.delete().catch(() => {});
    }
    return true;
  }

  // Exemptions check
  if (await isChannelExempt(gid, message.channel.id, message.channel)) return false;
  if (await isTrusted(guild, userId, message.member)) return false;

  const permifyRoles = await getGuildRoles(gid).catch(() => ({ staff: [] }));
  if (message.member?.roles?.cache?.some(r => permifyRoles.staff?.includes(r.id))) return false;

  const settings = await getAntiNukeSettings(gid);
  if (!settings || settings.enabled === false) return false;

  const thresholds = settings.thresholds || {};
  const win = getRaidWindow(gid);
  const now = Date.now();

  const norm = normalizeText(message.content || '');
  win.messages.push({
    userId,
    channelId: message.channel.id,
    content: norm.collapsed,
    timestamp: now
  });

  const windowSecs = thresholds.raid_window_seconds || 5;
  const recentMsgs = win.messages.filter(m => now - m.timestamp < windowSecs * 1000);

  // 1. Condition: N distinct users each sending >= M messages within T seconds
  const userCounts = new Map();
  for (const m of recentMsgs) {
    userCounts.set(m.userId, (userCounts.get(m.userId) || 0) + 1);
  }

  const distinctUsers = Array.from(userCounts.keys());
  const activeSpammers = distinctUsers.filter(uid => userCounts.get(uid) >= (thresholds.raid_messages_per_user || 4));
  const raidUserLimit = thresholds.raid_distinct_users || 5;

  let triggerReason = null;

  if (activeSpammers.length >= raidUserLimit) {
    triggerReason = `Mass user flood: ${activeSpammers.length} distinct users sending rapid messages in ${windowSecs}s`;
  }

  // 2. Condition: Same normalized content from >= X distinct users in T seconds
  if (!triggerReason) {
    const contentUsers = new Map();
    for (const m of recentMsgs) {
      if (m.content.length > 5) {
        if (!contentUsers.has(m.content)) contentUsers.set(m.content, new Set());
        contentUsers.get(m.content).add(m.userId);
      }
    }
    const matchLimit = thresholds.raid_identical_content_users || 3;
    for (const [content, uids] of contentUsers.entries()) {
      if (uids.size >= matchLimit) {
        triggerReason = `Coordinated spam wave: ${uids.size} users repeating identical message content`;
        break;
      }
    }
  }

  // 3. Condition: Mass join burst combined with spam
  if (!triggerReason) {
    const joinWindowSecs = thresholds.raid_join_window_seconds || 10;
    const recentJoins = win.joins.filter(j => now - j.timestamp < joinWindowSecs * 1000);
    const joinLimit = thresholds.raid_join_burst_count || 8;
    if (recentJoins.length >= joinLimit && recentMsgs.length >= 10 && distinctUsers.length >= 3) {
      triggerReason = `Raid wave detected: ${recentJoins.length} accounts joined within ${joinWindowSecs}s with active chat spam`;
    }
  }

  if (triggerReason) {
    const offendersList = Array.from(new Set([...distinctUsers, ...activeSpammers]));
    await initiateLockdown(guild, triggerReason, offendersList, message.channel.id);
    return true;
  }

  return false;
}

/**
 * Initiates Emergency Server Lockdown
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} reason
 * @param {string[]} [offenders=[]]
 * @param {string} [hotChannelId=null]
 */
export async function initiateLockdown(guild, reason = 'Mass raid spam detected', offenders = [], hotChannelId = null) {
  if (Array.isArray(reason) && typeof offenders === 'string') {
    const tmp = reason;
    reason = offenders;
    offenders = tmp;
  }
  const gid = guild.id;
  if (lockdownGuildLocks.has(gid)) return { locked: true, alreadyLocked: true };
  lockdownGuildLocks.add(gid);

  try {
    const settings = await getAntiNukeSettings(gid);
    const calmSecs = settings.thresholds?.lockdown_calm_seconds || 60;
    const maxSecs = settings.thresholds?.lockdown_max_duration_seconds || 900; // 15m default

    const startTime = Date.now();
    const calmUntil = new Date(startTime + calmSecs * 1000).toISOString();
    const maxUntil = new Date(startTime + maxSecs * 1000).toISOString();

    logger.warn({ guildId: gid, reason, offenderCount: offenders.length }, '🚨 INITIATING SERVER LOCKDOWN');

    // 1. Post Alert Card in alert channel with staff role mention
    const alertChanId = settings.alert_channel_id || settings.log_channel_id;
    let alertMsg = null;

    if (alertChanId) {
      const alertChan = guild.channels.cache.get(alertChanId);
      if (alertChan && alertChan.isTextBased?.()) {
        const pingRole = settings.ping_role_id ? `<@&${settings.ping_role_id}> ` : '';
        const alertContainer = new ContainerBuilder();
        const unixStart = Math.floor(startTime / 1000);

        const alertLines = [
          `## 🚨 EMERGENCY SERVER LOCKDOWN ACTIVATED`,
          `High-volume raid or coordinated spam detected <t:${unixStart}:R>.`,
          ``,
          `### Incident Diagnostics`,
          `- **Trigger Reason:** ${reason}`,
          `- **Identified Offenders:** \`${offenders.length}\` accounts`,
          `- **Calm Timeout:** \`${calmSecs}s\` without spam required to unlock`,
          `- **Maximum Safety Duration:** \`${Math.round(maxSecs / 60)} minutes\``,
          `- **Status:** **All public channels temporarily locked**`,
          ``,
          `*Staff may manage this incident using the buttons below.*`
        ];

        alertContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(alertLines.join('\n')));

        const controlRow = new ActionRowBuilder().addComponents(
          greyButton({
            id: `antinuke:unlock_now:${gid}:${guild.ownerId}:0`,
            label: 'Unlock Now',
            emoji: '🔓'
          }),
          greyButton({
            id: `antinuke:extend_lock:${gid}:${guild.ownerId}:0`,
            label: 'Extend (+10m)',
            emoji: '⏱️'
          }),
          greyButton({
            id: `antinuke:undo_bans:${gid}:${guild.ownerId}:0`,
            label: 'Undo Incident Bans',
            emoji: '↩️'
          })
        );

        alertMsg = await alertChan.send({
          content: pingRole || undefined,
          components: [alertContainer, controlRow],
          flags: MessageFlags.IsComponentsV2
        }).catch(() => null);
      }
    }

    // 2. Lock Channels: Save current overwrite state and apply deny permissions
    const savedOverwrites = {};
    const lockedChannels = [];
    const channels = Array.from(guild.channels.cache.values());

    // Sort channels so the hot/active spam channel is locked FIRST
    if (hotChannelId) {
      channels.sort((a, b) => (a.id === hotChannelId ? -1 : b.id === hotChannelId ? 1 : 0));
    }

    for (const ch of channels) {
      // Never touch exempt channels or ticket categories
      const isExempt = await isChannelExempt(gid, ch.id, ch);
      if (isExempt) continue;

      // Only lock text, forum, and voice channels
      const isText = typeof ch.isTextBased === 'function' ? ch.isTextBased() : (ch.type === ChannelType.GuildText || ch.type === ChannelType.GuildAnnouncement || ch.type === ChannelType.GuildForum);
      if (!isText && ch.type !== ChannelType.GuildVoice) continue;

      const everyoneOv = ch.permissionOverwrites?.cache?.get(guild.id);
      if (everyoneOv) {
        savedOverwrites[ch.id] = {
          allow: everyoneOv.allow.bitfield.toString(),
          deny: everyoneOv.deny.bitfield.toString()
        };
      }

      // Apply lockdown deny permissions
      try {
        await ch.permissionOverwrites.edit(guild.id, {
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          AddReactions: false,
          ...(ch.type === ChannelType.GuildVoice ? { Connect: false } : {})
        }, { reason: 'AVA Anti-Nuke: Active raid lockdown' });
        lockedChannels.push(ch.id);
      } catch (err) {
        logger.warn({ err, channelId: ch.id }, 'Error locking channel overwrites');
      }

      // Small throttle to avoid gateway rate limits
      await new Promise(r => setTimeout(r, 50));
    }

    // Optionally disable invites if method is available
    if (typeof guild.disableInvites === 'function') {
      await guild.disableInvites().catch(() => {});
    }

    // 3. Save lockdown state in Supabase for persistence across restarts
    const statePayload = {
      guild_id: gid,
      active: true,
      started_at: new Date(startTime).toISOString(),
      reason,
      locked_channels: lockedChannels,
      saved_overwrites: savedOverwrites,
      offenders,
      calm_until: calmUntil,
      max_until: maxUntil
    };
    await saveLockdownState(gid, statePayload);

    // 4. Identify and punish offenders
    const punishment = settings.lockdown_punishment || 'ban';
    const bannedUsers = [];
    const failedBans = [];

    for (const uid of offenders) {
      // Double-check immunity
      const immune = await isTrusted(guild, uid);
      if (immune) continue;

      try {
        if (!settings.dry_run) {
          if (punishment === 'ban') {
            await guild.bans.create(uid, {
              reason: `AVA Anti-Nuke: Raid participant (${reason})`,
              deleteMessageSeconds: 86400 // Purge up to 1 day of messages
            });
            bannedUsers.push(uid);
          } else if (punishment === 'kick') {
            const mem = await guild.members.fetch(uid).catch(() => null);
            if (mem?.kickable) await mem.kick('AVA Anti-Nuke: Raid participant');
            bannedUsers.push(uid);
          }
        } else {
          bannedUsers.push(uid);
        }
      } catch (err) {
        failedBans.push(`${uid}: ${err.message}`);
      }
    }

    // 5. Schedule Calm Timer & Max Duration Monitor
    scheduleLockdownMonitor(guild, calmSecs, maxSecs);

    return { locked: true, offenders, channelsLocked: Object.keys(savedOverwrites).length };
  } finally {
    lockdownGuildLocks.delete(gid);
  }
}

/**
 * Schedules monitoring loop for active lockdown
 */
function scheduleLockdownMonitor(guild, calmSecs = 60, maxSecs = 900) {
  const gid = guild.id;
  if (lockdownTimers.has(gid)) {
    clearInterval(lockdownTimers.get(gid));
  }

  const interval = setInterval(async () => {
    try {
      const state = await getLockdownState(gid);
      if (!state || !state.active) {
        clearInterval(interval);
        lockdownTimers.delete(gid);
        return;
      }

      const now = Date.now();
      const maxExpiry = state.max_until ? new Date(state.max_until).getTime() : 0;
      const calmExpiry = state.calm_until ? new Date(state.calm_until).getTime() : 0;

      // Unlock if max duration reached or calm period elapsed
      if ((maxExpiry && now >= maxExpiry) || (calmExpiry && now >= calmExpiry)) {
        clearInterval(interval);
        lockdownTimers.delete(gid);
        await terminateLockdown(guild, 'Calm period elapsed or maximum safety duration reached');
      }
    } catch (err) {
      logger.error({ err, guildId: gid }, 'Error during lockdown monitor check');
    }
  }, 10000).unref();

  lockdownTimers.set(gid, interval);
}

/**
 * Restores channel overwrites and lifts the server lockdown cleanly
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} [liftReason='Calm period elapsed']
 * @param {boolean} [manual=false]
 */
export async function terminateLockdown(guild, liftReason = 'Calm period elapsed', manual = false) {
  const gid = guild.id;
  if (lockdownTimers.has(gid)) {
    clearInterval(lockdownTimers.get(gid));
    lockdownTimers.delete(gid);
  }
  const state = await getLockdownState(gid);
  if (!state || !state.active) return { unlocked: false, alreadyUnlocked: true };

  logger.info({ guildId: gid, liftReason }, '🔓 Lifting server lockdown and restoring channel overwrites');

  const savedOverwrites = state.saved_overwrites || {};
  const channelIdsToUnlock = Array.isArray(state.locked_channels) && state.locked_channels.length > 0
    ? state.locked_channels
    : Object.keys(savedOverwrites);

  let unlockedCount = 0;

  for (const cid of channelIdsToUnlock) {
    const ch = guild.channels.cache.get(cid);
    if (ch) {
      try {
        const ov = savedOverwrites[cid];
        if (ov && ov.allow && ov.deny) {
          await ch.permissionOverwrites.edit(guild.id, {
            SendMessages: (BigInt(ov.deny) & PermissionFlagsBits.SendMessages) === 0n ? null : false,
            SendMessagesInThreads: (BigInt(ov.deny) & PermissionFlagsBits.SendMessagesInThreads) === 0n ? null : false,
            CreatePublicThreads: (BigInt(ov.deny) & PermissionFlagsBits.CreatePublicThreads) === 0n ? null : false,
            CreatePrivateThreads: (BigInt(ov.deny) & PermissionFlagsBits.CreatePrivateThreads) === 0n ? null : false,
            AddReactions: (BigInt(ov.deny) & PermissionFlagsBits.AddReactions) === 0n ? null : false,
            Connect: (BigInt(ov.deny) & PermissionFlagsBits.Connect) === 0n ? null : false
          }, { reason: `AVA Anti-Nuke: Lockdown lifted (${liftReason})` });
        } else {
          // Channel originally had NO @everyone overwrite! Delete the @everyone overwrite to restore default permissions!
          await ch.permissionOverwrites.delete(guild.id).catch(() => {});
        }
        unlockedCount++;
      } catch (err) {
        logger.warn({ err, channelId: cid }, 'Error restoring channel overwrite upon unlock');
      }
      await new Promise(r => setTimeout(r, 40));
    }
  }

  // Clear state in Supabase
  await clearLockdownState(gid);

  // Set cooldown
  unlockCooldowns.set(gid, Date.now());

  // Record incident
  await recordAntiNukeIncident(gid, 'raid_lockdown_lifted', 'system', {
    reason: liftReason,
    manual,
    unlockedChannels: unlockedCount,
    offenderCount: (state.offenders || []).length
  });

  // Post resolution report card
  const settings = await getAntiNukeSettings(gid);
  const alertChanId = settings.alert_channel_id || settings.log_channel_id;

  if (alertChanId) {
    const alertChan = guild.channels.cache.get(alertChanId);
    if (alertChan && alertChan.isTextBased?.()) {
      const startMs = state.started_at ? new Date(state.started_at).getTime() : Date.now();
      const durationSecs = Math.round((Date.now() - startMs) / 1000);
      const unixNow = Math.floor(Date.now() / 1000);

      const reportContainer = new ContainerBuilder();
      const reportLines = [
        `## 🛡️ Server Lockdown Concluded`,
        `The server has been unlocked and normal member permissions restored <t:${unixNow}:F>.`,
        ``,
        `### Operation Summary`,
        `- **Resolution Reason:** ${liftReason}`,
        `- **Total Duration:** \`${durationSecs}s\` (${Math.round(durationSecs / 60)}m)`,
        `- **Channels Restored:** \`${unlockedCount}\``,
        `- **Offenders Addressed:** \`${(state.offenders || []).length}\``,
        `- **Status:** 🟢 **All Channels Operational**`
      ];

      reportContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(reportLines.join('\n')));

      await alertChan.send({
        components: [reportContainer],
        flags: MessageFlags.IsComponentsV2
      }).catch(() => {});
    }
  }

  return { unlocked: true, reason: liftReason, unlockedChannels: unlockedCount };
}

/**
 * Resumes monitoring of any active lockdowns after bot process restart
 * @param {import('discord.js').Client} client
 */
export async function resumeActiveLockdowns(client) {
  if (!client?.guilds?.cache) return;

  for (const guild of client.guilds.cache.values()) {
    try {
      const state = await getLockdownState(guild.id);
      if (state && state.active) {
        logger.info({ guildId: guild.id }, 'Resuming active lockdown monitor after bot restart');
        scheduleLockdownMonitor(guild, 60, 900);
      }
    } catch (_) {}
  }
}

export function isGuildLocked(guildId) {
  return lockdownTimers.has(String(guildId));
}

export const executeLockdown = initiateLockdown;
export const liftLockdown = terminateLockdown;

export default {
  trackMemberJoin,
  evaluateRaidMessage,
  initiateLockdown,
  terminateLockdown,
  executeLockdown,
  liftLockdown,
  isGuildLocked,
  resumeActiveLockdowns
};

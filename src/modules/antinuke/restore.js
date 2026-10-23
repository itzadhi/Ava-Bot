import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import {
  getAntiNukeSettings,
  isTrusted,
  isChannelExempt,
  getChannelSnapshot,
  getChannelSnapshots,
  saveChannelSnapshot,
  deleteChannelSnapshot,
  recordAntiNukeIncident
} from '../../db/antinuke.js';
import { remapChannelIds } from './remap.js';
import { logger } from '../../utils/logger.js';
import * as format from '../../utils/ui/format.js';

// Sliding window cache for channel deletions:
// Map<`${guildId}:${executorId}`, Array<{ channelId: string, timestamp: number, channelData?: object }>>
const deletionSlidingWindows = new Map();

// Guild restore lock to prevent race conditions during bulk restore
const restoreGuildLocks = new Set();

// Debounce map for snapshot updates to batch writes
const snapshotDebounce = new Map();

/**
 * Debounced snapshot update for channelCreate and channelUpdate
 */
export function queueChannelSnapshot(guildId, channel) {
  if (!guildId || !channel?.id) return;
  const key = `${guildId}:${channel.id}`;

  if (snapshotDebounce.has(key)) {
    clearTimeout(snapshotDebounce.get(key));
  }

  const timer = setTimeout(async () => {
    snapshotDebounce.delete(key);
    try {
      await saveChannelSnapshot(guildId, channel);
    } catch (err) {
      logger.warn({ err, guildId, channelId: channel.id }, 'Error saving debounced channel snapshot');
    }
  }, 1000);

  snapshotDebounce.set(key, timer);
}

/**
 * Fetches the audit log entry for channel deletion with retry to handle Discord audit lag
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {number} [retries=2]
 * @returns {Promise<import('discord.js').GuildAuditLogsEntry|null>}
 */
async function fetchChannelDeleteAudit(guild, channelId, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const logs = await guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 5
      });
      const entry = logs.entries.find(e => e.targetId === channelId);
      if (entry) return entry;
    } catch (err) {
      logger.warn({ err, guildId: guild.id }, 'Error fetching audit logs for channel deletion');
    }

    if (attempt < retries) {
      await new Promise(r => setTimeout(r, 600));
    }
  }
  return null;
}

/**
 * Punishes an offending executor
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} executor
 * @param {string} action 'ban', 'kick', 'strip_roles', 'timeout'
 * @param {string} reason
 * @param {boolean} dryRun
 * @returns {Promise<string>}
 */
export async function punishOffender(guild, executor, action = 'ban', reason = 'Anti-Nuke violation', dryRun = false) {
  if (dryRun) {
    logger.info({ guildId: guild.id, executorId: executor.id, action }, '[DRY RUN] Would punish executor');
    return `[Dry Run] Would have applied: ${action.toUpperCase()}`;
  }

  const member = await guild.members?.fetch?.(executor.id)?.catch(() => null);
  if (!member) {
    return 'Executor not present in guild';
  }

  // Hierarchy check
  if (guild.members?.me && member.roles?.highest?.position >= guild.members.me.roles?.highest?.position) {
    logger.warn({ guildId: guild.id, executorId: executor.id }, 'Cannot punish executor: Member is higher in hierarchy than bot');
    return 'Failed: Executor role is higher than bot in role hierarchy';
  }

  try {
    if (action === 'ban') {
      if (member.bannable) {
        await guild.bans.create(executor.id, { reason, deleteMessageSeconds: 3600 });
        return 'Banned from server';
      }
      return 'Failed: Bot missing Ban Members permission';
    }

    if (action === 'kick') {
      if (member.kickable) {
        await member.kick(reason);
        return 'Kicked from server';
      }
      return 'Failed: Bot missing Kick Members permission';
    }

    if (action === 'timeout') {
      if (member.moderatable) {
        await member.timeout(24 * 60 * 60 * 1000, reason); // 24 hours
        return 'Timed out for 24 hours';
      }
      return 'Failed: Member not moderatable';
    }

    if (action === 'strip_roles') {
      const nonManagedRoles = member.roles.cache.filter(r => !r.managed && r.id !== guild.id);
      if (nonManagedRoles.size > 0) {
        await member.roles.set([], `Anti-Nuke Strip Roles: ${reason}`);
        return `Stripped ${nonManagedRoles.size} roles`;
      }
      return 'No non-managed roles to strip';
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId: executor.id }, 'Error punishing offender');
    return `Error: ${err.message}`;
  }

  return 'None';
}

/**
 * Restores a batch of channels sequentially preserving order, category parents, and overwrites
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array<object>} snapshots Array of saved channel snapshot data
 * @returns {Promise<{ restored: number, failed: number, idMap: Map<string, string>, errors: string[] }>}
 */
export async function restoreChannelBatch(guild, snapshots) {
  let restored = 0;
  let failed = 0;
  const errors = [];
  const idMap = new Map(); // oldId -> newId

  // Sort snapshots: Categories first so child channels can link to recreated categories!
  const categories = snapshots.filter(s => s.type === ChannelType.GuildCategory);
  const others = snapshots.filter(s => s.type !== ChannelType.GuildCategory);
  const ordered = [...categories, ...others];

  for (const snap of ordered) {
    try {
      // Re-map parent ID if parent was recreated in this batch
      const parentId = snap.parentId ? (idMap.get(snap.parentId) || snap.parentId) : null;

      // Filter and rebuild permission overwrites
      const overwrites = [];
      if (Array.isArray(snap.permissionOverwrites)) {
        for (const ov of snap.permissionOverwrites) {
          // Verify role or member exists in current guild
          const exists = ov.type === 0
            ? guild.roles.cache.has(ov.id)
            : guild.members.cache.has(ov.id);

          if (exists) {
            overwrites.push({
              id: ov.id,
              type: ov.type,
              allow: BigInt(ov.allow || '0'),
              deny: BigInt(ov.deny || '0')
            });
          }
        }
      }

      const createOptions = {
        name: snap.name,
        type: snap.type,
        topic: snap.topic || undefined,
        nsfw: Boolean(snap.nsfw),
        rateLimitPerUser: snap.rateLimitPerUser || 0,
        position: snap.position ?? undefined,
        parent: parentId || undefined,
        permissionOverwrites: overwrites,
        reason: 'Argoni Anti-Nuke: Automated emergency channel restoration'
      };

      if (snap.type === ChannelType.GuildVoice || snap.type === ChannelType.GuildStageVoice) {
        if (snap.bitrate) createOptions.bitrate = snap.bitrate;
        if (snap.userLimit) createOptions.userLimit = snap.userLimit;
        if (snap.rtcRegion) createOptions.rtcRegion = snap.rtcRegion;
      }

      const newChan = await guild.channels.create(createOptions);
      idMap.set(snap.id, newChan.id);

      // Save new channel snapshot into DB
      await saveChannelSnapshot(guild.id, newChan);
      // Remove old snapshot
      await deleteChannelSnapshot(guild.id, snap.id);

      restored++;

      // Small delay between creates to respect Discord rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      failed++;
      errors.push(`${snap.name}: ${err.message}`);
      logger.error({ err, guildId: guild.id, snapName: snap.name }, 'Failed to recreate channel during Anti-Nuke restore');
    }
  }

  return { restored, failed, idMap, errors };
}

/**
 * Handles incoming channelDelete event
 * @param {import('discord.js').DMChannel|import('discord.js').NonThreadGuildBasedChannel} channel
 */
export async function handleChannelDeleteEvent(channel) {
  if (!channel?.guild) return;
  const guild = channel.guild;
  const channelId = channel.id;

  try {
    const settings = await getAntiNukeSettings(guild.id);
    if (!settings || settings.enabled === false) return false;

    // Check if channel is exempt or in ticket category
    const isExempt = await isChannelExempt(guild.id, channelId, channel);
    if (isExempt) {
      logger.debug({ guildId: guild.id, channelId }, 'Channel is exempt from Anti-Nuke protection');
      return false;
    }

    // Fetch snapshot of deleted channel
    const snapshot = await getChannelSnapshot(guild.id, channelId);

    // Fetch audit log to identify executor
    const auditEntry = await fetchChannelDeleteAudit(guild, channelId);
    const executor = auditEntry?.executor;

    if (!executor) {
      logger.warn({ guildId: guild.id, channelId }, 'Could not identify executor for deleted channel');
      return false;
    }

    // Check if executor is immune (real owner, bot, trusted user/role, permify owner)
    const immune = await isTrusted(guild, executor.id);
    if (immune) {
      logger.debug({ guildId: guild.id, executorId: executor.id }, 'Channel deletion executed by immune/trusted entity. Skipping.');
      return false;
    }

    const now = Date.now();
    const executorKey = `${guild.id}:${executor.id}`;
    const windowSecs = settings.thresholds?.channel_delete_window_seconds || 10;
    const limit = settings.thresholds?.channel_delete_limit || 3;
    const restoreSingle = Boolean(settings.thresholds?.restore_single_deletions);

    // Get sliding window
    const windowList = (deletionSlidingWindows.get(executorKey) || [])
      .filter(item => now - item.timestamp < windowSecs * 1000);

    windowList.push({
      channelId,
      timestamp: now,
      snapshot
    });

    deletionSlidingWindows.set(executorKey, windowList);

    const isThresholdMet = windowList.length >= limit || (restoreSingle && windowList.length >= 1);

    if (!isThresholdMet) {
      return;
    }

    // Prevent concurrent duplicate restore execution for the same guild
    if (restoreGuildLocks.has(guild.id)) {
      return;
    }
    restoreGuildLocks.add(guild.id);

    const startTime = Date.now();

    try {
      // 1. Punish executor immediately
      const punishmentResult = await punishOffender(
        guild,
        executor,
        settings.punishment || 'ban',
        `Argoni Anti-Nuke: Mass channel deletion detected (${windowList.length} channels in ${windowSecs}s)`,
        Boolean(settings.dry_run)
      );

      // 2. Collect all snapshots to restore
      const snapshotsToRestore = [];
      for (const item of windowList) {
        if (item.snapshot) {
          snapshotsToRestore.push(item.snapshot);
        } else {
          const freshSnap = await getChannelSnapshot(guild.id, item.channelId);
          if (freshSnap) snapshotsToRestore.push(freshSnap);
        }
      }

      // Clear the sliding window for this executor
      deletionSlidingWindows.delete(executorKey);

      // 3. Restore channels
      const { restored, failed, idMap, errors } = await restoreChannelBatch(guild, snapshotsToRestore);

      // 4. Remap channel references across database settings
      if (idMap.size > 0) {
        await remapChannelIds(guild.id, idMap);
      }

      // 5. Record Incident
      await recordAntiNukeIncident(guild.id, 'mass_channel_delete', executor.id, {
        deletedCount: windowList.length,
        restoredCount: restored,
        failedCount: failed,
        errors,
        punishment: punishmentResult,
        dryRun: Boolean(settings.dry_run)
      });

      const durationMs = Date.now() - startTime;
      const unixNow = Math.floor(Date.now() / 1000);

      // 6. Send Report Card to log channel
      const logChanId = settings.log_channel_id || settings.alert_channel_id;
      // If log channel was among the deleted, try to get its new recreated ID
      const targetChanId = (logChanId && idMap.has(logChanId)) ? idMap.get(logChanId) : logChanId;

      if (targetChanId) {
        const logChan = guild.channels.cache.get(targetChanId);
        if (logChan && logChan.isTextBased?.()) {
          const reportContainer = new ContainerBuilder();
          const reportLines = [
            `## 🚨 Anti-Nuke: Mass Channel Deletion Intercepted`,
            `An unauthorized deletion of channels was intercepted and reversed <t:${unixNow}:F> (<t:${unixNow}:R>).`,
            ``,
            `### Incident Details`,
            `- **Offender:** <@${executor.id}> (\`${executor.tag || executor.id}\`)`,
            `- **Action Taken:** **${punishmentResult}**`,
            `- **Channels Deleted:** \`${windowList.length}\``,
            `- **Channels Restored:** \`${restored}\` of \`${snapshotsToRestore.length}\``,
            `- **Failures:** \`${failed}\``,
            `- **Duration:** \`${durationMs}ms\``,
            `- **Database Remap:** \`${idMap.size}\` channel references migrated`,
            ``,
            `> ℹ️ *Note: Channel settings, categories, order, and permissions have been fully restored. As Discord permanently discards message data upon channel deletion, past text history cannot be recovered.*`
          ];

          if (errors.length > 0) {
            reportLines.push(``, `**Errors Encountered:**`, ...errors.slice(0, 5).map(e => `> ⚠️ ${e}`));
          }

          reportContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(reportLines.join('\n')));

          await logChan.send({
            components: [reportContainer],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { parse: [] }
          }).catch(() => {});
        }
      }

      logger.info({
        guildId: guild.id,
        executorId: executor.id,
        restored,
        failed,
        durationMs
      }, 'Completed Anti-Nuke mass channel restoration');

    } finally {
      restoreGuildLocks.delete(guild.id);
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, channelId }, 'Critical error in handleChannelDeleteEvent');
    restoreGuildLocks.delete(guild.id);
  }
}

export async function restoreChannelFromSnapshot(guild, snapshot) {
  return restoreChannelBatch(guild, [snapshot]);
}

export const handleChannelDelete = handleChannelDeleteEvent;

export default {
  queueChannelSnapshot,
  punishOffender,
  restoreChannelBatch,
  restoreChannelFromSnapshot,
  handleChannelDeleteEvent,
  handleChannelDelete
};

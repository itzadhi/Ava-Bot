import {
  AuditLogEvent,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import crypto from 'node:crypto';
import { db } from '../../db/client.js';
import { logger } from '../../core/logger/index.js';
import { getAntiNukeSettings, saveChannelSnapshotHashed } from './storage.js';
import { isTrusted, isChannelExempt, getChannelSnapshot, deleteChannelSnapshot } from '../../db/antinuke.js';
import { remapIds } from '../../core/db/remap.js';
import { brand } from '../../config/brand.js';
import { perm } from '../../core/permissions/permApply.js';

// Per-guild async mutex locks to prevent simultaneous duplicate restores
const guildRestoreLocks = new Set();

// Sliding-window deletion tracking: Map<`${guildId}:${executorId}`, Array<{ channelId: string, timestamp: number, channelData?: object }>>
const deletionSlidingWindows = new Map();

/**
 * Fetches the audit log entry for channel deletion with exponential backoff and timestamp validation.
 * @param {import('discord.js').Guild} guild
 * @param {string} channelId
 * @param {number} [retries=3]
 * @returns {Promise<import('discord.js').GuildAuditLogsEntry|null>}
 */
export async function fetchChannelDeleteAuditWithRetry(guild, channelId, retries = 3) {
  const delays = [400, 800, 1200];
  const now = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const logs = await guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 6
      });

      const entry = logs.entries.find(e => {
        const matchesTarget = e.targetId === channelId;
        const fresh = Math.abs(now - e.createdTimestamp) < 15000; // Within 15 seconds
        return matchesTarget && fresh;
      });

      if (entry) return entry;
    } catch (err) {
      logger.warn({ err: err.message, guildId: guild.id }, 'Audit log lookup warning');
    }

    if (attempt < retries) {
      await new Promise(r => setTimeout(r, delays[attempt] || 500));
    }
  }
  return null;
}

/**
 * Punishes an offending executor with automated retry and role-strip state capture for undo.
 *
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').User} executor
 * @param {string} action 'ban', 'kick', 'strip_roles', 'timeout'
 * @param {string} reason
 * @param {boolean} [dryRun=false]
 * @param {string} incidentId
 * @returns {Promise<{ status: string, undoState: object }>}
 */
export async function punishOffender(guild, executor, action = 'ban', reason = 'Anti-Nuke violation', dryRun = false, incidentId = null) {
  if (dryRun) {
    logger.info({ guildId: guild.id, executorId: executor.id, action }, '[DRY RUN] Would punish executor');
    return { status: `[Dry Run] Would have applied: ${action.toUpperCase()}`, undoState: {} };
  }

  const member = await guild.members.fetch(executor.id).catch(() => null);
  if (!member) {
    return { status: 'Executor not present in guild', undoState: {} };
  }

  const undoState = {
    roles: member.roles.cache.filter(r => !r.managed && r.id !== guild.id).map(r => r.id),
    nickname: member.nickname
  };

  try {
    if (action === 'ban') {
      if (member.bannable) {
        await guild.bans.create(executor.id, {
          reason: `AVA Anti-Nuke: ${reason}`,
          deleteMessageSeconds: 86400
        });
        await recordActionLog(incidentId, guild.id, 'ban', executor.id, 'executed', undoState);
        return { status: 'Banned from server', undoState };
      }

      // Hierarchy failure fallback: strip all roles below bot's highest role
      logger.warn(`[ANTINUKE] Bot cannot ban ${executor.id} (role hierarchy). Applying role strip fallback.`);
      const botHighest = guild.members.me?.roles.highest.position ?? 0;
      const strippable = member.roles.cache.filter(r => r.position < botHighest && !r.managed && r.id !== guild.id);
      if (strippable.size > 0) {
        await member.roles.remove(strippable, 'AVA Anti-Nuke: Role hierarchy fallback strip');
      }
      await recordActionLog(incidentId, guild.id, 'ban', executor.id, 'hierarchy_partial_strip', undoState);
      return { status: 'Partial: Stripped lower roles (role hierarchy prevented ban)', undoState };
    }

    if (action === 'kick') {
      if (member.kickable) {
        await member.kick(`AVA Anti-Nuke: ${reason}`);
        await recordActionLog(incidentId, guild.id, 'kick', executor.id, 'executed', undoState);
        return { status: 'Kicked from server', undoState };
      }
      return { status: 'Failed: Bot missing Kick Members hierarchy', undoState };
    }

    if (action === 'timeout') {
      if (member.moderatable) {
        await member.timeout(24 * 60 * 60 * 1000, `AVA Anti-Nuke: ${reason}`);
        await recordActionLog(incidentId, guild.id, 'timeout', executor.id, 'executed', undoState);
        return { status: 'Timed out for 24 hours', undoState };
      }
      return { status: 'Failed: Member not moderatable', undoState };
    }

    if (action === 'strip_roles') {
      const strippable = member.roles.cache.filter(r => !r.managed && r.id !== guild.id);
      if (strippable.size > 0) {
        await member.roles.set([], `AVA Anti-Nuke: ${reason}`);
        await recordActionLog(incidentId, guild.id, 'strip_roles', executor.id, 'executed', undoState);
        return { status: `Stripped ${strippable.size} roles`, undoState };
      }
      return { status: 'No roles to strip', undoState };
    }
  } catch (err) {
    logger.error({ err, guildId: guild.id, executorId: executor.id }, 'Error executing punishment');
    await recordActionLog(incidentId, guild.id, action, executor.id, 'failed', undoState, { error: err.message });
    return { status: `Error: ${err.message}`, undoState };
  }

  return { status: 'None', undoState };
}

/**
 * Idempotently records an antinuke action into antinuke_actions.
 */
async function recordActionLog(incidentId, guildId, actionType, targetId, status, undoState = {}, details = {}) {
  if (!incidentId) return;
  try {
    await db.from('antinuke_actions').insert({
      incident_id: incidentId,
      guild_id: guildId,
      action_type: actionType,
      target_id: targetId,
      status,
      undo_state: undoState,
      details,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed recording action log');
  }
}

/**
 * Restores channels sequentially: Categories first, then child channels,
 * preserving permissions and remapping IDs across all 22 modules.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array<object>} snapshots
 * @returns {Promise<{ restored: number, failed: number, idMap: Map<string, string> }>}
 */
export async function restoreChannelBatch(guild, snapshots) {
  let restored = 0;
  let failed = 0;
  const idMap = new Map(); // oldId -> newId

  // 1. Sort: Categories first so children can attach to newly recreated categories
  const categories = snapshots.filter(s => s.type === ChannelType.GuildCategory);
  const others = snapshots.filter(s => s.type !== ChannelType.GuildCategory);
  const ordered = [...categories, ...others];

  for (const snap of ordered) {
    try {
      const parentId = snap.parentId ? (idMap.get(snap.parentId) || snap.parentId) : null;

      // Rebuild overwrites
      const overwrites = [];
      if (Array.isArray(snap.permissionOverwrites)) {
        for (const ov of snap.permissionOverwrites) {
          const exists = ov.type === 0 ? guild.roles.cache.has(ov.id) : guild.members.cache.has(ov.id);
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
        reason: 'AVA Anti-Nuke: Automated emergency restoration'
      };

      if (snap.type === ChannelType.GuildVoice || snap.type === ChannelType.GuildStageVoice) {
        if (snap.bitrate) createOptions.bitrate = snap.bitrate;
        if (snap.userLimit) createOptions.userLimit = snap.userLimit;
      }

      const permRes = await perm.apply({
        guildId: guild.id,
        feature: 'antinuke',
        targetType: 'channel',
        targetId: snap.id,
        op: 'create_channel_with_overwrites',
        field: 'permissionOverwrites',
        oldValue: null,
        newValue: overwrites,
        reason: 'AVA Anti-Nuke: Automated emergency restoration',
        execute: () => guild.channels.create(createOptions)
      });
      if (!permRes.executed || !permRes.result) {
        continue;
      }
      const newChan = permRes.result;
      idMap.set(snap.id, newChan.id);

      // Save new channel snapshot and delete old one
      await saveChannelSnapshotHashed(guild.id, newChan);
      await deleteChannelSnapshot(guild.id, snap.id);

      restored++;
      await new Promise(r => setTimeout(r, 60)); // Rate limit buffer
    } catch (err) {
      logger.error({ err, channelName: snap.name, guildId: guild.id }, 'Failed restoring channel');
      failed++;
    }
  }

  // 2. Centrally remap IDs across ALL 22 modules
  if (idMap.size > 0) {
    await remapIds(guild.id, { channels: idMap });
  }

  return { restored, failed, idMap };
}

/**
 * Handles incoming channel delete event with threshold detection, automated punishment,
 * category-first restoration, and universal ID remapping.
 *
 * @param {import('discord.js').GuildChannel} channel
 */
export async function handleChannelDeletePipeline(channel) {
  if (!channel?.guild) return;
  const guild = channel.guild;
  const gid = guild.id;
  const cid = channel.id;

  // 1. Check protection enabled
  const settings = await getAntiNukeSettings(gid);
  if (!settings.enabled) return false;

  // 2. Check channel exempt
  const exempt = await isChannelExempt(gid, cid, channel);
  if (exempt) return false;

  // 3. Resolve executor with audit log retry
  const audit = await fetchChannelDeleteAuditWithRetry(guild, cid, 3);
  const executor = audit?.executor;

  // Ignore owner, bot itself, and trusted entities
  if (executor) {
    const immune = await isTrusted(guild, executor.id);
    if (immune) {
      logger.info({ guildId: gid, executor: executor.tag, channel: channel.name }, 'Trusted executor deleted channel; skipping antinuke');
      return false;
    }
  }

  const executorId = executor ? executor.id : 'unknown';
  const now = Date.now();
  const windowSecs = settings.thresholds?.channel_delete_window_seconds || 10;
  const threshold = settings.thresholds?.channel_delete_limit || 3;
  const winKey = `${gid}:${executorId}`;

  // 4. Update sliding window
  let windowList = deletionSlidingWindows.get(winKey) || [];
  windowList = windowList.filter(item => now - item.timestamp < windowSecs * 1000);

  const snapshot = await getChannelSnapshot(gid, cid);
  windowList.push({
    channelId: cid,
    timestamp: now,
    channelData: snapshot
  });
  deletionSlidingWindows.set(winKey, windowList);

  const deletedCount = windowList.length;
  logger.warn(`[ANTINUKE] Channel deleted in ${guild.name}: "${channel.name}" by ${executor ? executor.tag : 'unknown'} (${deletedCount}/${threshold} in ${windowSecs}s)`);

  // 5. Evaluate threshold
  if (deletedCount < threshold && !settings.thresholds?.restore_single_deletions) {
    return;
  }

  // Threshold exceeded - Acquire per-guild restore lock
  if (guildRestoreLocks.has(gid)) return;
  guildRestoreLocks.add(gid);

  try {
    const incidentId = crypto.randomUUID();
    const dryRun = settings.dry_run;

    // A. Record incident
    await db.from('antinuke_incidents').insert({
      id: incidentId,
      guild_id: gid,
      type: 'mass_channel_delete',
      executor_id: executorId,
      details: {
        channelName: channel.name,
        deletedCount,
        threshold,
        dryRun
      },
      created_at: new Date().toISOString()
    }).catch(() => {});

    // B. Punish executor
    let punishmentResult = 'None';
    if (executor && !executor.bot) {
      const res = await punishOffender(guild, executor, settings.punishment, `Mass channel deletion (${deletedCount} channels)`, dryRun, incidentId);
      punishmentResult = res.status;
    }

    // C. Gather snapshots to restore
    const toRestore = [];
    for (const item of windowList) {
      if (item.channelData) {
        toRestore.push(item.channelData);
      } else {
        const snap = await getChannelSnapshot(gid, item.channelId);
        if (snap) toRestore.push(snap);
      }
    }

    // Clear sliding window for executor
    deletionSlidingWindows.delete(winKey);

    // D. Execute batch restoration
    const { restored, failed, idMap } = await restoreChannelBatch(guild, toRestore);

    // E. Send clean Components V2 incident alert
    const alertChanId = settings.alert_channel_id || settings.log_channel_id;
    if (alertChanId) {
      const alertChan = guild.channels.cache.get(alertChanId);
      if (alertChan && alertChan.isTextBased?.()) {
        const container = new ContainerBuilder();
        const lines = [
          `## ${brand.emojis.shield} Anti-Nuke Incident Neutralized`,
          `High-volume channel deletion threshold detected <t:${Math.floor(now / 1000)}:R>.`,
          '',
          `### Incident Diagnostics`,
          `- **Executor:** ${executor ? `<@${executor.id}> (\`${executor.tag}\`)` : '`Unknown`'}`,
          `- **Punishment:** **${punishmentResult}**`,
          `- **Channels Restored:** \`${restored}\` channels`,
          `- **Channels Failed:** \`${failed}\``,
          `- **Universal ID Remap:** \`${idMap.size}\` references updated across all modules`,
          '',
          `-# ${brand.footerText} · Incident ID: \`${incidentId.slice(0, 8)}\``
        ];
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

        await alertChan.send({
          components: [container],
          flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
      }
    }
  } finally {
    guildRestoreLocks.delete(gid);
  }
}

export default {
  fetchChannelDeleteAuditWithRetry,
  punishOffender,
  restoreChannelBatch,
  handleChannelDeletePipeline
};

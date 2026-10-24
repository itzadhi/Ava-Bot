import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import {
  fetchChannelDeleteAuditWithRetry,
  punishOffender as pipelinePunishOffender,
  restoreChannelBatch as pipelineRestoreChannelBatch,
  handleChannelDeletePipeline
} from './pipeline.js';
import { saveChannelSnapshotHashed } from './storage.js';
import { logger } from '../../core/logger/index.js';

// Debounce map for snapshot updates to batch writes
const snapshotDebounce = new Map();

/**
 * Debounced and content-hashed snapshot queue for channelCreate and channelUpdate.
 * Only writes to database when channel content hash changes.
 *
 * @param {string} guildId
 * @param {import('discord.js').GuildChannel} channel
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
      await saveChannelSnapshotHashed(guildId, channel);
    } catch (err) {
      logger.warn({ err: err.message, guildId, channelId: channel.id }, 'Error saving debounced channel snapshot');
    }
  }, 1000);

  snapshotDebounce.set(key, timer);
}

/**
 * Punishes an offending executor
 */
export async function punishOffender(guild, executor, action = 'ban', reason = 'Anti-Nuke violation', dryRun = false) {
  const res = await pipelinePunishOffender(guild, executor, action, reason, dryRun);
  return res.status;
}

/**
 * Restores a batch of channels sequentially preserving order, category parents, and overwrites
 */
export async function restoreChannelBatch(guild, snapshots) {
  const res = await pipelineRestoreChannelBatch(guild, snapshots);
  return {
    restored: res.restored,
    failed: res.failed,
    idMap: res.idMap,
    errors: []
  };
}

/**
 * Handles incoming channelDelete event via the robust execution pipeline
 */
export async function handleChannelDeleteEvent(channel) {
  return handleChannelDeletePipeline(channel);
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

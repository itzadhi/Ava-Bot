import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  return err && (err.code === 'PGRST205' || err.code === '42P01' || String(err.message).includes('schema cache'));
}

/**
 * Gets staff panel state for a guild
 */
export async function getPanelState(guildId) {
  if (!guildId) return null;
  const { data, error } = await db.from('panel_state').select('*').eq('guild_id', guildId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb.from('panel_state').select('*').eq('guild_id', guildId).maybeSingle();
      return mem.data;
    }
    logger.error({ error, guildId }, 'Error fetching panel state');
    return null;
  }
  if (!data) {
    const mem = await memoryDb.from('panel_state').select('*').eq('guild_id', guildId).maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Saves staff panel state for a guild
 */
export async function savePanelState(guildId, {
  channelId,
  messageId,
  activeTab = 'sug',
  filterStatus = 'all',
  page = 1
}) {
  const existing = await getPanelState(guildId) || {};
  const resolvedChannelId = channelId || existing.channel_id || null;
  const resolvedMessageId = messageId || existing.message_id || null;

  const record = {
    guild_id: guildId,
    channel_id: resolvedChannelId,
    message_id: resolvedMessageId,
    active_tab: activeTab || existing.active_tab || 'sug',
    filter_status: filterStatus !== undefined ? filterStatus : (existing.filter_status || 'all'),
    page: page !== undefined ? page : (existing.page || 1),
    updated_at: new Date().toISOString()
  };

  memoryDb.from('panel_state').upsert(record);

  // If remote schema enforces NOT NULL on channel_id or message_id, only push if both are present
  if (record.channel_id && record.message_id) {
    const { data, error } = await db.from('panel_state').upsert(record).select().single();
    if (error && !isMissingTableError(error)) {
      logger.error({ error, guildId }, 'Error saving panel state');
    }
    return data || record;
  }
  return record;
}

/**
 * Deletes panel state
 */
export async function deletePanelState(guildId) {
  await memoryDb.from('panel_state').delete().eq('guild_id', guildId);
  const { data, error } = await db.from('panel_state').delete().eq('guild_id', guildId);
  if (error && !isMissingTableError(error)) {
    logger.error({ error, guildId }, 'Error deleting panel state');
  }
  return true;
}

/**
 * Gets all saved panel states across all guilds (for restart verification)
 */
export async function getAllPanelStates() {
  const { data, error } = await db.from('panel_state').select('*');
  if (error) {
    if (isMissingTableError(error)) {
      const memRes = await memoryDb.from('panel_state').select('*');
      return memRes.data || [];
    }
    logger.error({ error }, 'Error fetching all panel states');
    return [];
  }
  return data || [];
}

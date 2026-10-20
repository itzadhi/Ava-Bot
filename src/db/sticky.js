import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

// In-memory quick lookup cache for channel sticky notes
const stickyCache = new Map();

/**
 * Retrieves a sticky note for a specific channel
 * @param {string} channelId
 * @returns {Promise<object|null>}
 */
export async function getStickyNote(channelId) {
  if (!channelId) return null;
  if (stickyCache.has(channelId)) return stickyCache.get(channelId);

  const memRow = memoryDb.tables['sticky_notes']?.get(channelId);
  if (memRow) {
    stickyCache.set(channelId, memRow);
    return memRow;
  }

  try {
    const { data } = await db
      .from('sticky_notes')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();

    if (data) {
      stickyCache.set(channelId, data);
      memoryDb.from('sticky_notes').upsert(data);
      return data;
    }
  } catch (err) {
    logger.debug({ err, channelId }, 'Sticky note remote fetch deferred to memory');
  }

  return null;
}

/**
 * Retrieves all sticky notes configured for a guild
 * @param {string} guildId
 * @returns {Promise<object[]>}
 */
export async function getAllStickyNotes(guildId) {
  if (!guildId) return [];

  const memTable = memoryDb.tables['sticky_notes'] || new Map();
  const memList = Array.from(memTable.values()).filter(row => row.guild_id === guildId);

  try {
    const { data } = await db
      .from('sticky_notes')
      .select('*')
      .eq('guild_id', guildId);

    if (data && data.length > 0) {
      return data;
    }
  } catch (err) {
    logger.debug({ err, guildId }, 'All sticky notes remote fetch deferred to memory');
  }

  return memList;
}

/**
 * Sets or updates a sticky note for a channel
 * @param {string} guildId
 * @param {string} channelId
 * @param {string} content
 * @returns {Promise<object>}
 */
export async function setStickyNote(guildId, channelId, content) {
  const existing = await getStickyNote(channelId);
  const record = {
    channel_id: channelId,
    guild_id: guildId,
    content: (content || '').trim(),
    last_message_id: existing?.last_message_id || null,
    is_enabled: true,
    updated_at: new Date().toISOString()
  };

  stickyCache.set(channelId, record);
  memoryDb.from('sticky_notes').upsert(record);

  try {
    await db.from('sticky_notes').upsert(record);
  } catch (err) {
    logger.debug({ err, channelId }, 'Sticky note saved to memory store');
  }

  return record;
}

/**
 * Updates the last message ID of a sticky note
 * @param {string} channelId
 * @param {string} messageId
 */
export async function updateStickyLastMessage(channelId, messageId) {
  const existing = await getStickyNote(channelId);
  if (!existing) return;

  existing.last_message_id = messageId;
  stickyCache.set(channelId, existing);
  memoryDb.from('sticky_notes').upsert(existing);

  try {
    await db.from('sticky_notes').update({ last_message_id: messageId }).eq('channel_id', channelId);
  } catch (_) {}
}

/**
 * Toggles a sticky note between active and inactive
 * @param {string} channelId
 * @param {boolean} [isEnabled]
 * @returns {Promise<object|null>}
 */
export async function toggleStickyNote(channelId, isEnabled = null) {
  const existing = await getStickyNote(channelId);
  if (!existing) return null;

  existing.is_enabled = isEnabled !== null ? Boolean(isEnabled) : !existing.is_enabled;
  stickyCache.set(channelId, existing);
  memoryDb.from('sticky_notes').upsert(existing);

  try {
    await db.from('sticky_notes').update({ is_enabled: existing.is_enabled }).eq('channel_id', channelId);
  } catch (_) {}

  return existing;
}

/**
 * Deletes a sticky note
 * @param {string} channelId
 */
export async function deleteStickyNote(channelId) {
  stickyCache.delete(channelId);
  memoryDb.tables['sticky_notes']?.delete(channelId);

  try {
    await db.from('sticky_notes').delete().eq('channel_id', channelId);
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// STICKY ROLES PERSISTENCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieves saved roles for a member upon rejoining
 * @param {string} guildId
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export async function getMemberStickyRoles(guildId, userId) {
  const id = `${guildId}:${userId}`;
  const memRow = memoryDb.tables['sticky_roles']?.get(id);
  if (memRow?.role_ids) return memRow.role_ids;

  try {
    const { data } = await db
      .from('sticky_roles')
      .select('role_ids')
      .eq('id', id)
      .maybeSingle();

    if (data?.role_ids) {
      memoryDb.from('sticky_roles').upsert({ id, guild_id: guildId, user_id: userId, role_ids: data.role_ids });
      return data.role_ids;
    }
  } catch (err) {
    logger.debug({ err, id }, 'Sticky roles remote fetch deferred to memory');
  }

  return [];
}

/**
 * Saves roles for a member when they leave the server
 * @param {string} guildId
 * @param {string} userId
 * @param {string[]} roleIds
 */
export async function saveMemberStickyRoles(guildId, userId, roleIds) {
  const id = `${guildId}:${userId}`;
  const record = {
    id,
    guild_id: guildId,
    user_id: userId,
    role_ids: roleIds || [],
    updated_at: new Date().toISOString()
  };

  memoryDb.from('sticky_roles').upsert(record);

  try {
    await db.from('sticky_roles').upsert(record);
  } catch (err) {
    logger.debug({ err, id }, 'Saved sticky roles to memory storage');
  }
}

/**
 * Clears saved sticky roles for a member
 * @param {string} guildId
 * @param {string} userId
 */
export async function clearMemberStickyRoles(guildId, userId) {
  const id = `${guildId}:${userId}`;
  memoryDb.tables['sticky_roles']?.delete(id);

  try {
    await db.from('sticky_roles').delete().eq('id', id);
  } catch (_) {}
}

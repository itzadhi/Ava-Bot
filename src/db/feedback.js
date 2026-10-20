import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  return err && (err.code === 'PGRST205' || err.code === '42P01' || String(err.message).includes('schema cache'));
}

/**
 * Creates a new feedback record
 */
export async function createFeedback({
  guildId,
  channelId = null,
  messageId = null,
  authorId,
  authorUsername,
  authorAvatar = null,
  category = 'Other',
  message,
  rating = null,
  context = {}
}) {
  const id = `fbk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    guild_id: guildId,
    channel_id: channelId,
    message_id: messageId,
    author_id: authorId,
    author_username: authorUsername,
    author_avatar: authorAvatar,
    category,
    message,
    rating: rating ? parseInt(rating, 10) : null,
    status: 'unread',
    context,
    reply: null,
    replied_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db.from('feedback').insert(record).select().single();
  if (error) {
    if (isMissingTableError(error)) {
      const memRes = await memoryDb.from('feedback').insert(record).select().single();
      return memRes.data || record;
    }
    logger.error({ error, guildId, authorId }, 'Error creating feedback');
    throw error;
  }
  return data || record;
}

/**
 * Gets feedback by ID
 */
export async function getFeedbackById(id) {
  if (!id) return null;
  const { data, error } = await db.from('feedback').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb.from('feedback').select('*').eq('id', id).maybeSingle();
      return mem.data;
    }
    logger.error({ error, id }, 'Error fetching feedback by id');
    return null;
  }
  if (!data) {
    const mem = await memoryDb.from('feedback').select('*').eq('id', id).maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Updates a feedback record
 */
export async function updateFeedback(id, updates) {
  memoryDb.from('feedback').update(updates).eq('id', id);

  const { data, error } = await db
    .from('feedback')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error && !isMissingTableError(error)) {
    logger.error({ error, id, updates }, 'Error updating feedback');
  }
  return getFeedbackById(id);
}

/**
 * Deletes a feedback record
 */
export async function deleteFeedback(id) {
  await memoryDb.from('feedback').delete().eq('id', id);
  const { data, error } = await db.from('feedback').delete().eq('id', id);
  if (error && !isMissingTableError(error)) {
    logger.error({ error, id }, 'Error deleting feedback');
  }
  return true;
}

/**
 * Lists feedback for a guild with optional status/category filter and pagination
 */
export async function getGuildFeedback(guildId, { status = null, category = null, limit = 10, offset = 0 } = {}) {
  let query = db.from('feedback').select('*').eq('guild_id', guildId);
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  query = query.order('created_at', { ascending: false });
  if (offset > 0 || limit) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      let memQuery = memoryDb.from('feedback').select('*').eq('guild_id', guildId);
      if (status && status !== 'all') {
        memQuery = memQuery.eq('status', status);
      }
      if (category && category !== 'all') {
        memQuery = memQuery.eq('category', category);
      }
      memQuery = memQuery.order('created_at', { ascending: false });
      if (offset > 0 || limit) {
        memQuery = memQuery.range(offset, offset + limit - 1);
      }
      const memRes = await memQuery;
      return memRes.data || [];
    }
    logger.error({ error, guildId }, 'Error fetching guild feedback');
    return [];
  }
  return data || [];
}

/**
 * Counts feedback for a guild
 */
export async function countGuildFeedback(guildId, { status = null, category = null } = {}) {
  let query = db.from('feedback').select('*').eq('guild_id', guildId);
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  if (category && category !== 'all') {
    query = query.eq('category', category);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      let memQuery = memoryDb.from('feedback').select('*').eq('guild_id', guildId);
      if (status && status !== 'all') {
        memQuery = memQuery.eq('status', status);
      }
      if (category && category !== 'all') {
        memQuery = memQuery.eq('category', category);
      }
      const memRes = await memQuery;
      return (memRes.data || []).length;
    }
    logger.error({ error, guildId }, 'Error counting feedback');
    return 0;
  }
  return (data || []).length;
}

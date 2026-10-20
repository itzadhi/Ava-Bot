import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  return err && (err.code === 'PGRST205' || err.code === '42P01' || String(err.message).includes('schema cache'));
}

/**
 * Creates a new suggestion record
 */
export async function createSuggestion({
  guildId,
  channelId = null,
  messageId = null,
  authorId,
  authorUsername,
  authorAvatar = null,
  imageUrl = null,
  text
}) {
  const id = `sug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id,
    guild_id: guildId,
    channel_id: channelId,
    message_id: messageId,
    author_id: authorId,
    author_username: authorUsername,
    author_avatar: authorAvatar,
    image_url: imageUrl,
    text,
    status: 'pending',
    moderator_id: null,
    moderator_tag: null,
    moderator_reason: null,
    upvotes_count: 0,
    downvotes_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db.from('suggestions').insert(record).select().single();
  if (error) {
    if (String(error.message).includes('image_url') || error.code === '42703') {
      const fallback = { ...record };
      delete fallback.image_url;
      const res = await db.from('suggestions').insert(fallback).select().single();
      return res.data || fallback;
    }
    if (isMissingTableError(error)) {
      const memRes = await memoryDb.from('suggestions').insert(record).select().single();
      return memRes.data || record;
    }
    logger.error({ error, guildId, authorId }, 'Error creating suggestion');
    throw error;
  }
  return data || record;
}

/**
 * Gets a suggestion by primary ID
 */
export async function getSuggestionById(id) {
  if (!id) return null;
  const { data, error } = await db.from('suggestions').select('*').eq('id', id).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb.from('suggestions').select('*').eq('id', id).maybeSingle();
      return mem.data;
    }
    logger.error({ error, id }, 'Error fetching suggestion by id');
    return null;
  }
  if (!data) {
    const mem = await memoryDb.from('suggestions').select('*').eq('id', id).maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Gets a suggestion by message ID
 */
export async function getSuggestionByMessageId(messageId) {
  if (!messageId) return null;
  const { data, error } = await db.from('suggestions').select('*').eq('message_id', messageId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb.from('suggestions').select('*').eq('message_id', messageId).maybeSingle();
      return mem.data;
    }
    logger.error({ error, messageId }, 'Error fetching suggestion by messageId');
    return null;
  }
  if (!data) {
    const mem = await memoryDb.from('suggestions').select('*').eq('message_id', messageId).maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Updates a suggestion
 */
export async function updateSuggestion(id, updates) {
  await memoryDb.from('suggestions').update(updates).eq('id', id);

  const { data, error } = await db
    .from('suggestions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error && !isMissingTableError(error)) {
    logger.error({ error, id, updates }, 'Error updating suggestion');
  }
  return getSuggestionById(id);
}

/**
 * Deletes a suggestion
 */
export async function deleteSuggestion(id) {
  await db.from('suggestion_votes').delete().eq('suggestion_id', id);
  await memoryDb.from('suggestion_votes').delete().eq('suggestion_id', id);

  const { data, error } = await db.from('suggestions').delete().eq('id', id);
  await memoryDb.from('suggestions').delete().eq('id', id);

  if (error && !isMissingTableError(error)) {
    logger.error({ error, id }, 'Error deleting suggestion');
  }
  return true;
}

/**
 * Lists suggestions for a guild with optional status filter and pagination
 */
export async function getGuildSuggestions(guildId, { status = null, limit = 10, offset = 0 } = {}) {
  let query = db.from('suggestions').select('*').eq('guild_id', guildId);
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  query = query.order('created_at', { ascending: false });
  if (offset > 0 || limit) {
    query = query.range(offset, offset + limit - 1);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      let memQuery = memoryDb.from('suggestions').select('*').eq('guild_id', guildId);
      if (status && status !== 'all') {
        memQuery = memQuery.eq('status', status);
      }
      memQuery = memQuery.order('created_at', { ascending: false });
      if (offset > 0 || limit) {
        memQuery = memQuery.range(offset, offset + limit - 1);
      }
      const memRes = await memQuery;
      return memRes.data || [];
    }
    logger.error({ error, guildId }, 'Error fetching guild suggestions');
    return [];
  }
  return data || [];
}

/**
 * Counts suggestions for a guild
 */
export async function countGuildSuggestions(guildId, { status = null } = {}) {
  let query = db.from('suggestions').select('*').eq('guild_id', guildId);
  if (status && status !== 'all') {
    query = query.eq('status', status);
  }
  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error)) {
      let memQuery = memoryDb.from('suggestions').select('*').eq('guild_id', guildId);
      if (status && status !== 'all') {
        memQuery = memQuery.eq('status', status);
      }
      const memRes = await memQuery;
      return (memRes.data || []).length;
    }
    logger.error({ error, guildId }, 'Error counting suggestions');
    return 0;
  }
  return (data || []).length;
}

/**
 * Retrieves the current vote of a user on a suggestion
 */
export async function getUserVote(suggestionId, userId) {
  const { data, error } = await db
    .from('suggestion_votes')
    .select('*')
    .eq('suggestion_id', suggestionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb
        .from('suggestion_votes')
        .select('*')
        .eq('suggestion_id', suggestionId)
        .eq('user_id', userId)
        .maybeSingle();
      return mem.data;
    }
    return null;
  }
  if (!data) {
    const mem = await memoryDb
      .from('suggestion_votes')
      .select('*')
      .eq('suggestion_id', suggestionId)
      .eq('user_id', userId)
      .maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Casts, switches, or toggles a vote on a suggestion
 */
export async function castVote(suggestionId, guildId, userId, requestedVoteType) {
  const existing = await getUserVote(suggestionId, userId);
  const sug = await getSuggestionById(suggestionId);
  if (!sug) throw new Error('Suggestion not found');

  let up = sug.upvotes_count || 0;
  let down = sug.downvotes_count || 0;
  let action = 'added';
  let currentVote = requestedVoteType;

  if (existing) {
    if (existing.vote_type === requestedVoteType) {
      // Toggle off: remove vote
      await db.from('suggestion_votes').delete().eq('suggestion_id', suggestionId).eq('user_id', userId);
      await memoryDb.from('suggestion_votes').delete().eq('suggestion_id', suggestionId).eq('user_id', userId);
      if (requestedVoteType === 'up') up = Math.max(0, up - 1);
      else down = Math.max(0, down - 1);
      action = 'removed';
      currentVote = null;
    } else {
      // Switch vote
      await db.from('suggestion_votes').update({ vote_type: requestedVoteType }).eq('suggestion_id', suggestionId).eq('user_id', userId);
      await memoryDb.from('suggestion_votes').update({ vote_type: requestedVoteType }).eq('suggestion_id', suggestionId).eq('user_id', userId);
      if (requestedVoteType === 'up') {
        up++;
        down = Math.max(0, down - 1);
      } else {
        down++;
        up = Math.max(0, up - 1);
      }
      action = 'switched';
      currentVote = requestedVoteType;
    }
  } else {
    // Add vote
    const voteRec = {
      suggestion_id: suggestionId,
      guild_id: guildId,
      user_id: userId,
      vote_type: requestedVoteType,
      created_at: new Date().toISOString()
    };
    await db.from('suggestion_votes').insert(voteRec);
    await memoryDb.from('suggestion_votes').insert(voteRec);
    if (requestedVoteType === 'up') up++;
    else down++;
    action = 'added';
    currentVote = requestedVoteType;
  }

  await updateSuggestion(suggestionId, { upvotes_count: up, downvotes_count: down });
  return { action, upvotes: up, downvotes: down, currentVote };
}

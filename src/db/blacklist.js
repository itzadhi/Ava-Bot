import { db } from './client.js';
import { logger } from '../utils/logger.js';

// Fast in-memory sets for middleware check
const userBlacklist = new Set();
const guildBlacklist = new Set();
let initialized = false;

export async function initBlacklistCache() {
  if (initialized) return;
  try {
    const { data, error } = await db.from('blacklist').select('*');
    if (!error && data) {
      userBlacklist.clear();
      guildBlacklist.clear();
      for (const item of data) {
        if (item.type === 'user') userBlacklist.add(item.target_id);
        if (item.type === 'guild') guildBlacklist.add(item.target_id);
      }
      logger.info(`Blacklist loaded: ${userBlacklist.size} users, ${guildBlacklist.size} guilds`);
    }
    initialized = true;
  } catch (err) {
    logger.warn({ err }, 'Could not initialize blacklist cache from DB');
  }
}

export function isBlacklisted(userId, guildId = null) {
  if (userId && userBlacklist.has(userId)) return { blacklisted: true, type: 'user' };
  if (guildId && guildBlacklist.has(guildId)) return { blacklisted: true, type: 'guild' };
  return { blacklisted: false };
}

export async function addBlacklist(type, targetId, reason, addedBy) {
  const { data, error } = await db
    .from('blacklist')
    .upsert({
      type,
      target_id: targetId,
      reason,
      added_by: addedBy,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, type, targetId }, 'Error adding to blacklist');
    throw error;
  }

  if (type === 'user') userBlacklist.add(targetId);
  if (type === 'guild') guildBlacklist.add(targetId);

  return data;
}

export async function removeBlacklist(type, targetId) {
  const { error } = await db
    .from('blacklist')
    .delete()
    .eq('type', type)
    .eq('target_id', targetId);

  if (error) {
    logger.error({ error, type, targetId }, 'Error removing from blacklist');
    throw error;
  }

  if (type === 'user') userBlacklist.delete(targetId);
  if (type === 'guild') guildBlacklist.delete(targetId);

  return true;
}

export async function listBlacklist(type = null, page = 1, limit = 5) {
  let builder = db.from('blacklist').select('*');
  if (type) builder = builder.eq('type', type);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await builder
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    logger.error({ error }, 'Error listing blacklist');
    return [];
  }
  return data || [];
}

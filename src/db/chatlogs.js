import { db } from './client.js';
import { logger } from '../utils/logger.js';

export async function createChatlogRecord({ id, backup_id = null, guild_id, channel_id, message_count, storage_path, ttlDays = 90 }) {
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('chatlogs')
    .insert({
      id,
      backup_id,
      guild_id,
      channel_id,
      message_count,
      storage_path,
      expires_at: expiresAt,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, id, guild_id }, 'Error creating chatlog record');
    throw error;
  }
  return data;
}

export async function getChatlogById(id) {
  const { data, error } = await db
    .from('chatlogs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error({ error, id }, 'Error retrieving chatlog');
    return null;
  }
  return data;
}

export async function getGuildChatlogs(guildId) {
  const { data, error } = await db
    .from('chatlogs')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error, guildId }, 'Error retrieving guild chatlogs');
    return [];
  }
  return data || [];
}

export async function deleteChatlogRecord(id) {
  const { data, error } = await db
    .from('chatlogs')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Error deleting chatlog record');
    throw error;
  }
  return data;
}

export async function getExpiredChatlogs() {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('chatlogs')
    .select('*')
    .lt('expires_at', now);

  if (error) {
    logger.error({ error }, 'Error fetching expired chatlogs');
    return [];
  }
  return data || [];
}

import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

function isMissingTableError(err) {
  return err && (err.code === 'PGRST205' || err.code === '42P01' || String(err.message).includes('schema cache'));
}

/**
 * Creates a record for an active temporary voice channel
 */
export async function createTempChannel({
  channelId,
  guildId,
  ownerId,
  controlMessageId = null,
  controlChannelId = null,
  name,
  userLimit = 0,
  bitrate = 64000,
  isLocked = false,
  isHidden = false,
  ttsEnabled = true
}) {
  const record = {
    channel_id: channelId,
    guild_id: guildId,
    owner_id: ownerId,
    control_message_id: controlMessageId,
    control_channel_id: controlChannelId,
    name,
    user_limit: userLimit,
    bitrate,
    is_locked: isLocked,
    is_hidden: isHidden,
    tts_enabled: ttsEnabled,
    created_at: new Date().toISOString()
  };

  memoryDb.from('temp_channels').upsert(record);

  const { data, error } = await db.from('temp_channels').upsert(record).select().single();
  if (error && !isMissingTableError(error)) {
    logger.error({ error, channelId, guildId }, 'Error creating temp channel record');
  }
  return data || record;
}

/**
 * Gets a temp channel record by its channel ID
 */
export async function getTempChannel(channelId) {
  if (!channelId) return null;
  const { data, error } = await db.from('temp_channels').select('*').eq('channel_id', channelId).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb.from('temp_channels').select('*').eq('channel_id', channelId).maybeSingle();
      return mem.data;
    }
    logger.error({ error, channelId }, 'Error fetching temp channel');
    return null;
  }
  if (!data) {
    const mem = await memoryDb.from('temp_channels').select('*').eq('channel_id', channelId).maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Updates a temp channel record
 */
export async function updateTempChannel(channelId, updates) {
  memoryDb.from('temp_channels').update(updates).eq('channel_id', channelId);

  const { data, error } = await db
    .from('temp_channels')
    .update(updates)
    .eq('channel_id', channelId);

  if (error && !isMissingTableError(error)) {
    logger.error({ error, channelId, updates }, 'Error updating temp channel');
  }
  return getTempChannel(channelId);
}

/**
 * Deletes a temp channel record
 */
export async function deleteTempChannel(channelId) {
  await memoryDb.from('temp_channels').delete().eq('channel_id', channelId);
  const { data, error } = await db.from('temp_channels').delete().eq('channel_id', channelId);
  if (error && !isMissingTableError(error)) {
    logger.error({ error, channelId }, 'Error deleting temp channel');
  }
  return true;
}

/**
 * Gets all active temp channels across all guilds (used during reconciliation on startup)
 */
export async function getAllTempChannels() {
  const { data, error } = await db.from('temp_channels').select('*');
  if (error) {
    if (isMissingTableError(error)) {
      const memRes = await memoryDb.from('temp_channels').select('*');
      return memRes.data || [];
    }
    logger.error({ error }, 'Error fetching all temp channels');
    return [];
  }
  return data || [];
}

/**
 * Gets active temp channels for a specific guild
 */
export async function getGuildTempChannels(guildId) {
  const { data, error } = await db.from('temp_channels').select('*').eq('guild_id', guildId);
  if (error) {
    if (isMissingTableError(error)) {
      const memRes = await memoryDb.from('temp_channels').select('*').eq('guild_id', guildId);
      return memRes.data || [];
    }
    logger.error({ error, guildId }, 'Error fetching guild temp channels');
    return [];
  }
  return data || [];
}

/**
 * Gets an active temp channel by its owner ID in a guild
 */
export async function getTempChannelByOwner(guildId, ownerId) {
  if (!guildId || !ownerId) return null;
  const { data, error } = await db
    .from('temp_channels')
    .select('*')
    .eq('guild_id', guildId)
    .eq('owner_id', ownerId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb
        .from('temp_channels')
        .select('*')
        .eq('guild_id', guildId)
        .eq('owner_id', ownerId)
        .maybeSingle();
      return mem.data;
    }
    logger.error({ error, guildId, ownerId }, 'Error fetching temp channel by owner');
    return null;
  }
  if (!data) {
    const mem = await memoryDb
      .from('temp_channels')
      .select('*')
      .eq('guild_id', guildId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Retrieves per-user voice defaults
 */
export async function getUserVoicePrefs(userId, guildId) {
  const { data, error } = await db
    .from('user_voice_prefs')
    .select('*')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb
        .from('user_voice_prefs')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .maybeSingle();
      return mem.data;
    }
    return null;
  }
  if (!data) {
    const mem = await memoryDb
      .from('user_voice_prefs')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Saves per-user voice defaults
 */
export async function saveUserVoicePrefs(userId, guildId, { preferredName, preferredLimit, preferredBitrate }) {
  const record = {
    user_id: userId,
    guild_id: guildId,
    preferred_name: preferredName !== undefined ? preferredName : null,
    preferred_limit: preferredLimit !== undefined ? preferredLimit : null,
    preferred_bitrate: preferredBitrate !== undefined ? preferredBitrate : null,
    updated_at: new Date().toISOString()
  };

  memoryDb.from('user_voice_prefs').upsert(record);

  const { data, error } = await db.from('user_voice_prefs').upsert(record).select().single();
  if (error && !isMissingTableError(error)) {
    logger.error({ error, userId, guildId }, 'Error saving user voice prefs');
  }
  return data || record;
}

/**
 * Retrieves per-user TTS preferences
 */
export async function getUserTTSPrefs(userId, guildId) {
  const { data, error } = await db
    .from('tts_prefs')
    .select('*')
    .eq('user_id', userId)
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error)) {
      const mem = await memoryDb
        .from('tts_prefs')
        .select('*')
        .eq('user_id', userId)
        .eq('guild_id', guildId)
        .maybeSingle();
      return mem.data;
    }
    return null;
  }
  if (!data) {
    const mem = await memoryDb
      .from('tts_prefs')
      .select('*')
      .eq('user_id', userId)
      .eq('guild_id', guildId)
      .maybeSingle();
    return mem.data;
  }
  return data;
}

/**
 * Saves per-user TTS preferences
 */
export async function saveUserTTSPrefs(userId, guildId, { optOut, language }) {
  const existing = await getUserTTSPrefs(userId, guildId) || {};
  const record = {
    user_id: userId,
    guild_id: guildId,
    opt_out: optOut !== undefined ? Boolean(optOut) : (existing.opt_out ?? false),
    language: language || existing.language || 'en',
    updated_at: new Date().toISOString()
  };

  memoryDb.from('tts_prefs').upsert(record);

  const { data, error } = await db.from('tts_prefs').upsert(record).select().single();
  if (error && !isMissingTableError(error)) {
    logger.error({ error, userId, guildId }, 'Error saving user tts prefs');
  }
  return data || record;
}

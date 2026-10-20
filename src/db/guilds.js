import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

// Cache guild prefixes and settings to avoid spamming DB on every message
const settingsCache = new Map();

export async function getGuildSettings(guildId) {
  if (!guildId) return null;
  if (settingsCache.has(guildId)) {
    return settingsCache.get(guildId);
  }

  const { data, error } = await db
    .from('guild_settings')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    logger.debug({ error, guildId }, 'Note fetching guild settings');
  }

  // Default record
  const defaultSettings = {
    guild_id: guildId,
    locale: 'en-US',
    prefix: 'a!',
    prefix_commands_enabled: true,
    chatlog_enabled: false,
    message_sync_enabled: false,
    premium_tier: 'free',
    premium_until: null,
    backup_role_id: null,
    log_channel_id: null,
    left_at: null,
    jtc_trigger_channel_id: null,
    jtc_category_id: null,
    jtc_name_template: "{username}'s room",
    jtc_default_limit: 0,
    jtc_enabled: true,
    tts_enabled: true,
    tts_announce: false,
    suggestion_channel_id: null,
    suggestions_enabled: true,
    suggestion_cooldown: 60,
    suggestion_thread_enabled: true,
    suggestion_thread_slowmode: 0,
    feedback_channel_id: null,
    feedback_enabled: true,
    staff_role_id: null,
    bot_nickname: null,
    bot_avatar_url: null,
    bot_banner_url: null,
    bot_bio: null,
    automod_enabled: true,
    automod_anti_invites: false,
    automod_anti_links: false,
    automod_anti_spam: false,
    automod_anti_mentions: false,
    automod_anti_caps: false,
    automod_word_filter: false,
    automod_banned_words: [],
    automod_action: 'delete',
    automod_log_channel_id: null,
    automod_exception_role_id: null,
    automod_ignored_role_ids: [],
    boost_tracking_enabled: true,
    boost_channel_id: null,
    boost_role_id: null,
    boost_message: 'Thank you for boosting the server!',
    boost_auto_role_enabled: true,
    sticky_roles_enabled: true,
    sticky_role_ids: [],
    sticky_all_roles: true,
    autorole_enabled: true,
    autorole_member_role_id: null,
    autorole_bot_role_id: null
  };

  const baseDefault = {
    guild_id: guildId,
    locale: 'en-US',
    prefix: 'a!',
    prefix_commands_enabled: true,
    chatlog_enabled: false,
    message_sync_enabled: false,
    premium_tier: 'free',
    premium_until: null,
    backup_role_id: null,
    log_channel_id: null,
    left_at: null
  };

  const memRow = memoryDb.tables['guild_settings']?.get(String(guildId)) || {};
  const result = { ...defaultSettings, ...(data || {}), ...memRow };

  if (!data && !memRow.guild_id) {
    try {
      await db.from('guild_settings').insert(baseDefault);
    } catch (_) {}
  }

  settingsCache.set(guildId, result);
  return result;
}

export async function updateGuildSettings(guildId, updates) {
  // Always update memory storage for immediate sync and missing-column resilience
  memoryDb.from('guild_settings').upsert({ guild_id: guildId, ...updates });

  let remoteData = null;
  try {
    const { data, error } = await db
      .from('guild_settings')
      .upsert({ guild_id: guildId, ...updates, updated_at: new Date().toISOString() })
      .select()
      .single();

    if (!error && data) {
      remoteData = data;
    } else if (error) {
      // Fallback: update base columns if extended columns are not yet migrated on remote DB
      const baseKeys = ['guild_id', 'locale', 'prefix', 'prefix_commands_enabled', 'chatlog_enabled', 'message_sync_enabled', 'premium_tier', 'premium_until', 'backup_role_id', 'log_channel_id', 'left_at', 'updated_at'];
      const baseUpdates = { guild_id: guildId };
      for (const k of baseKeys) {
        if (k in updates) baseUpdates[k] = updates[k];
      }
      await db.from('guild_settings').upsert({ ...baseUpdates, updated_at: new Date().toISOString() }).catch(() => {});
    }
  } catch (err) {
    logger.debug({ err, guildId }, 'Remote column update deferred until SQL migration');
  }

  const current = settingsCache.get(guildId) || await getGuildSettings(guildId);
  const merged = { ...current, ...updates, ...(remoteData || {}) };
  settingsCache.set(guildId, merged);
  return merged;
}

export async function markGuildLeft(guildId) {
  return updateGuildSettings(guildId, { left_at: new Date().toISOString() });
}

export async function unmarkGuildLeft(guildId) {
  return updateGuildSettings(guildId, { left_at: null });
}

export async function getStaleGuilds(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('guild_settings')
    .select('*')
    .not('left_at', 'is', null)
    .lt('left_at', cutoff);

  if (error) {
    logger.error({ error }, 'Error fetching stale guilds');
    return [];
  }
  return data || [];
}

export function clearGuildSettingsCache(guildId) {
  if (guildId) settingsCache.delete(guildId);
  else settingsCache.clear();
}

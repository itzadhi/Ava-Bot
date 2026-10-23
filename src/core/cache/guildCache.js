import { LRUCache } from './lru.js';
import { db, memoryDb } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { queryWithRetry } from './batchWriter.js';

// High-speed bounded LRU cache for guild settings (max 2000 guilds, 10 min TTL)
export const guildSettingsCache = new LRUCache({
  maxSize: 2000,
  ttlMs: 10 * 60 * 1000
});

export const DEFAULT_GUILD_SETTINGS = {
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
  autorole_member_role_ids: [],
  autorole_bot_role_id: null
};

/**
 * Returns default settings object for a given guild ID
 * @param {string} guildId
 * @returns {object}
 */
export function getDefaultSettings(guildId) {
  return {
    guild_id: guildId,
    ...DEFAULT_GUILD_SETTINGS
  };
}

/**
 * Synchronous in-memory lookup. Returns cached settings or defaults immediately.
 * Zero database delay on the message / interaction hot path!
 * @param {string} guildId
 * @returns {object}
 */
export function getGuildSettingsSync(guildId) {
  if (!guildId) return null;
  const cached = guildSettingsCache.get(guildId);
  if (cached) return cached;

  const memRow = memoryDb.tables?.['guild_settings']?.get(String(guildId));
  if (memRow) {
    const merged = { ...getDefaultSettings(guildId), ...memRow };
    guildSettingsCache.set(guildId, merged);
    return merged;
  }

  // Not yet cached: trigger background load without blocking caller
  getGuildSettings(guildId).catch(() => {});
  return getDefaultSettings(guildId);
}

/**
 * Retrieves guild settings with write-through cache check.
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function getGuildSettings(guildId) {
  if (!guildId) return null;

  const cached = guildSettingsCache.get(guildId);
  if (cached) return cached;

  const memRow = memoryDb.tables?.['guild_settings']?.get(String(guildId)) || {};

  try {
    const { data, error } = await queryWithRetry(async () => {
      return await db
        .from('guild_settings')
        .select('*')
        .eq('guild_id', guildId)
        .maybeSingle();
    }, 4000);

    const merged = {
      ...getDefaultSettings(guildId),
      ...(data || {}),
      ...memRow
    };

    guildSettingsCache.set(guildId, merged);
    return merged;
  } catch (err) {
    logger.debug({ err: err.message, guildId }, 'Failed to fetch guild settings from database, using memory cache');
    const fallback = { ...getDefaultSettings(guildId), ...memRow };
    guildSettingsCache.set(guildId, fallback);
    return fallback;
  }
}

/**
 * Write-through update for guild settings. Updates in-memory LRU immediately,
 * then persists to Supabase in the background.
 * @param {string} guildId
 * @param {object} updates
 * @returns {Promise<object>}
 */
export async function updateGuildSettings(guildId, updates) {
  if (!guildId) return null;

  // Immediate write-through to memory storage and LRU cache
  memoryDb.from('guild_settings').upsert({ guild_id: guildId, ...updates });

  const current = guildSettingsCache.get(guildId) || getDefaultSettings(guildId);
  const updated = {
    ...current,
    ...updates,
    updated_at: new Date().toISOString()
  };

  guildSettingsCache.set(guildId, updated);

  // Background database persistence with retry
  queryWithRetry(async () => {
    return await db.from('guild_settings').upsert(updated);
  }, 5000).catch((err) => {
    logger.debug({ err: err.message, guildId }, 'Background guild settings upsert deferred');
  });

  return updated;
}

/**
 * Pre-warms guild settings cache at startup for all connected guilds in bulk.
 * Eliminates cold cache penalties entirely.
 * @param {import('discord.js').Client} client
 */
export async function preloadGuildSettings(client) {
  if (!client?.guilds?.cache?.size) return 0;

  const guildIds = Array.from(client.guilds.cache.keys());
  logger.info(`Pre-warming write-through settings cache for ${guildIds.length} guilds...`);

  const chunkSize = 100;
  let loaded = 0;

  for (let i = 0; i < guildIds.length; i += chunkSize) {
    const chunk = guildIds.slice(i, i + chunkSize);
    try {
      const { data } = await db
        .from('guild_settings')
        .select('*')
        .in('guild_id', chunk);

      if (Array.isArray(data)) {
        for (const row of data) {
          const merged = { ...getDefaultSettings(row.guild_id), ...row };
          guildSettingsCache.set(row.guild_id, merged);
          loaded++;
        }
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Non-fatal error pre-warming guild cache chunk');
    }
  }

  // Set default records in cache for any guilds not yet stored in DB
  for (const id of guildIds) {
    if (!guildSettingsCache.has(id)) {
      guildSettingsCache.set(id, getDefaultSettings(id));
    }
  }

  logger.info(`✓ Warmed settings cache for ${loaded} database records across ${guildIds.length} guilds`);
  return loaded;
}

export default {
  guildSettingsCache,
  getGuildSettingsSync,
  getGuildSettings,
  updateGuildSettings,
  preloadGuildSettings,
  getDefaultSettings
};

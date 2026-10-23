import { db } from './client.js';
import { logger } from '../utils/logger.js';
import {
  guildSettingsCache,
  getGuildSettings as cacheGetGuildSettings,
  getGuildSettingsSync as cacheGetGuildSettingsSync,
  updateGuildSettings as cacheUpdateGuildSettings,
  preloadGuildSettings as cachePreloadGuildSettings
} from '../core/cache/guildCache.js';

export const getGuildSettings = cacheGetGuildSettings;
export const getGuildSettingsSync = cacheGetGuildSettingsSync;
export const updateGuildSettings = cacheUpdateGuildSettings;
export const preloadGuildSettings = cachePreloadGuildSettings;

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
    .select('guild_id, left_at')
    .not('left_at', 'is', null)
    .lt('left_at', cutoff);

  if (error) {
    logger.error({ error }, 'Error fetching stale guilds');
    return [];
  }
  return data || [];
}

export function clearGuildSettingsCache(guildId) {
  if (guildId) guildSettingsCache.delete(guildId);
  else guildSettingsCache.clear();
}

export default {
  getGuildSettings,
  getGuildSettingsSync,
  updateGuildSettings,
  markGuildLeft,
  unmarkGuildLeft,
  getStaleGuilds,
  clearGuildSettingsCache,
  preloadGuildSettings
};

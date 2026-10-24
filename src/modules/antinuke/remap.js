import { remapIds } from '../../core/db/remap.js';

/**
 * Centrally remaps old channel IDs to newly restored channel IDs across all Supabase settings
 *
 * @param {string} guildId
 * @param {Map<string, string>|Record<string, string>} idMap Map of oldChannelId -> newChannelId
 * @returns {Promise<{ updatedCount: number }>}
 */
export async function remapChannelIds(guildId, idMap) {
  const res = await remapIds(guildId, { channels: idMap });
  return { updatedCount: res.channelsRemapped };
}

export default {
  remapChannelIds
};

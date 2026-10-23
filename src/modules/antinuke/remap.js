import { db } from '../../db/client.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { getTicketSettings, updateTicketSettings } from '../../db/tickets.js';
import { getAutoModSettings, updateAutoModSettings } from '../../db/automod.js';
import { getAntiNukeSettings, updateAntiNukeSettings } from '../../db/antinuke.js';
import { getModuleData, setModuleData } from '../../db/moduleData.js';
import { logger } from '../../utils/logger.js';

/**
 * Centrally remaps old channel IDs to newly restored channel IDs across all Supabase settings
 *
 * @param {string} guildId
 * @param {Map<string, string>|Record<string, string>} idMap Map of oldChannelId -> newChannelId
 * @returns {Promise<{ updatedCount: number }>}
 */
export async function remapChannelIds(guildId, idMap) {
  if (!guildId || !idMap) return { updatedCount: 0 };
  const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap));
  if (map.size === 0) return { updatedCount: 0 };

  let updatedCount = 0;
  const gid = String(guildId);

  try {
    // 1. guild_settings
    const gs = await getGuildSettings(gid);
    if (gs) {
      const gsUpdates = {};
      const fields = [
        'log_channel_id',
        'suggestion_channel_id',
        'feedback_channel_id',
        'boost_channel_id',
        'jtc_trigger_channel_id',
        'jtc_category_id'
      ];
      for (const f of fields) {
        if (gs[f] && map.has(gs[f])) {
          gsUpdates[f] = map.get(gs[f]);
          updatedCount++;
        }
      }
      if (Object.keys(gsUpdates).length > 0) {
        await updateGuildSettings(gid, gsUpdates);
      }
    }

    // 2. ticket_settings
    const ts = await getTicketSettings(gid);
    if (ts) {
      const tsUpdates = {};
      if (ts.channel_category_id && map.has(ts.channel_category_id)) {
        tsUpdates.channel_category_id = map.get(ts.channel_category_id);
        updatedCount++;
      }
      if (ts.log_channel_id && map.has(ts.log_channel_id)) {
        tsUpdates.log_channel_id = map.get(ts.log_channel_id);
        updatedCount++;
      }
      if (ts.transcript_channel_id && map.has(ts.transcript_channel_id)) {
        tsUpdates.transcript_channel_id = map.get(ts.transcript_channel_id);
        updatedCount++;
      }
      if (Object.keys(tsUpdates).length > 0) {
        await updateTicketSettings(gid, tsUpdates);
      }
    }

    // 3. automod_settings
    const am = await getAutoModSettings(gid);
    if (am?.log_channel_id && map.has(am.log_channel_id)) {
      await updateAutoModSettings(gid, { log_channel_id: map.get(am.log_channel_id) });
      updatedCount++;
    }

    // 4. antinuke_settings
    const an = await getAntiNukeSettings(gid);
    if (an) {
      const anUpdates = {};
      if (an.log_channel_id && map.has(an.log_channel_id)) {
        anUpdates.log_channel_id = map.get(an.log_channel_id);
        updatedCount++;
      }
      if (an.alert_channel_id && map.has(an.alert_channel_id)) {
        anUpdates.alert_channel_id = map.get(an.alert_channel_id);
        updatedCount++;
      }
      if (Object.keys(anUpdates).length > 0) {
        await updateAntiNukeSettings(gid, anUpdates);
      }
    }

    // 5. Server logs module config
    try {
      const logConfig = await getModuleData('logs', 'config', gid);
      if (logConfig?.channels) {
        let changed = false;
        for (const [cat, cid] of Object.entries(logConfig.channels)) {
          if (cid && map.has(cid)) {
            logConfig.channels[cat] = map.get(cid);
            changed = true;
            updatedCount++;
          }
        }
        if (changed) {
          await setModuleData('logs', 'config', gid, logConfig);
        }
      }
    } catch (_) {}

    // 6. ticket_panels
    try {
      const { data: panels } = await db.from('ticket_panels').select('id, channel_id').eq('guild_id', gid);
      if (Array.isArray(panels)) {
        for (const p of panels) {
          if (p.channel_id && map.has(p.channel_id)) {
            await db.from('ticket_panels').update({ channel_id: map.get(p.channel_id) }).eq('id', p.id);
            updatedCount++;
          }
        }
      }
    } catch (_) {}

    logger.info({ guildId: gid, updatedReferences: updatedCount }, 'Successfully remapped channel IDs across database settings');
  } catch (err) {
    logger.error({ err, guildId: gid }, 'Error remapping channel IDs in database');
  }

  return { updatedCount };
}

export default {
  remapChannelIds
};

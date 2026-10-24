import { db } from '../../db/client.js';
import { logger } from '../logger/index.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { getTicketSettings, updateTicketSettings } from '../../db/tickets.js';
import { getAutoModSettings, updateAutoModSettings } from '../../db/automod.js';
import { getAntiNukeSettings, updateAntiNukeSettings } from '../../db/antinuke.js';
import { getModuleData, setModuleData } from '../../db/moduleData.js';

/**
 * Universal ID Remapper
 * Remaps old channel and role IDs to newly restored IDs across all database tables.
 *
 * @param {string} guildId
 * @param {object} idMaps
 * @param {Map<string, string>|Record<string, string>} [idMaps.channels] Old Channel ID -> New Channel ID
 * @param {Map<string, string>|Record<string, string>} [idMaps.roles] Old Role ID -> New Role ID
 * @returns {Promise<{ channelsRemapped: number, rolesRemapped: number, details: Array<string> }>}
 */
export async function remapIds(guildId, { channels = new Map(), roles = new Map() } = {}) {
  if (!guildId) return { channelsRemapped: 0, rolesRemapped: 0, details: [] };

  const channelMap = channels instanceof Map ? channels : new Map(Object.entries(channels || {}));
  const roleMap = roles instanceof Map ? roles : new Map(Object.entries(roles || {}));

  if (channelMap.size === 0 && roleMap.size === 0) {
    return { channelsRemapped: 0, rolesRemapped: 0, details: [] };
  }

  const gid = String(guildId);
  let channelsRemapped = 0;
  let rolesRemapped = 0;
  const details = [];

  try {
    // 1. guild_settings (Channels & Roles)
    const gs = await getGuildSettings(gid).catch(() => null);
    if (gs) {
      const updates = {};
      const chanFields = [
        'log_channel_id',
        'suggestion_channel_id',
        'feedback_channel_id',
        'boost_channel_id',
        'jtc_trigger_channel_id',
        'jtc_category_id'
      ];
      for (const f of chanFields) {
        if (gs[f] && channelMap.has(gs[f])) {
          updates[f] = channelMap.get(gs[f]);
          channelsRemapped++;
          details.push(`guild_settings.${f} -> ${updates[f]}`);
        }
      }

      const roleFields = ['staff_role_id', 'backup_role_id', 'boost_role_id', 'autorole_member_role_id', 'autorole_bot_role_id'];
      for (const rf of roleFields) {
        if (gs[rf] && roleMap.has(gs[rf])) {
          updates[rf] = roleMap.get(gs[rf]);
          rolesRemapped++;
          details.push(`guild_settings.${rf} -> ${updates[rf]}`);
        }
      }

      // Role arrays (sticky_role_ids, autorole_member_role_ids)
      if (Array.isArray(gs.sticky_role_ids)) {
        const remapped = gs.sticky_role_ids.map(id => roleMap.get(id) || id);
        if (JSON.stringify(remapped) !== JSON.stringify(gs.sticky_role_ids)) {
          updates.sticky_role_ids = remapped;
          rolesRemapped++;
          details.push(`guild_settings.sticky_role_ids updated`);
        }
      }
      if (Array.isArray(gs.autorole_member_role_ids)) {
        const remapped = gs.autorole_member_role_ids.map(id => roleMap.get(id) || id);
        if (JSON.stringify(remapped) !== JSON.stringify(gs.autorole_member_role_ids)) {
          updates.autorole_member_role_ids = remapped;
          rolesRemapped++;
          details.push(`guild_settings.autorole_member_role_ids updated`);
        }
      }

      if (Object.keys(updates).length > 0) {
        await updateGuildSettings(gid, updates);
      }
    }

    // 2. ticket_settings
    const ts = await getTicketSettings(gid).catch(() => null);
    if (ts) {
      const tsUpdates = {};
      if (ts.channel_category_id && channelMap.has(ts.channel_category_id)) {
        tsUpdates.channel_category_id = channelMap.get(ts.channel_category_id);
        channelsRemapped++;
      }
      if (ts.log_channel_id && channelMap.has(ts.log_channel_id)) {
        tsUpdates.log_channel_id = channelMap.get(ts.log_channel_id);
        channelsRemapped++;
      }
      if (ts.transcript_channel_id && channelMap.has(ts.transcript_channel_id)) {
        tsUpdates.transcript_channel_id = channelMap.get(ts.transcript_channel_id);
        channelsRemapped++;
      }
      if (ts.support_role_id && roleMap.has(ts.support_role_id)) {
        tsUpdates.support_role_id = roleMap.get(ts.support_role_id);
        rolesRemapped++;
      }
      if (Object.keys(tsUpdates).length > 0) {
        await updateTicketSettings(gid, tsUpdates);
      }
    }

    // 3. ticket_panels
    if (channelMap.size > 0) {
      try {
        const { data: panels } = await db.from('ticket_panels').select('id, channel_id').eq('guild_id', gid);
        if (Array.isArray(panels)) {
          for (const p of panels) {
            if (p.channel_id && channelMap.has(p.channel_id)) {
              await db.from('ticket_panels').update({ channel_id: channelMap.get(p.channel_id) }).eq('id', p.id);
              channelsRemapped++;
              details.push(`ticket_panel:${p.id} -> ${channelMap.get(p.channel_id)}`);
            }
          }
        }
      } catch (_) {}
    }

    // 4. automod_settings
    const am = await getAutoModSettings(gid).catch(() => null);
    if (am) {
      const amUpdates = {};
      if (am.log_channel_id && channelMap.has(am.log_channel_id)) {
        amUpdates.log_channel_id = channelMap.get(am.log_channel_id);
        channelsRemapped++;
      }
      if (am.exception_role_id && roleMap.has(am.exception_role_id)) {
        amUpdates.exception_role_id = roleMap.get(am.exception_role_id);
        rolesRemapped++;
      }
      if (Array.isArray(am.ignored_role_ids)) {
        const remapped = am.ignored_role_ids.map(id => roleMap.get(id) || id);
        if (JSON.stringify(remapped) !== JSON.stringify(am.ignored_role_ids)) {
          amUpdates.ignored_role_ids = remapped;
          rolesRemapped++;
        }
      }
      if (Object.keys(amUpdates).length > 0) {
        await updateAutoModSettings(gid, amUpdates);
      }
    }

    // 5. antinuke_settings
    const an = await getAntiNukeSettings(gid).catch(() => null);
    if (an) {
      const anUpdates = {};
      if (an.log_channel_id && channelMap.has(an.log_channel_id)) {
        anUpdates.log_channel_id = channelMap.get(an.log_channel_id);
        channelsRemapped++;
      }
      if (an.alert_channel_id && channelMap.has(an.alert_channel_id)) {
        anUpdates.alert_channel_id = channelMap.get(an.alert_channel_id);
        channelsRemapped++;
      }
      if (an.ping_role_id && roleMap.has(an.ping_role_id)) {
        anUpdates.ping_role_id = roleMap.get(an.ping_role_id);
        rolesRemapped++;
      }
      if (Object.keys(anUpdates).length > 0) {
        await updateAntiNukeSettings(gid, anUpdates);
      }
    }

    // 6. antinuke_exempt
    if (channelMap.size > 0) {
      try {
        for (const [oldId, newId] of channelMap.entries()) {
          await db.from('antinuke_exempt')
            .update({ target_id: newId })
            .eq('guild_id', gid)
            .eq('target_id', oldId);
        }
      } catch (_) {}
    }

    // 7. antinuke_trusted (roles)
    if (roleMap.size > 0) {
      try {
        for (const [oldId, newId] of roleMap.entries()) {
          await db.from('antinuke_trusted')
            .update({ target_id: newId })
            .eq('guild_id', gid)
            .eq('target_id', oldId)
            .eq('target_type', 'role');
        }
      } catch (_) {}
    }


    // 8. shop_products (channels and role rewards)
    try {
      const { data: prods } = await db.from('shop_products').select('id, channel_id, role_id').eq('guild_id', gid);
      if (Array.isArray(prods)) {
        for (const p of prods) {
          const updates = {};
          if (p.channel_id && channelMap.has(p.channel_id)) {
            updates.channel_id = channelMap.get(p.channel_id);
            channelsRemapped++;
          }
          if (p.role_id && roleMap.has(p.role_id)) {
            updates.role_id = roleMap.get(p.role_id);
            rolesRemapped++;
          }
          if (Object.keys(updates).length > 0) {
            await db.from('shop_products').update(updates).eq('id', p.id);
          }
        }
      }
    } catch (_) {}

    // 9. sticky_messages
    if (channelMap.size > 0) {
      try {
        const { data: stickies } = await db.from('sticky_messages').select('id, channel_id').eq('guild_id', gid);
        if (Array.isArray(stickies)) {
          for (const s of stickies) {
            if (s.channel_id && channelMap.has(s.channel_id)) {
              await db.from('sticky_messages').update({ channel_id: channelMap.get(s.channel_id) }).eq('id', s.id);
              channelsRemapped++;
            }
          }
        }
      } catch (_) {}
    }

    // 10. Module data (logs config)
    try {
      const logConfig = await getModuleData('logs', 'config', gid);
      if (logConfig?.channels) {
        let changed = false;
        for (const [cat, cid] of Object.entries(logConfig.channels)) {
          if (cid && channelMap.has(cid)) {
            logConfig.channels[cat] = channelMap.get(cid);
            changed = true;
            channelsRemapped++;
          }
        }
        if (changed) {
          await setModuleData('logs', 'config', gid, logConfig);
        }
      }
    } catch (_) {}

    logger.info(`[REMAP] Remapped ${channelsRemapped} channel(s) and ${rolesRemapped} role(s) for guild ${gid}`);
  } catch (err) {
    logger.error({ err, guildId: gid }, 'Error during universal ID remapping');
  }

  return { channelsRemapped, rolesRemapped, details };
}

export default {
  remapIds
};

import { logAudit } from '../db/audit.js';
import { logger } from '../utils/logger.js';
import { refreshGuildAutoModCache } from '../db/automod.js';
import { refreshGuildAntiNukeCache } from '../db/antinuke.js';
import { handleGuildCreate } from '../core/guilds/reconcile.js';

export async function onGuildCreate(guild) {
  // Reconcile settings and initialize defaults without overwriting
  await handleGuildCreate(guild);

  // Initialize and refresh AutoMod & Anti-Nuke protection caches for new guild
  await refreshGuildAutoModCache(guild.id).catch(() => {});
  await refreshGuildAntiNukeCache(guild.id).catch(() => {});

  await logAudit({
    guildId: guild.id,
    userId: guild.ownerId,
    action: 'BOT_JOINED_GUILD',
    details: {
      guildName: guild.name,
      memberCount: guild.memberCount
    }
  }).catch(() => {});
}


import { unmarkGuildLeft, getGuildSettings } from '../db/guilds.js';
import { logAudit } from '../db/audit.js';
import { logger } from '../utils/logger.js';
import { refreshGuildAutoModCache } from '../db/automod.js';
import { refreshGuildAntiNukeCache, saveAllChannelSnapshots } from '../db/antinuke.js';

export async function onGuildCreate(guild) {
  logger.info(`Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

  // If the guild was previously marked left, clear the left_at timestamp to cancel auto-deletion
  await unmarkGuildLeft(guild.id);

  // Initialize and refresh AutoMod & Anti-Nuke protection caches for new guild
  await refreshGuildAutoModCache(guild.id).catch(() => {});
  await refreshGuildAntiNukeCache(guild.id).catch(() => {});
  await saveAllChannelSnapshots(guild).catch(() => {});

  await logAudit({
    guildId: guild.id,
    userId: guild.ownerId,
    action: 'BOT_JOINED_GUILD',
    details: {
      guildName: guild.name,
      memberCount: guild.memberCount
    }
  });
}

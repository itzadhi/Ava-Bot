import { unmarkGuildLeft, getGuildSettings } from '../db/guilds.js';
import { logAudit } from '../db/audit.js';
import { logger } from '../utils/logger.js';

export async function onGuildCreate(guild) {
  logger.info(`Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

  // If the guild was previously marked left, clear the left_at timestamp to cancel auto-deletion
  await unmarkGuildLeft(guild.id);

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

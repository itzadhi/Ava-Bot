import { markGuildLeft } from '../db/guilds.js';
import { logAudit } from '../db/audit.js';
import { logger } from '../utils/logger.js';

export async function onGuildDelete(guild) {
  logger.info(`Departed guild: ${guild.name} (${guild.id}). Starting 30-day retention countdown.`);

  // Mark left_at for 30-day automatic deletion job
  await markGuildLeft(guild.id);

  await logAudit({
    guildId: guild.id,
    userId: guild.ownerId || '0',
    action: 'BOT_LEFT_GUILD',
    details: {
      guildName: guild.name,
      scheduledDeletionDays: 30
    }
  });
}

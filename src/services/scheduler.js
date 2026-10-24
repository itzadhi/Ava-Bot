import cron from 'node-cron';
import { getAllActiveIntervals, setBackupInterval, getOldestUnlockedAutoBackups, deleteBackupRecord } from '../db/backups.js';
import { createServerBackup } from '../modules/backup/creator.js';
import { deleteSnapshot } from '../db/storage.js';
import { getStaleGuilds, clearGuildSettingsCache } from '../db/guilds.js';
import { getExpiredChatlogs, deleteChatlogRecord } from '../db/chatlogs.js';
import { db } from '../db/client.js';
import { logger } from '../utils/logger.js';

let cronJob = null;

/**
 * Executes a single interval backup check across all registered guilds
 * @param {import('discord.js').Client} client 
 */
export async function runIntervalCheck(client) {
  logger.trace('Running backup interval check...');
  const activeIntervals = await getAllActiveIntervals();

  for (const interval of activeIntervals) {
    try {
      const guild = client.guilds.cache.get(interval.guild_id);
      if (!guild) continue;

      const now = Date.now();
      const lastRun = interval.last_run ? new Date(interval.last_run).getTime() : 0;
      const intervalMs = (interval.interval_hours || 24) * 60 * 60 * 1000;

      if (now - lastRun >= intervalMs) {
        logger.info(`Triggering automated backup for guild "${guild.name}" (${guild.id})`);

        // Create automated backup
        await createServerBackup({
          guild,
          user: client.user,
          name: `AutoBackup-${new Date().toISOString().slice(0, 10)}`,
          isAuto: true
        });

        // Rotate oldest auto-backups if exceeding max_backups, skipping locked ones
        const toRotate = await getOldestUnlockedAutoBackups(guild.id, interval.max_backups || 5);
        for (const oldBackup of toRotate) {
          logger.info(`Rotating oldest unlocked backup ${oldBackup.id} (${oldBackup.name}) for guild ${guild.id}`);
          await deleteSnapshot(oldBackup.storage_path);
          await deleteBackupRecord(oldBackup.id);
        }

        // Update last_run
        await setBackupInterval(guild.id, {
          interval_hours: interval.interval_hours,
          max_backups: interval.max_backups,
          enabled: true,
          last_run: new Date(now).toISOString()
        });
      }
    } catch (err) {
      logger.error({ err, guildId: interval.guild_id }, 'Error running auto-backup for guild');
    }
  }
}

/**
 * Cleans expired chatlogs (90 days TTL)
 */
export async function runChatlogRetentionCheck() {
  try {
    const expired = await getExpiredChatlogs();
    if (expired.length > 0) {
      logger.info(`Cleaning ${expired.length} expired chatlog records...`);
      for (const log of expired) {
        await deleteSnapshot(log.storage_path);
        await deleteChatlogRecord(log.id);
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error during chatlog retention cleanup');
  }
}

/**
 * Permanently deletes guild data for guilds departed >30 days ago
 */
export async function runGuildRetentionCheck() {
  try {
    const staleGuilds = await getStaleGuilds(30);
    for (const g of staleGuilds) {
      logger.info(`Permanently wiping data for stale guild ${g.guild_id} (departed >30 days ago)`);
      // Delete backups
      const { data: bks } = await db.from('backups').select('storage_path').eq('guild_id', g.guild_id);
      if (bks) {
        for (const b of bks) await deleteSnapshot(b.storage_path);
      }
      await db.from('backups').delete().eq('guild_id', g.guild_id);

      // Delete chatlogs
      const { data: logs } = await db.from('chatlogs').select('storage_path').eq('guild_id', g.guild_id);
      if (logs) {
        for (const l of logs) await deleteSnapshot(l.storage_path);
      }
      await db.from('chatlogs').delete().eq('guild_id', g.guild_id);

      // Delete templates, syncs, settings
      await db.from('templates').delete().eq('guild_id', g.guild_id);
      await db.from('syncs').delete().eq('source_guild', g.guild_id);
      await db.from('syncs').delete().eq('target_guild', g.guild_id);
      await db.from('backup_intervals').delete().eq('guild_id', g.guild_id);
      await db.from('guild_settings').delete().eq('guild_id', g.guild_id);
      clearGuildSettingsCache(g.guild_id);
    }
  } catch (err) {
    logger.error({ err }, 'Error during stale guild retention cleanup');
  }
}

/**
 * Starts the central background cron scheduler
 * @param {import('discord.js').Client} client 
 */
export function startScheduler(client) {
  if (cronJob) return;

  // Run every 15 minutes
  cronJob = cron.schedule('*/15 * * * *', async () => {
    await runIntervalCheck(client);
    await runChatlogRetentionCheck();
    await runGuildRetentionCheck();
  });

  logger.info('AVA background scheduler initialized (interval: */15 * * * *)');
}

/**
 * Stops the cron scheduler during graceful shutdown
 */
export function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('AVA background scheduler stopped');
  }
}

export default { startScheduler, stopScheduler, runIntervalCheck, runChatlogRetentionCheck, runGuildRetentionCheck };

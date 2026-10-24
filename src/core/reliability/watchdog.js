import { getEventLoopLagMs } from '../interactions/trace.js';
import { boundedStructures } from './boundedStructures.js';
import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { metrics } from '../metrics.js';

let degradedCycles = 0;
let watchdogInterval = null;
let dailyMaintenanceInterval = null;

/**
 * Starts 30-day continuous self-healing reliability watchdog
 *
 * @param {import('discord.js').Client} client
 * @param {object} [options={}]
 * @param {number} [options.cgroupLimitMb]
 */
export function startReliabilityWatchdog(client, options = {}) {
  const cgroupLimitMb = options.cgroupLimitMb || 1024; // Default 1GB panel limit

  // 1. Health check ticker running every 30 seconds
  watchdogInterval = setInterval(() => {
    try {
      const loopLag = getEventLoopLagMs();
      const memUsage = process.memoryUsage();
      const rssMb = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsedMb = Math.round(memUsage.heapUsed / 1024 / 1024);
      const memPct = Math.round((rssMb / cgroupLimitMb) * 100);

      // Check structure stats
      boundedStructures.getStats();

      // Degraded indicators:
      // Loop lag > 200ms
      // Memory > 90% of cgroup limit
      const isLagging = loopLag > 200;
      const isMemoryCritical = memPct >= 90;

      if (isLagging || isMemoryCritical) {
        degradedCycles++;
        logger.warn({
          degradedCycles,
          loopLagMs: loopLag,
          rssMb,
          cgroupLimitMb,
          memPct
        }, '⚠️ Bot reliability degradation detected');

        // First step: Proactive self-healing cleanup
        boundedStructures.emergencySweep();
        if (typeof global.gc === 'function') {
          global.gc();
          logger.info('Invoked global garbage collector (V8 GC)');
        }

        // If degraded continuously for 6 cycles (3 minutes) even after cleanup:
        if (degradedCycles >= 6) {
          logger.fatal({
            reason: 'PERSISTENT_DEGRADATION',
            degradedCycles,
            loopLag,
            rssMb
          }, 'Exiting cleanly for Pterodactyl container auto-restart due to persistent resource exhaustion');
          process.exit(1);
        }
      } else {
        degradedCycles = Math.max(0, degradedCycles - 1);
      }
    } catch (_) {}
  }, 30000);

  if (watchdogInterval.unref) watchdogInterval.unref();

  // 2. Low-priority daily maintenance job (runs every 24 hours)
  dailyMaintenanceInterval = setInterval(async () => {
    try {
      logger.info('Starting daily scheduled maintenance job (pruning expired records & logs)');
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // Prune old completed/failed background jobs older than 7 days
      await db.from('ava_jobs')
        .delete()
        .in('state', ['completed', 'failed', 'cancelled'])
        .lt('created_at', sevenDaysAgo)
        .catch(() => {});

      // Prune old antinuke incidents older than 30 days
      await db.from('antinuke_incidents')
        .delete()
        .lt('created_at', thirtyDaysAgo)
        .catch(() => {});

      // Prune old error logs older than 7 days
      await db.from('error_logs')
        .delete()
        .lt('created_at', sevenDaysAgo)
        .catch(() => {});

      logger.info('✓ Daily maintenance completed successfully');
    } catch (err) {
      logger.warn({ err: err.message }, 'Non-fatal error in daily maintenance job');
    }
  }, 24 * 60 * 60 * 1000);

  if (dailyMaintenanceInterval.unref) dailyMaintenanceInterval.unref();

  return {
    watchdogInterval,
    dailyMaintenanceInterval
  };
}

/**
 * Cleanly stops watchdog on shutdown
 */
export function stopReliabilityWatchdog() {
  if (watchdogInterval) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
  if (dailyMaintenanceInterval) {
    clearInterval(dailyMaintenanceInterval);
    dailyMaintenanceInterval = null;
  }
}

export default {
  startReliabilityWatchdog,
  stopReliabilityWatchdog
};

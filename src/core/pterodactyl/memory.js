import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import { guildSettingsCache } from '../cache/guildCache.js';

let containerMemoryLimitBytes = null;
let memoryCheckInterval = null;

/**
 * Detects container memory limit from Linux cgroups or environment variable
 * @returns {number|null} Memory limit in bytes or null if unconstrained
 */
export function getContainerMemoryLimit() {
  if (containerMemoryLimitBytes !== null) {
    return containerMemoryLimitBytes;
  }

  // 1. Check MEMORY env var (set by some panels in MB)
  if (process.env.MEMORY && !isNaN(process.env.MEMORY)) {
    const mb = parseFloat(process.env.MEMORY);
    if (mb > 0) {
      containerMemoryLimitBytes = Math.floor(mb * 1024 * 1024);
      return containerMemoryLimitBytes;
    }
  }

  // 2. Check cgroup v2 (Modern Docker & systemd)
  try {
    const cgroupV2Path = '/sys/fs/cgroup/memory.max';
    if (fs.existsSync(cgroupV2Path)) {
      const val = fs.readFileSync(cgroupV2Path, 'utf8').trim();
      if (val !== 'max' && !isNaN(val)) {
        containerMemoryLimitBytes = parseInt(val, 10);
        return containerMemoryLimitBytes;
      }
    }
  } catch (_) {}

  // 3. Check cgroup v1 (Legacy Docker)
  try {
    const cgroupV1Path = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
    if (fs.existsSync(cgroupV1Path)) {
      const val = fs.readFileSync(cgroupV1Path, 'utf8').trim();
      const num = parseInt(val, 10);
      // cgroup v1 unconstrained is typically >= 9223372036854771712
      if (!isNaN(num) && num < 1099511627776) { // < 1TB
        containerMemoryLimitBytes = num;
        return containerMemoryLimitBytes;
      }
    }
  } catch (_) {}

  // Unconstrained / local dev default to 1GB virtual ceiling for safety
  return 1024 * 1024 * 1024;
}

/**
 * Gets current memory consumption statistics
 */
export function getMemoryStats() {
  const mem = process.memoryUsage();
  const limitBytes = getContainerMemoryLimit() || (1024 * 1024 * 1024);
  const rssBytes = mem.rss;
  const usagePercent = Math.min(100, Math.round((rssBytes / limitBytes) * 1000) / 10);

  return {
    rssMb: Math.round((mem.rss / 1024 / 1024) * 100) / 100,
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMb: Math.round((mem.heapTotal / 1024 / 1024) * 100) / 100,
    limitMb: Math.round((limitBytes / 1024 / 1024) * 100) / 100,
    usagePercent,
    isConstrained: usagePercent >= 80,
    isCritical: usagePercent >= 90
  };
}

/**
 * Trims in-memory LRU and cache structures to avoid container OOM
 */
export function trimMemoryCaches() {
  const statsBefore = getMemoryStats();
  try {
    if (typeof guildSettingsCache?.clear === 'function') {
      guildSettingsCache.clear();
    }
    if (typeof globalThis.gc === 'function') {
      globalThis.gc();
    }
    logger.warn({ beforeMb: statsBefore.rssMb }, 'Trimmed in-memory guild caches due to container memory ceiling');
  } catch (err) {
    logger.error({ err }, 'Error trimming memory caches');
  }
}

/**
 * Starts continuous background memory monitor
 */
export function startMemoryMonitor(intervalMs = 30000) {
  if (memoryCheckInterval) return;

  memoryCheckInterval = setInterval(() => {
    const stats = getMemoryStats();
    if (stats.isCritical) {
      logger.warn({ usagePercent: `${stats.usagePercent}%`, rssMb: stats.rssMb, limitMb: stats.limitMb }, 'CRITICAL: Container memory >=90%. Evicting caches to prevent OOM.');
      trimMemoryCaches();
    } else if (stats.isConstrained) {
      logger.warn({ usagePercent: `${stats.usagePercent}%`, rssMb: stats.rssMb }, 'WARNING: Container memory usage >=80%.');
    }
  }, intervalMs);

  memoryCheckInterval.unref();
}

export function stopMemoryMonitor() {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
}

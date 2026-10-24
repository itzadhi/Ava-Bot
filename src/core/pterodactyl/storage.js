import fs from 'node:fs';
import path from 'node:path';

const LOGS_DIR = path.resolve('logs');
const MAX_LOG_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB total disk cap
const MAX_LOG_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Enforces bounded disk usage for the logs/ directory.
 * Removes log files older than 3 days, and if total directory size > 20MB,
 * prunes oldest logs first until size is under 15MB.
 */
export function pruneLogsDirectory() {
  if (!fs.existsSync(LOGS_DIR)) {
    return { prunedCount: 0, totalSizeBytes: 0 };
  }

  try {
    const entries = fs.readdirSync(LOGS_DIR, { withFileTypes: true });
    const now = Date.now();
    let files = [];

    for (const ent of entries) {
      if (ent.isFile() && (ent.name.endsWith('.log') || ent.name.endsWith('.ndjson') || ent.name.endsWith('.json'))) {
        const full = path.join(LOGS_DIR, ent.name);
        try {
          const stat = fs.statSync(full);
          files.push({
            name: ent.name,
            full,
            size: stat.size,
            mtimeMs: stat.mtimeMs
          });
        } catch (_) {}
      }
    }

    let prunedCount = 0;

    // 1. Remove files older than 3 days (preserve last-crash.json)
    files = files.filter(f => {
      if (f.name === 'last-crash.json') return true;
      if (now - f.mtimeMs > MAX_LOG_AGE_MS) {
        try {
          fs.unlinkSync(f.full);
          prunedCount++;
          return false;
        } catch (_) {
          return true;
        }
      }
      return true;
    });

    // 2. Check total size cap (20MB)
    let totalSizeBytes = files.reduce((acc, f) => acc + f.size, 0);

    if (totalSizeBytes > MAX_LOG_SIZE_BYTES) {
      // Sort oldest first
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);

      for (const f of files) {
        if (f.name === 'last-crash.json') continue;
        try {
          fs.unlinkSync(f.full);
          totalSizeBytes -= f.size;
          prunedCount++;
          if (totalSizeBytes <= MAX_LOG_SIZE_BYTES * 0.75) {
            break;
          }
        } catch (_) {}
      }
    }

    return { prunedCount, totalSizeBytes };
  } catch (_) {
    return { prunedCount: 0, totalSizeBytes: 0 };
  }
}

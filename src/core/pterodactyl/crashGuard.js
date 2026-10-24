import fs from 'node:fs';
import path from 'node:path';
import { printCrashHeader } from '../logger/banner.js';

const LOGS_DIR = path.resolve('logs');
const CRASH_HISTORY_FILE = path.join(LOGS_DIR, 'crash-history.json');
const LAST_CRASH_FILE = path.join(LOGS_DIR, 'last-crash.json');

const CRASH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_FAST_CRASHES = 3;

function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
}

/**
 * Checks crash loop history and returns backoff delay in ms if needed
 * @returns {Promise<number>} Delay in milliseconds to wait before proceeding
 */
export async function checkCrashLoopGuard() {
  ensureLogsDir();
  if (!fs.existsSync(CRASH_HISTORY_FILE)) {
    return 0;
  }

  try {
    const raw = fs.readFileSync(CRASH_HISTORY_FILE, 'utf8');
    const history = JSON.parse(raw);
    const now = Date.now();

    // Filter crashes within the last 5 minutes
    const recent = (Array.isArray(history) ? history : []).filter(ts => now - ts < CRASH_WINDOW_MS);

    if (recent.length >= MAX_FAST_CRASHES) {
      const exponent = recent.length - MAX_FAST_CRASHES;
      const backoffSecs = Math.min(60, 5 * Math.pow(2, exponent));
      printCrashHeader({
        reason: `Crash loop protection (${recent.length} crashes in 5m)`,
        restartDelaySec: backoffSecs
      });
      return backoffSecs * 1000;
    }
  } catch (_) {}

  return 0;
}

/**
 * Records a crash event into persistent history
 * @param {Error|object|string} reason
 */
export function recordCrash(reason) {
  ensureLogsDir();
  const now = Date.now();
  const errorObj = {
    timestamp: new Date(now).toISOString(),
    message: reason?.message || String(reason),
    stack: reason?.stack || null
  };

  try {
    fs.writeFileSync(LAST_CRASH_FILE, JSON.stringify(errorObj, null, 2), 'utf8');

    let history = [];
    if (fs.existsSync(CRASH_HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(CRASH_HISTORY_FILE, 'utf8'));
      } catch (_) {}
    }
    history.push(now);
    // Keep only last 20 timestamps
    history = history.filter(ts => now - ts < 24 * 60 * 60 * 1000).slice(-20);
    fs.writeFileSync(CRASH_HISTORY_FILE, JSON.stringify(history), 'utf8');
  } catch (_) {}
}

/**
 * Clears crash loop history on successful login and stable run
 */
export function markCleanStartup() {
  ensureLogsDir();
  try {
    if (fs.existsSync(CRASH_HISTORY_FILE)) {
      fs.unlinkSync(CRASH_HISTORY_FILE);
    }
  } catch (_) {}
}

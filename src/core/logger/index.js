import fs from 'node:fs';
import path from 'node:path';
import { ANSI, colorize } from './palette.js';
import { printStartupHeader, printBootStep, printOnlineFrame } from './banner.js';
import { pruneLogsDirectory } from '../pterodactyl/storage.js';

const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  success: 35,
  warn: 40,
  error: 50,
  fatal: 60
};

const CURRENT_LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LOG_LEVELS.info;

// Patterns to sanitize from log output
const REDACT_PATTERNS = [
  /bot\s+[a-zA-Z0-9_\-\.]{50,}/gi,
  /[a-zA-Z0-9_\-]{24}\.[a-zA-Z0-9_\-]{6}\.[a-zA-Z0-9_\-]{27}/g,
  /eyJ[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}\.[a-zA-Z0-9_\-]{20,}/g, // JWT
  /(password|secret|token|api_key|service_role)=['"][^'"]+['"]/gi
];

function sanitize(msg) {
  if (typeof msg !== 'string') return msg;
  let clean = msg;
  for (const re of REDACT_PATTERNS) {
    clean = clean.replace(re, '[REDACTED_SECRET]');
  }
  return clean;
}

class UniversalLogger {
  constructor(bindings = {}) {
    this.bindings = bindings;
    this.lastTimestamp = Date.now();
    this.logsDir = path.resolve('logs');
    this.fileBuffer = [];
    this.flushTimer = null;
    this.heartbeatTimer = null;
    this.ensureLogDir();
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logsDir)) {
      try {
        fs.mkdirSync(this.logsDir, { recursive: true });
      } catch (_) {}
    }
  }

  child(extraBindings = {}) {
    return new UniversalLogger({ ...this.bindings, ...extraBindings });
  }

  formatTime() {
    const d = new Date();
    return d.toTimeString().split(' ')[0];
  }

  getBadge(level) {
    switch (level) {
      case 'trace':
        return colorize(ANSI.gray, ' TRACE ');
      case 'debug':
        return colorize(ANSI.sky, ' DEBUG ');
      case 'info':
        return colorize(ANSI.mint, '  INF  ');
      case 'success':
        return colorize(ANSI.pink, '  OK   ');
      case 'warn':
        return colorize(ANSI.butter, '  WRN  ');
      case 'error':
        return colorize(ANSI.rose, '  ERR  ');
      case 'fatal':
        return colorize(ANSI.bold + ANSI.bgRose, ' FATAL ');
      default:
        return '       ';
    }
  }

  writeLine(level, meta, message) {
    if (LOG_LEVELS[level] < CURRENT_LOG_LEVEL) return;

    const now = Date.now();
    const delta = now - this.lastTimestamp;
    this.lastTimestamp = now;

    const timeStr = colorize(ANSI.dim + ANSI.gray, this.formatTime());
    const badge = this.getBadge(level);

    // Module tag
    const moduleName = meta.module || this.bindings.module || meta.scope || this.bindings.scope || 'SYSTEM';
    const modulePill = colorize(ANSI.lavender, `[${moduleName.padEnd(8).slice(0, 8)}]`);

    // Delta time
    const deltaStr = delta > 0 && delta < 60000 ? colorize(ANSI.dim + ANSI.gray, `+${delta}ms`) : '';

    // Cleaned message
    const cleanMsg = sanitize(typeof message === 'string' ? message : (message.message || JSON.stringify(message)));

    console.log(`${timeStr}  ${badge}  ${modulePill}  ${cleanMsg}  ${deltaStr}`);

    // If meta has error object with stack trace, render with pink gutter
    if (meta.err && meta.err.stack) {
      const stackLines = meta.err.stack.split('\n').slice(1, 4);
      for (const sl of stackLines) {
        console.log(`          ${colorize(ANSI.pink, '│')}  ${colorize(ANSI.dim + ANSI.rose, sl.trim())}`);
      }
    }

    // Write to async buffered NDJSON file
    this.appendToFile({
      timestamp: new Date().toISOString(),
      level,
      module: moduleName,
      message: cleanMsg,
      meta: sanitize(JSON.stringify(meta))
    });
  }

  appendToFile(record) {
    this.fileBuffer.push(JSON.stringify(record) + '\n');
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushFileBuffer(), 1000);
      if (this.flushTimer.unref) this.flushTimer.unref();
    }
  }

  flushFileBuffer() {
    this.flushTimer = null;
    if (this.fileBuffer.length === 0) return;

    const dateStr = new Date().toISOString().split('T')[0];
    const logFilePath = path.join(this.logsDir, `ava-${dateStr}.ndjson`);
    const dataToWrite = this.fileBuffer.join('');
    this.fileBuffer = [];

    try {
      fs.appendFileSync(logFilePath, dataToWrite, 'utf8');
      pruneLogsDirectory();
    } catch (_) {}
  }

  trace(meta, msg) { this.write(meta, msg, 'trace'); }
  debug(meta, msg) { this.write(meta, msg, 'debug'); }
  info(meta, msg) { this.write(meta, msg, 'info'); }
  success(meta, msg) { this.write(meta, msg, 'success'); }
  warn(meta, msg) { this.write(meta, msg, 'warn'); }
  error(meta, msg) { this.write(meta, msg, 'error'); }
  fatal(meta, msg) { this.write(meta, msg, 'fatal'); }

  write(meta, msg, level) {
    if (typeof meta === 'string') {
      this.writeLine(level, {}, meta);
    } else {
      this.writeLine(level, meta || {}, msg || '');
    }
  }

  banner() {
    printStartupHeader();
  }

  bootStep(label, durationMs) {
    printBootStep(label, durationMs);
  }

  ready({ tag, id, guilds, ping, memoryMb }) {
    printOnlineFrame({ tag, id, guilds, ping, memoryMb });
  }

  startHeartbeat(client, intervalMs = 5 * 60 * 1000) {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const uptimeSec = Math.floor(process.uptime());
      const hours = Math.floor(uptimeSec / 3600);
      const mins = Math.floor((uptimeSec % 3600) / 60);
      const ping = client?.ws?.ping !== undefined ? Math.round(client.ws.ping) : -1;
      const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const guilds = client?.guilds?.cache?.size || 0;

      this.info(
        { module: 'AVA' },
        `🌸 Heartbeat: Uptime ${hours}h ${mins}m · Guilds: ${guilds} · Ping: ${ping}ms · RSS: ${memMb}MB`
      );
    }, intervalMs);
    this.heartbeatTimer.unref();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const logger = new UniversalLogger();
export default logger;

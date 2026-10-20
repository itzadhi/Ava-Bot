import pino from 'pino';
import { Writable } from 'node:stream';
import { config } from '../config.js';

const isDev = config.NODE_ENV === 'development';

// ANSI terminal colors and styles
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[90m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  cyan: '\x1b[36m',
  brightCyan: '\x1b[96m',
  green: '\x1b[32m',
  brightGreen: '\x1b[92m',
  yellow: '\x1b[33m',
  brightYellow: '\x1b[93m',
  red: '\x1b[31m',
  brightRed: '\x1b[91m',
  magenta: '\x1b[35m',
  brightMagenta: '\x1b[95m',
  blue: '\x1b[34m',
  brightBlue: '\x1b[94m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
  bgCyan: '\x1b[46m\x1b[30m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgYellow: '\x1b[43m\x1b[30m',
  bgRed: '\x1b[41m\x1b[97m',
  bgMagenta: '\x1b[45m\x1b[97m',
  bgBlue: '\x1b[44m\x1b[97m',
  bgDark: '\x1b[100m\x1b[97m'
};

const levelStyles = {
  10: { badge: `${c.bgDark}${c.bold} TRC ${c.reset}`, color: c.gray, label: 'TRACE' },
  20: { badge: `${c.bgDark}${c.bold} DBG ${c.reset}`, color: c.dim, label: 'DEBUG' },
  30: { badge: `${c.bgCyan}${c.bold} INF ${c.reset}`, color: c.cyan, label: 'INFO' },
  40: { badge: `${c.bgYellow}${c.bold} WRN ${c.reset}`, color: c.yellow, label: 'WARN' },
  50: { badge: `${c.bgRed}${c.bold} ERR ${c.reset}`, color: c.red, label: 'ERROR' },
  60: { badge: `${c.bgMagenta}${c.bold} CRT ${c.reset}`, color: c.magenta, label: 'FATAL' }
};

const scopeColors = {
  GATEWAY: c.brightCyan,
  DATABASE: c.brightGreen,
  SUPABASE: c.brightGreen,
  COMMANDS: c.brightMagenta,
  BACKUP: c.brightBlue,
  'CHAT-VAULT': c.cyan,
  SYNC: c.brightYellow,
  SCHEDULER: c.magenta,
  SECURITY: c.red,
  SYSTEM: c.gray
};

/**
 * Detects category scope from log message or data
 * @param {string} msg
 * @param {object} data
 * @returns {string}
 */
function detectScope(msg = '', data = {}) {
  if (data.scope) return String(data.scope).toUpperCase();
  const lower = msg.toLowerCase();
  if (lower.includes('gateway') || lower.includes('discord') || lower.includes('logged in')) return 'GATEWAY';
  if (lower.includes('supabase') || lower.includes('database') || lower.includes('postgres')) return 'DATABASE';
  if (lower.includes('backup') || lower.includes('snapshot')) return 'BACKUP';
  if (lower.includes('chatlog') || lower.includes('vault') || lower.includes('chat restoration')) return 'CHAT-VAULT';
  if (lower.includes('command') || lower.includes('slash') || lower.includes('prefix')) return 'COMMANDS';
  if (lower.includes('sync')) return 'SYNC';
  if (lower.includes('scheduler') || lower.includes('cron') || lower.includes('timer')) return 'SCHEDULER';
  if (lower.includes('permission') || lower.includes('unauthorized') || lower.includes('blacklist')) return 'SECURITY';
  return 'SYSTEM';
}

/**
 * Formats a single Pino log JSON record into beautiful ANSI terminal output
 * @param {string|Buffer} chunk
 * @returns {string}
 */
function formatPrettyRecord(chunk) {
  try {
    const data = JSON.parse(chunk.toString());
    const date = new Date(data.time || Date.now());
    const timeStr = date.toTimeString().split(' ')[0];

    const style = levelStyles[data.level] || levelStyles[30];
    const rawMsg = data.msg || '';
    const scope = detectScope(rawMsg, data);
    const scopeColor = scopeColors[scope] || c.gray;

    // Build main line: [HH:MM:SS] [BADGE] [SCOPE] Message
    let line = `${c.dim}[${timeStr}]${c.reset} ${style.badge} ${scopeColor}${c.bold}[${scope.padEnd(10)}]${c.reset} ${style.color}${rawMsg}${c.reset}\n`;

    // Print error details cleanly if present
    const err = data.err || data.error;
    if (err) {
      const errMsg = err.message || (typeof err === 'string' ? err : JSON.stringify(err));
      line += `  ${c.red}↳ ✖ ${c.bold}${errMsg}${c.reset}\n`;
      if (err.stack) {
        const stackLines = String(err.stack)
          .split('\n')
          .slice(1, 4)
          .map(l => `    ${c.dim}${l.trim()}${c.reset}`)
          .join('\n');
        line += `${stackLines}\n`;
      }
    }

    return line;
  } catch (_) {
    return chunk.toString();
  }
}

// Pretty terminal stream for development and production consoles
const prettyTerminalStream = new Writable({
  write(chunk, encoding, callback) {
    process.stdout.write(formatPrettyRecord(chunk));
    callback();
  }
});

const baseLogger = pino({
  level: config.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'token',
      'DISCORD_TOKEN',
      'key',
      'service_role_key',
      'password',
      'content',
      'message.content',
      'messages[*].content',
      'DATA_ENCRYPTION_KEY'
    ],
    censor: '[REDACTED]'
  }
}, isDev ? prettyTerminalStream : undefined);

// Enhanced logger with decorative helper methods
export const logger = Object.assign(baseLogger, {
  /**
   * Prints a modern, stylish Argoni banner to the terminal
   */
  banner() {
    const art = [
      '',
      `${c.cyan}${c.bold}   █████╗ ██████╗  ██████╗  ██████╗ ███╗   ██╗██╗${c.reset}`,
      `${c.cyan}${c.bold}  ██╔══██╗██╔══██╗██╔════╝ ██╔═══██╗████╗  ██║██║${c.reset}`,
      `${c.brightCyan}${c.bold}  ███████║██████╔╝██║  ███╗██║   ██║██╔██╗ ██║██║${c.reset}`,
      `${c.brightCyan}${c.bold}  ██╔══██║██╔══██╗██║   ██║██║   ██║██║╚██╗██║██║${c.reset}`,
      `${c.cyan}${c.bold}  ██║  ██║██║  ██║╚██████╔╝╚██████╔╝██║ ╚████║██║${c.reset}`,
      `${c.cyan}${c.bold}  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝${c.reset}`,
      '',
      `  ${c.dim}───────────────────────────────────────────────────────────────────${c.reset}`,
      `  ${c.bold}${c.white}Autonomous Discord Infrastructure & Real-Time Chat Vault${c.reset} ${c.cyan}[v2.0]${c.reset}`,
      `  ${c.dim}Central Panel Architecture • Mobile-Friendly • 100% Owner Unlocked${c.reset}`,
      `  ${c.dim}───────────────────────────────────────────────────────────────────${c.reset}`,
      ''
    ].join('\n');
    console.log(art);
  },

  /**
   * Prints gateway login confirmation summary
   */
  ready({ tag, id, guilds = 0, ping = 0, commandCount = null }) {
    const cmdText = commandCount != null ? `${commandCount} Commands Active` : 'Fully Synchronized';
    console.log([
      `  ${c.brightGreen}${c.bold}┌─────────────────────────────────────────────────────────────┐${c.reset}`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.bold}✔ GATEWAY ONLINE${c.reset}                                            ${c.brightGreen}${c.bold}│${c.reset}`,
      `  ${c.brightGreen}${c.bold}├─────────────────────────────────────────────────────────────┤${c.reset}`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.cyan}• Bot Account${c.reset} : ${c.bold}${tag}${c.reset} (${id})`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.cyan}• Active Guilds${c.reset}: ${c.bold}${guilds}${c.reset} connected`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.cyan}• Heartbeat Ping${c.reset}: ${c.bold}${ping}ms${c.reset}`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.cyan}• Commands${c.reset}     : ${c.bold}${cmdText}${c.reset}`,
      `  ${c.brightGreen}${c.bold}│${c.reset}  ${c.cyan}• UI Architecture${c.reset}: ${c.green}${c.bold}Components V2 (100% Compliant)${c.reset}`,
      `  ${c.brightGreen}${c.bold}└─────────────────────────────────────────────────────────────┘${c.reset}`,
      ''
    ].join('\n'));
  },

  /**
   * Logs a green success badge line
   * @param {string} msg
   * @param {string} [scope='SYSTEM']
   */
  success(msg, scope = 'SYSTEM') {
    const timeStr = new Date().toTimeString().split(' ')[0];
    const line = `${c.dim}[${timeStr}]${c.reset} ${c.bgGreen}${c.bold}  OK  ${c.reset} ${c.brightGreen}${c.bold}[${scope.padEnd(10)}]${c.reset} ${c.green}${msg}${c.reset}\n`;
    process.stdout.write(line);
  }
});

export default logger;

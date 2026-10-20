import { theme } from '../../config/theme.js';

/**
 * Text Formatting Engine for Discord Components V2
 * Exports rich Discord markdown helpers, ANSI stylers, and input sanitization guards.
 */

// Safety: Disallow all automated pings for user-generated text
export const allowedMentionsNone = Object.freeze({ parse: [] });

/**
 * Escapes Discord markdown characters in user-provided input
 * Prevents layout breaks, spoofed headers, and markdown injection.
 * @param {string} text
 * @returns {string}
 */
export function escapeMarkdown(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/~/g, '\\~')
    .replace(/`/g, '\\`')
    .replace(/\|/g, '\\|')
    .replace(/>/g, '\\>')
    .replace(/#/g, '\\#')
    .replace(/-/g, '\\-')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Safely truncates text without splitting markdown code blocks or Discord mentions.
 * Ensures output stays below maximum character boundaries (default 2000 / 4000).
 * @param {string} text
 * @param {number} [max=1024]
 * @param {string} [suffix='...']
 * @returns {string}
 */
export function truncate(text, max = 1024, suffix = '...') {
  if (!text) return '';
  const str = String(text);
  if (str.length <= max) return str;

  const targetLength = Math.max(0, max - suffix.length);
  let cut = str.slice(0, targetLength);

  // Avoid cutting inside mentions e.g. <@123456789>
  const lastOpenAngle = cut.lastIndexOf('<');
  const lastCloseAngle = cut.lastIndexOf('>');
  if (lastOpenAngle > lastCloseAngle && lastOpenAngle >= 0) {
    cut = cut.slice(0, lastOpenAngle);
  }

  // Count unclosed backticks (code blocks or inline code)
  const tripleBackticks = (cut.match(/```/g) || []).length;
  if (tripleBackticks % 2 !== 0) {
    cut += '\n```';
  } else {
    const singleBackticks = (cut.match(/(?<!`)`(?!`)/g) || []).length;
    if (singleBackticks % 2 !== 0) {
      cut += '`';
    }
  }

  return cut.trimEnd() + suffix;
}

/** Bold text: **text** */
export function bold(text) {
  return `**${text ?? ''}**`;
}

/** Italic text: *text* */
export function italic(text) {
  return `*${text ?? ''}*`;
}

/** Bold and Italic text: ***text*** */
export function boldItalic(text) {
  return `***${text ?? ''}***`;
}

/** Underline text: __text__ */
export function underline(text) {
  return `__${text ?? ''}__`;
}

/** Strikethrough text: ~~text~~ */
export function strike(text) {
  return `~~${text ?? ''}~~`;
}

/** Spoiler text: ||text|| */
export function spoiler(text) {
  return `||${text ?? ''}||`;
}

/** Inline code snippet: `text` */
export function code(text) {
  return `\`${text ?? ''}\``;
}

/**
 * Fenced code block with optional syntax highlighting: ```lang\ntext\n```
 * @param {string} lang e.g. 'js', 'json', 'diff', 'ansi'
 * @param {string} text
 */
export function codeBlock(lang, text) {
  const language = typeof text === 'undefined' ? '' : lang;
  const content = typeof text === 'undefined' ? lang : text;
  return `\`\`\`${language}\n${content ?? ''}\n\`\`\``;
}

/**
 * Colored ANSI code block for stats, diffs, tables, and telemetry
 * @param {string} text
 */
export function ansiBlock(text) {
  return `\`\`\`ansi\n${text ?? ''}\n\`\`\``;
}

/** ANSI Color formatting helpers for use inside ansiBlock */
export const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  underline: '\u001b[4m',
  gray: (t) => `\u001b[0;30m${t}\u001b[0m`,
  red: (t) => `\u001b[0;31m${t}\u001b[0m`,
  green: (t) => `\u001b[0;32m${t}\u001b[0m`,
  yellow: (t) => `\u001b[0;33m${t}\u001b[0m`,
  blue: (t) => `\u001b[0;34m${t}\u001b[0m`,
  pink: (t) => `\u001b[0;35m${t}\u001b[0m`,
  cyan: (t) => `\u001b[0;36m${t}\u001b[0m`,
  white: (t) => `\u001b[0;37m${t}\u001b[0m`
};

/** Single line quote: > text */
export function quote(text) {
  return `> ${text ?? ''}`;
}

/** Multi-line block quote: >>> text */
export function blockQuote(text) {
  return `>>> ${text ?? ''}`;
}

/**
 * Heading with level 1 (#), 2 (##), or 3 (###)
 * @param {1|2|3} level
 * @param {string} text
 */
export function heading(level, text) {
  const lvl = Math.min(Math.max(Number(level) || 2, 1), 3);
  return `${'#'.repeat(lvl)} ${text ?? ''}`;
}

/** Small subtext: -# text */
export function subtext(text) {
  return `-# ${text ?? ''}`;
}

/** Masked link: [text](url) */
export function link(text, url) {
  return `[${text}](${url})`;
}

/** User mention: <@userId> */
export function userMention(userId) {
  return `<@${userId}>`;
}

/** Role mention: <@&roleId> */
export function roleMention(roleId) {
  return `<@&${roleId}>`;
}

/** Channel mention: <#channelId> */
export function channelMention(channelId) {
  return `<#${channelId}>`;
}

/**
 * Clickable slash command mention: </name:id> (falls back to `/${name}` if id omitted)
 * @param {string} name
 * @param {string} [id]
 */
export function commandMention(name, id = null) {
  if (id) {
    return `</${name}:${id}>`;
  }
  return `\`/${name}\``;
}

/**
 * Unix Timestamp formatting
 * Styles:
 * t: Short Time (e.g. 9:41 PM)
 * T: Long Time (e.g. 9:41:30 PM)
 * d: Short Date (e.g. 20/10/2026)
 * D: Long Date (e.g. 20 October 2026)
 * f: Short Date/Time (default)
 * F: Long Date/Time (e.g. Tuesday, 20 October 2026 9:41 PM)
 * R: Relative Time (e.g. 2 minutes ago)
 * @param {Date|number|string} date
 * @param {'t'|'T'|'d'|'D'|'f'|'F'|'R'} [style='f']
 */
export function time(date = new Date(), style = 'f') {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const unix = Math.floor(ms / 1000);
  return `<t:${unix}:${style}>`;
}

/**
 * Long Date/Time + Relative Time together (recommended for audit logs & event cards)
 * E.g. <t:unix:F> (<t:unix:R>)
 * @param {Date|number|string} date
 */
export function timeLongAndRelative(date = new Date()) {
  const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const unix = Math.floor(ms / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

/**
 * Bulleted markdown list with customizable bullet
 * @param {string[]} items
 * @param {string} [bullet='-']
 */
export function list(items, bullet = '-') {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(item => `${bullet} ${item}`).join('\n');
}

/**
 * Numbered markdown list (1. item)
 * @param {string[]} items
 */
export function numberedList(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map((item, idx) => `${idx + 1}. ${item}`).join('\n');
}

/**
 * Key-Value formatted line with dot bullet
 * E.g. "• **User:** <@12345>"
 * @param {string} label
 * @param {string} value
 */
export function kvLine(label, value) {
  const dot = theme.emojis.dot || '•';
  return `${dot} **${label}:** ${value}`;
}

/**
 * Visual progress bar e.g. "▰▰▰▰▰▱▱▱▱▱ 50%"
 * @param {number} value
 * @param {number} max
 * @param {number} [length=10]
 */
export function progressBar(value, max, length = 10) {
  const safeMax = max > 0 ? max : 1;
  const ratio = Math.min(Math.max(value / safeMax, 0), 1);
  const percent = Math.round(ratio * 100);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(empty)}`;
  return `${bar} ${percent}%`;
}

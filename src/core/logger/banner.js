import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { version as djsVersion } from 'discord.js';
import { brand } from '../../config/brand.js';
import {
  ANSI,
  colorize,
  applyHorizontalGradient,
  applySingleColor,
  getColorDepth,
  isAsciiOnly,
  getRealMemoryLimitString
} from './style.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_ASSET_PATH = path.resolve(__dirname, '../../../assets/banner/ava.txt');

// Hardcoded fallback with exact 4 rows (18 columns each)
const FALLBACK_LOGO_ROWS = [
  '  __   _  _   __  ',
  ' / _\\ / )( \\ / _\\ ',
  '/    \\\\ \\/ //    \\',
  '\\_/\\_/ \\__/ \\_/\\_/'
];

/**
 * Loads the 4-row 18-col ASCII logo from disk or falls back to in-memory template
 * Asserts each row is padded to exactly 18 characters.
 * @returns {string[]} Array of 4 strings (18 chars each)
 */
export function getRawLogoRows() {
  try {
    if (fs.existsSync(LOGO_ASSET_PATH)) {
      const raw = fs.readFileSync(LOGO_ASSET_PATH, 'utf8');
      const lines = raw.split(/\r?\n/).filter(line => line.length > 0).slice(0, 4);
      if (lines.length === 4) {
        return lines.map(line => line.padEnd(18, ' ').slice(0, 18));
      }
    }
  } catch (_) {}

  return FALLBACK_LOGO_ROWS.map(line => line.padEnd(18, ' ').slice(0, 18));
}

let hasPrintedStartupBanner = false;

function writeOut(str) {
  process.stdout.write(str);
}

/**
 * Returns terminal column width or safe default (80)
 */
function getTerminalWidth() {
  if (process.env.COLUMNS) {
    const parsed = parseInt(process.env.COLUMNS, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  if (process.stdout?.columns && process.stdout.columns > 0) {
    return process.stdout.columns;
  }
  return 80;
}

/**
 * Renders the 4-row ASCII logo with requested coloring and 2-space indent
 *
 * @param {object} [options]
 * @param {'gradient'|'dim'|'rose'|'plain'} [options.mode='gradient']
 * @returns {string} Formatted 4-line block
 */
export function renderLogo({ mode = 'gradient' } = {}) {
  const rows = getRawLogoRows();

  return rows.map(row => {
    let colored;
    if (mode === 'gradient') {
      colored = applyHorizontalGradient(row, '#FFB7D5', '#C9B6FF', 18);
    } else if (mode === 'dim') {
      colored = applySingleColor(row, '#C9B6FF');
      if (getColorDepth() > 0) {
        colored = `\x1b[2m${colored}`;
      }
    } else if (mode === 'rose') {
      colored = applySingleColor(row, '#FF7C98');
    } else {
      colored = row;
    }
    return `  ${colored}`;
  }).join('\n');
}

/**
 * Prints the startup header ONCE at boot
 * @param {object} [options]
 * @param {boolean} [options.force=false] Force print even if already printed
 */
export function printStartupHeader({ force = false } = {}) {
  if (hasPrintedStartupBanner && !force) return;
  hasPrintedStartupBanner = true;

  const width = getTerminalWidth();
  const isCompact = width < 20 || process.env.BANNER_STYLE === 'compact';

  if (isCompact) {
    const icon = isAsciiOnly() ? '*' : '✿';
    const nameColored = applyHorizontalGradient(brand.name, '#FFB7D5', '#C9B6FF', brand.name.length);
    writeOut(`\n${colorize(ANSI.pink, icon)} ${nameColored} · v${brand.version}\n\n`);
    return;
  }

  const logoArt = renderLogo({ mode: 'gradient' });
  const memLimit = getRealMemoryLimitString();
  const nodeVer = process.versions.node;

  writeOut('\n' + logoArt + '\n');

  const taglineStr = `${brand.tagline} • v${brand.version}`;
  const runtimeStr = `Node.js v${nodeVer} · discord.js v${djsVersion} · RAM ${memLimit}`;

  if (width < taglineStr.length + 2) {
    const words = taglineStr.split(' ');
    let currentLine = '  ';
    for (const word of words) {
      if (currentLine.length + word.length + 1 > width) {
        writeOut(colorize(ANSI.italic + ANSI.pink, currentLine) + '\n');
        currentLine = '  ' + word;
      } else {
        currentLine = currentLine === '  ' ? '  ' + word : currentLine + ' ' + word;
      }
    }
    if (currentLine.trim().length > 0) {
      writeOut(colorize(ANSI.italic + ANSI.pink, currentLine) + '\n');
    }
  } else {
    writeOut(colorize(ANSI.italic + ANSI.pink, `  ${taglineStr}`) + '\n');
  }

  if (width < runtimeStr.length + 2) {
    const parts = runtimeStr.split(' · ');
    let currentLine = '  ';
    for (const part of parts) {
      if (currentLine.length + part.length + 3 > width) {
        writeOut(colorize(ANSI.dim + ANSI.gray, currentLine) + '\n');
        currentLine = '  ' + part;
      } else {
        currentLine = currentLine === '  ' ? '  ' + part : currentLine + ' · ' + part;
      }
    }
    if (currentLine.trim().length > 0) {
      writeOut(colorize(ANSI.dim + ANSI.gray, currentLine) + '\n\n');
    } else {
      writeOut('\n');
    }
  } else {
    writeOut(colorize(ANSI.dim + ANSI.gray, `  ${runtimeStr}`) + '\n\n');
  }
}

/**
 * Prints graceful shutdown banner
 * @param {object} params
 * @param {number} [params.uptimeSec=0]
 */
export function printShutdownHeader({ uptimeSec = 0 } = {}) {
  const width = getTerminalWidth();
  const isCompact = width < 20 || process.env.BANNER_STYLE === 'compact';
  const icon = isAsciiOnly() ? '*' : '✿';
  const hours = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  const secs = Math.floor(uptimeSec % 60);
  const uptimeStr = hours > 0 ? `${hours}h ${mins}m` : mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  if (isCompact) {
    writeOut(`\n${colorize(ANSI.dimLavender, `${icon} ${brand.name} is going offline · uptime ${uptimeStr}`)}\n\n`);
    return;
  }

  const logoArt = renderLogo({ mode: 'dim' });
  writeOut('\n' + logoArt + '\n');
  writeOut(colorize(ANSI.dimLavender, `  ${icon} ${brand.name} is going offline · uptime ${uptimeStr}`) + '\n\n');
}

/**
 * Prints fatal crash / crash-loop backoff header
 * @param {object} params
 * @param {string} params.reason
 * @param {number} [params.restartDelaySec=0]
 */
export function printCrashHeader({ reason = 'Unexpected fatal error', restartDelaySec = 0 } = {}) {
  const width = getTerminalWidth();
  const isCompact = width < 20 || process.env.BANNER_STYLE === 'compact';
  const icon = isAsciiOnly() ? 'x' : '✖';

  if (isCompact) {
    writeOut(`\n${colorize(ANSI.rose, `${icon} ${brand.name} error: ${reason}`)}`);
    if (restartDelaySec > 0) {
      writeOut(` (restarting in ${restartDelaySec}s)`);
    }
    writeOut('\n\n');
    return;
  }

  const logoArt = renderLogo({ mode: 'rose' });
  writeOut('\n' + logoArt + '\n');
  writeOut(colorize(ANSI.rose, `  ${icon} ${brand.name} stopped: ${reason}`) + '\n');
  if (restartDelaySec > 0) {
    writeOut(colorize(ANSI.dim + ANSI.peach, `  Restarting in ${restartDelaySec}s...`) + '\n');
  }
  writeOut('\n');
}

/**
 * Prints a clean step line in the boot sequence with timing
 * Example: ✿ Database connected +84ms
 */
export function printBootStep(label, durationMs = null) {
  const icon = isAsciiOnly() ? '*' : '✿';
  const iconColored = colorize(ANSI.pink, icon);
  const timing = durationMs !== null ? colorize(ANSI.dim + ANSI.lavender, ` +${Math.round(durationMs)}ms`) : '';
  writeOut(`${iconColored} ${label}${timing}\n`);
}

/**
 * Prints the final framed "AVA is online" status box
 * Narrow width (24 columns) matching the 20-column logo block
 */
export function printOnlineFrame({ tag, id, guilds, ping, memoryMb }) {
  const ascii = isAsciiOnly();
  const top = ascii ? '+----------------------+' : '╭──────────────────────╮';
  const bottom = ascii ? '+----------------------+' : '╰──────────────────────╯';
  const border = ascii ? '|' : '│';
  const icon = ascii ? '*' : '✿';
  const innerWidth = 20; // 24 outer - 2 border - 2 padding

  function makeLine(plain, colored) {
    const truncatedPlain = plain.slice(0, innerWidth);
    const spaces = Math.max(0, innerWidth - truncatedPlain.length);
    return `${colorize(ANSI.pink, border)} ${colored}${' '.repeat(spaces)} ${colorize(ANSI.pink, border)}\n`;
  }

  const line1Plain = `${icon} ${brand.name} is online`;
  const line1Colored = colorize(ANSI.bold + ANSI.mint, line1Plain);

  const line2Plain = (tag || brand.name).slice(0, innerWidth);
  const line2Colored = colorize(ANSI.sky, line2Plain);

  const line3Plain = `${guilds || 0} guilds · ${ping || 0}ms`.slice(0, innerWidth);
  const line3Colored = `${colorize(ANSI.peach, `${guilds || 0} guilds`)} · ${colorize(ANSI.mint, `${ping || 0}ms`)}`;

  const line4Plain = `RAM: ${memoryMb || 0}MB`.slice(0, innerWidth);
  const line4Colored = colorize(ANSI.lavender, line4Plain);

  writeOut('\n' + colorize(ANSI.pink, top) + '\n');
  writeOut(makeLine(line1Plain, line1Colored));
  writeOut(makeLine(line2Plain, line2Colored));
  writeOut(makeLine(line3Plain, line3Colored));
  writeOut(makeLine(line4Plain, line4Colored));
  writeOut(colorize(ANSI.pink, bottom) + '\n\n');
}

export default {
  getRawLogoRows,
  renderLogo,
  printStartupHeader,
  printShutdownHeader,
  printCrashHeader,
  printBootStep,
  printOnlineFrame
};

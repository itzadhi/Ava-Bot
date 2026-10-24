import { ANSI, colorize } from './palette.js';
import { brand } from '../../config/brand.js';
import { getMemoryStats } from '../pterodactyl/memory.js';

function isAsciiOnly() {
  return Boolean(process.env.ASCII_ONLY) && process.env.ASCII_ONLY !== '0';
}

// 1. Block Style Banner (Full box-drawing characters)
const BANNER_BLOCK = [
  '█████╗ ██╗   ██╗ █████╗ ',
  '██╔══██╗██║   ██║██╔══██╗',
  '███████║██║   ██║███████║',
  '██╔══██║╚██╗ ██╔╝██╔══██║',
  '██║  ██║ ╚████╔╝ ██║  ██║',
  '╚═╝  ╚═╝  ╚═══╝  ╚═╝  ╚═╝'
];

// 2. Slim Style Banner
const BANNER_SLIM = [
  '  /\\  \\  /  /\\  ',
  ' /~~\\  \\/  /~~\\ '
];

// 3. Aesthetic Style Banner (Wide spaced minimalist)
const BANNER_AESTHETIC = [
  '┌─┐ ┬  ┬ ┌─┐',
  '├─┤ └┐┌┘ ├─┤',
  '┴ ┴  └┘  ┴ ┴'
];

// 4. Kawaii Style Banner (With floral ornaments)
const BANNER_KAWAII = [
  '✿ ═══════════ ♡ ═══════════ ✿',
  '   🌸   A  ·  V  ·  A   🌸   ',
  '✿ ═══════════ ♡ ═══════════ ✿'
];

// ASCII-only fallback banner
const BANNER_ASCII = [
  '  AAA   V   V   AAA  ',
  ' AAAAA  V   V  AAAAA ',
  'A     A  V V  A     A',
  'A     A   V   A     A'
];

/**
 * Returns formatted multi-line stylized startup banner
 * @param {string} [style=process.env.BANNER_STYLE] 'block' | 'slim' | 'aesthetic' | 'kawaii'
 */
export function getBanner(style = process.env.BANNER_STYLE || 'block') {
  if (isAsciiOnly()) {
    return BANNER_ASCII.join('\n');
  }

  let lines;
  switch (style.toLowerCase()) {
    case 'slim':
      lines = BANNER_SLIM;
      break;
    case 'aesthetic':
      lines = BANNER_AESTHETIC;
      break;
    case 'kawaii':
      lines = BANNER_KAWAII;
      break;
    case 'block':
    default:
      lines = BANNER_BLOCK;
      break;
  }

  // Horizontal gradient coloring from pink to lavender across lines
  return lines.map((line, idx) => {
    const isUpper = idx < lines.length / 2;
    return colorize(isUpper ? ANSI.pink : ANSI.lavender, line);
  }).join('\n');
}

/**
 * Prints the complete, polished startup header with runtime environment
 */
export function printStartupHeader() {
  const banner = getBanner();
  const mem = getMemoryStats();
  const nodeVer = process.versions.node;
  const djsVer = '14.27.0';

  console.log('\n' + banner);
  console.log(colorize(ANSI.italic + ANSI.peach, `   ${brand.tagline} • v${brand.version}`));
  console.log(colorize(ANSI.dim + ANSI.gray, `   Node.js v${nodeVer} · discord.js v${djsVer} · Container RAM: ${mem.limitMb} MB\n`));
}

/**
 * Prints a clean step line in the boot sequence with timing
 * Example: ✿ Database connected +84ms
 */
export function printBootStep(label, durationMs = null) {
  const icon = isAsciiOnly() ? '*' : '✿';
  const iconColored = colorize(ANSI.pink, icon);
  const timing = durationMs !== null ? colorize(ANSI.dim + ANSI.lavender, ` +${Math.round(durationMs)}ms`) : '';
  console.log(`${iconColored} ${label}${timing}`);
}

/**
 * Prints the final framed "AVA is online" status box
 */
export function printOnlineFrame({ tag, id, guilds, ping, memoryMb }) {
  const bar = isAsciiOnly()
    ? '+---------------------------------------------------------+'
    : '╭─────────────────────────────────────────────────────────╮';
  const bottomBar = isAsciiOnly()
    ? '+---------------------------------------------------------+'
    : '╰─────────────────────────────────────────────────────────╯';
  const border = isAsciiOnly() ? '|' : '│';

  console.log('\n' + colorize(ANSI.pink, bar));
  console.log(`${colorize(ANSI.pink, border)}  ${colorize(ANSI.bold + ANSI.mint, '🌸 AVA is online and listening to Gateway')}            ${colorize(ANSI.pink, border)}`);
  console.log(`${colorize(ANSI.pink, border)}  Identity: ${colorize(ANSI.sky, tag)} (${colorize(ANSI.dim, id)})  ${colorize(ANSI.pink, border)}`);
  console.log(`${colorize(ANSI.pink, border)}  Servers:  ${colorize(ANSI.peach, `${guilds} guilds`)} · Ping: ${colorize(ANSI.mint, `${ping}ms`)} · Memory: ${colorize(ANSI.lavender, `${memoryMb}MB`)} ${colorize(ANSI.pink, border)}`);
  console.log(colorize(ANSI.pink, bottomBar) + '\n');
}

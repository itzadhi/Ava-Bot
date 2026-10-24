/**
 * Terminal color palette and ANSI formatter for AVA.
 * Supports TrueColor (24-bit), 256-color fallback, 16-color fallback, NO_COLOR, and ASCII_ONLY.
 */

const isNoColor = Boolean(process.env.NO_COLOR) || process.argv.includes('--no-color');
const isForceColor = Boolean(process.env.FORCE_COLOR) || process.argv.includes('--color');
const isAsciiOnly = Boolean(process.env.ASCII_ONLY) || process.env.ASCII_ONLY === '1';

// Determine terminal color depth: 3 = TrueColor, 2 = 256-color, 1 = 16-color, 0 = monochrome
function getColorDepth() {
  if (isAsciiOnly || isNoColor) return 0;
  if (isForceColor) return 3;

  const env = process.env;
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3;
  if (env.TERM && (env.TERM.includes('256') || env.TERM.includes('xterm'))) return 2;
  if (process.stdout?.isTTY) return 2;
  return 1;
}

const colorDepth = getColorDepth();

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

// Convert RGB to 256-color code
function rgbTo256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + (36 * Math.round((r / 255) * 5)) + (6 * Math.round((g / 255) * 5)) + Math.round((b / 255) * 5);
}

// Generate ANSI escape string for hex color
function ansiColor(hex, isBg = false) {
  if (colorDepth === 0) return '';
  const { r, g, b } = hexToRgb(hex);

  if (colorDepth === 3) {
    // 24-bit Truecolor
    return `\x1b[${isBg ? 48 : 38};2;${r};${g};${b}m`;
  } else if (colorDepth === 2) {
    // 256-color
    const code = rgbTo256(r, g, b);
    return `\x1b[${isBg ? 48 : 38};5;${code}m`;
  } else {
    // Basic 16-color fallback
    return isBg ? '\x1b[47m' : '\x1b[37m';
  }
}

export const ANSI = {
  reset: colorDepth > 0 ? '\x1b[0m' : '',
  bold: colorDepth > 0 ? '\x1b[1m' : '',
  dim: colorDepth > 0 ? '\x1b[2m' : '',
  italic: colorDepth > 0 ? '\x1b[3m' : '',
  underline: colorDepth > 0 ? '\x1b[4m' : '',

  // AVA Signature Theme Colors
  pink: ansiColor('#FFB7D5'),     // Main soft light pink
  lavender: ansiColor('#C9B6FF'), // Accents
  mint: ansiColor('#A8F0D1'),     // Info / Success
  peach: ansiColor('#FFD3B0'),    // Accent details
  sky: ansiColor('#A9D8FF'),      // Debug / Blue
  butter: ansiColor('#FFE9A8'),   // Warnings
  rose: ansiColor('#FF7C98'),     // Errors
  gray: ansiColor('#8E88A8'),     // Gutter & dim text

  // Badges (Inverted Backgrounds)
  bgPink: ansiColor('#FFB7D5', true),
  bgLavender: ansiColor('#C9B6FF', true),
  bgMint: ansiColor('#A8F0D1', true),
  bgSky: ansiColor('#A9D8FF', true),
  bgButter: ansiColor('#FFE9A8', true),
  bgRose: ansiColor('#FF7C98', true),
  bgDark: ansiColor('#1E1B2E', true)
};

/**
 * Applies color wrapper safely with automatic reset
 */
export function colorize(colorCode, text) {
  if (colorDepth === 0) return text;
  return `${colorCode}${text}${ANSI.reset}`;
}

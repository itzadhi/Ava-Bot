import os from 'node:os';
import fs from 'node:fs';

/**
 * Terminal style, ANSI color utilities, and horizontal gradient generator for AVA.
 * Supports TrueColor (24-bit), 256-color fallback, 16-color fallback, NO_COLOR, and ASCII_ONLY.
 */

export function isNoColor() {
  return Boolean(process.env.NO_COLOR) || process.argv.includes('--no-color');
}

export function isForceColor() {
  return Boolean(process.env.FORCE_COLOR) || process.argv.includes('--color');
}

export function isAsciiOnly() {
  return Boolean(process.env.ASCII_ONLY) && process.env.ASCII_ONLY !== '0';
}

/**
 * Determine terminal color depth:
 * 3 = TrueColor (24-bit), 2 = 256-color, 1 = 16-color, 0 = monochrome
 */
export function getColorDepth() {
  if (isAsciiOnly() || isNoColor()) return 0;
  if (isForceColor()) return 3;

  const env = process.env;
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 3;
  if (env.TERM && (env.TERM.includes('256') || env.TERM.includes('xterm'))) return 2;
  if (process.stdout?.isTTY) {
    if (process.stdout.getColorDepth && typeof process.stdout.getColorDepth === 'function') {
      const depth = process.stdout.getColorDepth();
      if (depth >= 24) return 3;
      if (depth >= 8) return 2;
      if (depth >= 4) return 1;
      return 0;
    }
    return 2;
  }
  return 1;
}

export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16),
    g: parseInt(clean.substring(2, 4), 16),
    b: parseInt(clean.substring(4, 6), 16)
  };
}

export function rgbTo256(r, g, b) {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return 16 + (36 * Math.round((r / 255) * 5)) + (6 * Math.round((g / 255) * 5)) + Math.round((b / 255) * 5);
}

export function ansiColor(hex, isBg = false) {
  const depth = getColorDepth();
  if (depth === 0) return '';
  const { r, g, b } = hexToRgb(hex);

  if (depth === 3) {
    return `\x1b[${isBg ? 48 : 38};2;${r};${g};${b}m`;
  } else if (depth === 2) {
    const code = rgbTo256(r, g, b);
    return `\x1b[${isBg ? 48 : 38};5;${code}m`;
  } else {
    // 16-color fallback
    if (isBg) return '\x1b[47m';
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    return luminance > 128 ? '\x1b[95m' : '\x1b[35m';
  }
}

export function interpolateRgb(c1, c2, factor) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * factor),
    g: Math.round(c1.g + (c2.g - c1.g) * factor),
    b: Math.round(c1.b + (c2.b - c1.b) * factor)
  };
}

/**
 * Applies horizontal gradient across columns from startHex to endHex
 * Spaces stay uncolored. Every line ends with \x1b[0m reset.
 *
 * @param {string} line
 * @param {string} [startHex='#FFB7D5'] Light pink
 * @param {string} [endHex='#C9B6FF'] Lavender
 * @param {number} [totalColumns=18] Total columns spanned
 * @returns {string} Formatted line
 */
export function applyHorizontalGradient(line, startHex = '#FFB7D5', endHex = '#C9B6FF', totalColumns = 18) {
  const depth = getColorDepth();
  if (depth === 0) return line;

  const c1 = hexToRgb(startHex);
  const c2 = hexToRgb(endHex);
  let result = '';

  const maxCol = Math.max(1, totalColumns - 1);
  for (let col = 0; col < line.length; col++) {
    const char = line[col];
    if (char === ' ') {
      result += ' ';
    } else {
      const factor = Math.min(1, Math.max(0, col / maxCol));
      const rgb = interpolateRgb(c1, c2, factor);
      let escape = '';
      if (depth === 3) {
        escape = `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
      } else if (depth === 2) {
        escape = `\x1b[38;5;${rgbTo256(rgb.r, rgb.g, rgb.b)}m`;
      } else {
        escape = '\x1b[95m'; // Light magenta/pink
      }
      result += `${escape}${char}`;
    }
  }

  return `${result}\x1b[0m`;
}

/**
 * Formats line in single uniform color, leaving spaces uncolored
 */
export function applySingleColor(line, hex) {
  const depth = getColorDepth();
  if (depth === 0) return line;

  const escape = ansiColor(hex);
  let result = '';
  for (let col = 0; col < line.length; col++) {
    const char = line[col];
    if (char === ' ') {
      result += ' ';
    } else {
      result += `${escape}${char}`;
    }
  }
  return `${result}\x1b[0m`;
}

export const ANSI = {
  get reset() { return getColorDepth() > 0 ? '\x1b[0m' : ''; },
  get bold() { return getColorDepth() > 0 ? '\x1b[1m' : ''; },
  get dim() { return getColorDepth() > 0 ? '\x1b[2m' : ''; },
  get italic() { return getColorDepth() > 0 ? '\x1b[3m' : ''; },
  get underline() { return getColorDepth() > 0 ? '\x1b[4m' : ''; },

  // AVA Signature Theme Colors
  get pink() { return ansiColor('#FFB7D5'); },     // Main soft light pink
  get lavender() { return ansiColor('#C9B6FF'); }, // Accents
  get mint() { return ansiColor('#A8F0D1'); },     // Success
  get peach() { return ansiColor('#FFD3B0'); },    // Accents
  get sky() { return ansiColor('#A9D8FF'); },      // Blue
  get butter() { return ansiColor('#FFE9A8'); },   // Warning
  get rose() { return ansiColor('#FF7C98'); },     // Error / Soft rose
  get gray() { return ansiColor('#8E88A8'); },     // Dim text
  get dimLavender() {
    const depth = getColorDepth();
    if (depth === 0) return '';
    return `\x1b[2m${ansiColor('#C9B6FF')}`;
  },

  // Badges (Inverted Backgrounds)
  get bgPink() { return ansiColor('#FFB7D5', true); },
  get bgLavender() { return ansiColor('#C9B6FF', true); },
  get bgMint() { return ansiColor('#A8F0D1', true); },
  get bgSky() { return ansiColor('#A9D8FF', true); },
  get bgButter() { return ansiColor('#FFE9A8', true); },
  get bgRose() { return ansiColor('#FF7C98', true); },
  get bgDark() { return ansiColor('#1E1B2E', true); }
};

export function colorize(colorCode, text) {
  if (getColorDepth() === 0) return text;
  return `${colorCode}${text}${ANSI.reset}`;
}

/**
 * Detects real container memory limit (cgroup v2/v1, process.env.MEMORY, or host total)
 * @returns {string} Human-readable RAM string e.g. "512 MB"
 */
export function getRealMemoryLimitString() {
  if (process.env.MEMORY && !isNaN(process.env.MEMORY)) {
    return `${Math.round(parseFloat(process.env.MEMORY))} MB`;
  }
  if (process.env.SERVER_MEMORY && !isNaN(process.env.SERVER_MEMORY)) {
    return `${Math.round(parseFloat(process.env.SERVER_MEMORY))} MB`;
  }

  // cgroup v2
  try {
    const cgroupV2 = '/sys/fs/cgroup/memory.max';
    if (fs.existsSync(cgroupV2)) {
      const val = fs.readFileSync(cgroupV2, 'utf8').trim();
      if (val !== 'max' && !isNaN(val)) {
        const bytes = parseInt(val, 10);
        return `${Math.round(bytes / (1024 * 1024))} MB`;
      }
    }
  } catch (_) {}

  // cgroup v1
  try {
    const cgroupV1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
    if (fs.existsSync(cgroupV1)) {
      const val = fs.readFileSync(cgroupV1, 'utf8').trim();
      const num = parseInt(val, 10);
      if (!isNaN(num) && num < 1099511627776) {
        return `${Math.round(num / (1024 * 1024))} MB`;
      }
    }
  } catch (_) {}

  // Host total fallback
  try {
    const totalBytes = os.totalmem();
    return `${Math.round(totalBytes / (1024 * 1024))} MB`;
  } catch (_) {
    return '512 MB';
  }
}

export default {
  getColorDepth,
  hexToRgb,
  rgbTo256,
  ansiColor,
  interpolateRgb,
  applyHorizontalGradient,
  applySingleColor,
  ANSI,
  colorize,
  isNoColor,
  isForceColor,
  isAsciiOnly,
  getRealMemoryLimitString
};

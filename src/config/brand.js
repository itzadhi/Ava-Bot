import fs from 'node:fs';
import path from 'node:path';

let packageVersion = '1.0.0';
try {
  const pkgPath = path.resolve('package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    packageVersion = pkg.version || '1.0.0';
  }
} catch (_) {}

/**
 * AVA Universal Brand Configuration
 * Single source of truth for bot identity, styling, color palette, and user agent.
 */
export const brand = {
  name: 'AVA',
  slug: 'ava',
  tagline: 'Next-Generation Autonomous Discord Bot',
  version: packageVersion,
  author: 'AVA Team',
  footerText: 'Powered by AVA',
  userAgent: `AVA/${packageVersion} (Node.js; discord.js v14)`,
  
  // Terminal and UI Palette
  colors: {
    pink: '#FFB7D5',     // Soft light pink (primary)
    lavender: '#C9B6FF', // Soft lavender (secondary)
    mint: '#A8F0D1',     // Soft mint (success/info)
    peach: '#FFD3B0',    // Soft peach (accent)
    sky: '#A9D8FF',      // Soft sky blue (debug)
    butter: '#FFE9A8',   // Soft butter yellow (warning)
    rose: '#FF7C98',     // Deep rose (error/critical)
    darkBg: '#13111C',
    containerBg: '#1A1826',
    border: '#2E2B3D'
  },

  // Brand Emoji Set
  emojis: {
    badge: '🌸',
    flower: '✿',
    heart: '♡',
    sparkle: '✨',
    dot: '•',
    check: '✔',
    warn: '⚠',
    error: '✖',
    shield: '🛡️',
    shop: '📦',
    ticket: '🎫',
    voice: '🎙️',
    logs: '📜'
  }
};

export default brand;

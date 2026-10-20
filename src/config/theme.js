import { config } from '../config.js';

/**
 * Global Theme & Design System Tokens (Single Source of Truth)
 * Components V2 Clean Dark Design System - ZERO sidebar color / NO accent strip.
 */
export const theme = {
  // Color tokens for text/markdown reference (NO accent color - containers are borderless)
  colors: {
    success: 0x57F287,
    error: 0xED4245,
    warn: 0xFEE75C,
    warning: 0xFEE75C,
    info: 0x5865F2,
    neutral: 0x2B2D31
  },

  // Standardized Emoji Set (custom emoji tokens with robust Unicode fallbacks)
  emojis: {
    dot: process.env.EMOJI_DOT || '•',
    arrow: process.env.EMOJI_ARROW || '➔',
    success: process.env.EMOJI_SUCCESS || '✅',
    error: process.env.EMOJI_ERROR || '❌',
    warn: process.env.EMOJI_WARN || '⚠️',
    loading: process.env.EMOJI_LOADING || '⏳',
    on: process.env.EMOJI_ON || '🟢',
    off: process.env.EMOJI_OFF || '🔴',
    info: process.env.EMOJI_INFO || 'ℹ️',
    gear: process.env.EMOJI_GEAR || '⚙️',
    lock: process.env.EMOJI_LOCK || '🔒',
    unlock: process.env.EMOJI_UNLOCK || '🔓',
    member: process.env.EMOJI_MEMBER || '👤',
    channel: process.env.EMOJI_CHANNEL || '📁',
    role: process.env.EMOJI_ROLE || '🛡️',
    chat: process.env.EMOJI_CHAT || '💬',
    voice: process.env.EMOJI_VOICE || '🔊',
    time: process.env.EMOJI_TIME || '⏰',
    link: process.env.EMOJI_LINK || '🔗',
    sparkle: process.env.EMOJI_SPARKLE || '✦',
    box: process.env.EMOJI_BOX || '📦',
    robot: process.env.EMOJI_ROBOT || '🤖'
  },

  // Standardized footer text
  footer: {
    text: 'Argoni • Components V2'
  },

  // Official Links for link buttons & help menu
  links: {
    invite: config?.INVITE_URL || 'https://discord.com/oauth2/authorize?client_id=argoni',
    website: config?.WEBSITE_URL || 'https://argoni.app',
    support: config?.SUPPORT_SERVER_URL || 'https://discord.gg/argoni',
    docs: config?.WEBSITE_URL ? `${config.WEBSITE_URL}/docs` : 'https://argoni.app/docs'
  }
};

export default theme;

import { config } from '../config.js';

/**
 * Global Theme & Design System Tokens (Single Source of Truth)
 * Components V2 Clean Dark Design System - ZERO sidebar color / NO accent strip.
 * Inspired by premium Components V2 card layouts with rich typography and custom emojis.
 */
export const theme = {
  // Brand identity
  botName: process.env.BOT_NAME || 'Argoni',
  defaultPrefix: process.env.DEFAULT_PREFIX || config?.DEFAULT_PREFIX || 'a!',

  // Color tokens for text/markdown reference (NO accent color - containers are borderless dark cards)
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
    // Bullets and layout pointers
    dot: process.env.EMOJI_DOT || '•',
    arrow: process.env.EMOJI_ARROW || '❯',
    butterfly: process.env.EMOJI_BUTTERFLY || '🦋',
    star: process.env.EMOJI_STAR || '⭐',
    sparkle: process.env.EMOJI_SPARKLE || '✦',
    link: process.env.EMOJI_LINK || '🔗',

    // Status indicators
    success: process.env.EMOJI_SUCCESS || '✅',
    error: process.env.EMOJI_ERROR || '❌',
    warn: process.env.EMOJI_WARN || '⚠️',
    info: process.env.EMOJI_INFO || 'ℹ️',
    loading: process.env.EMOJI_LOADING || '⏳',
    on: process.env.EMOJI_ON || '🟢',
    off: process.env.EMOJI_OFF || '🔴',

    // Category & Module icons
    categories: {
      automod: process.env.EMOJI_CAT_AUTOMOD || '🛡️',
      backup: process.env.EMOJI_CAT_BACKUP || '📦',
      settings: process.env.EMOJI_CAT_SETTINGS || '⚙️',
      voice: process.env.EMOJI_CAT_VOICE || '🔊',
      logs: process.env.EMOJI_CAT_LOGS || '📢',
      autorole: process.env.EMOJI_CAT_AUTOROLE || '👤',
      boosts: process.env.EMOJI_CAT_BOOSTS || '🚀',
      sticky: process.env.EMOJI_CAT_STICKY || '📌',
      stickyroles: process.env.EMOJI_CAT_STICKYROLES || '🧲',
      staff: process.env.EMOJI_CAT_STAFF || '💡',
      chatlog: process.env.EMOJI_CAT_CHATLOG || '💬',
      botprofile: process.env.EMOJI_CAT_BOTPROFILE || '🎨',
      general: process.env.EMOJI_CAT_GENERAL || '🌐',
      utility: process.env.EMOJI_CAT_UTILITY || '🛠️',
      moderation: process.env.EMOJI_CAT_MODERATION || '🔨',
      fun: process.env.EMOJI_CAT_FUN || '🎉'
    },

    // UI Controls
    gear: process.env.EMOJI_GEAR || '⚙️',
    lock: process.env.EMOJI_LOCK || '🔒',
    unlock: process.env.EMOJI_UNLOCK || '🔓',
    member: process.env.EMOJI_MEMBER || '👤',
    channel: process.env.EMOJI_CHANNEL || '📁',
    role: process.env.EMOJI_ROLE || '🛡️',
    chat: process.env.EMOJI_CHAT || '💬',
    voiceIcon: process.env.EMOJI_VOICE || '🔊',
    time: process.env.EMOJI_TIME || '⏰',
    box: process.env.EMOJI_BOX || '📦',
    robot: process.env.EMOJI_ROBOT || '🤖',
    trash: process.env.EMOJI_TRASH || '🗑️'
  },

  // Standardized footer text
  footer: {
    text: 'Argoni • Components V2'
  },

  // Official Links for link rows & help menu
  links: {
    invite: process.env.INVITE_URL || config?.INVITE_URL || 'https://discord.com/oauth2/authorize?client_id=argoni',
    website: process.env.WEBSITE_URL || config?.WEBSITE_URL || 'https://argoni.app',
    support: process.env.SUPPORT_SERVER_URL || config?.SUPPORT_SERVER_URL || 'https://discord.gg/argoni',
    docs: process.env.DOCS_URL || (config?.WEBSITE_URL ? `${config.WEBSITE_URL}/docs` : 'https://argoni.app/docs')
  }
};

export default theme;

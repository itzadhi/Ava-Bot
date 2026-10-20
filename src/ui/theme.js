import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AttachmentBuilder } from 'discord.js';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const LOGO_PATH = path.resolve(__dirname, '../../assets/logo.jpg');

/**
 * Returns an AttachmentBuilder for the Argoni brand logo if present
 * @returns {AttachmentBuilder|null}
 */
export function getBrandAttachment() {
  if (fs.existsSync(LOGO_PATH)) {
    return new AttachmentBuilder(LOGO_PATH, { name: 'logo.jpg' });
  }
  return null;
}

/**
 * Resolves the brand logo URL:
 * Prefers the bot's live Discord CDN avatar URL if available,
 * otherwise falls back to the local attachment URI ('attachment://logo.jpg').
 * @param {import('discord.js').Client} [client]
 * @returns {string}
 */
export function getBrandLogo(client = null) {
  if (client?.user?.avatar) {
    return client.user.displayAvatarURL({ extension: 'png', size: 256 });
  }
  if (fs.existsSync(LOGO_PATH)) {
    return 'attachment://logo.jpg';
  }
  return THEME.brand.fallbackLogoUrl;
}

export const THEME = {
  colors: {
    success: 0x57F287,
    error: 0xED4245,
    info: 0x5865F2,
    warning: 0xFEE75C,
    neutral: 0x2B2D31,
    blurple: 0x5865F2,
    fuchsia: 0xEB459E,
    gold: 0xFEE75C
  },
  glyphs: {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    loading: '⟳',
    sparkle: '✦',
    gear: '⚙'
  },
  brand: {
    name: 'Argoni',
    footerSubtext: 'Argoni • Components V2 Modular Engine',
    logoUrl: 'attachment://logo.jpg',
    getLogo: getBrandLogo,
    fallbackLogoUrl: 'https://cdn.discordapp.com/attachments/111111111111111111/argoni_logo.png',
    links: {
      support: config.SUPPORT_SERVER_URL,
      invite: config.INVITE_URL,
      privacy: config.PRIVACY_URL,
      terms: config.TERMS_URL,
      website: config.WEBSITE_URL
    }
  }
};

export default THEME;

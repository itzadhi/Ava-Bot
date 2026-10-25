import { ButtonBuilder, ButtonStyle } from 'discord.js';

/**
 * Creates a compliant grey button (ButtonStyle.Secondary or ButtonStyle.Link)
 * Enforces pure grey styling with zero Primary/Success/Danger usage.
 *
 * @param {object} options
 * @param {string} [options.id] Custom ID for interaction routing (omitted if url is provided)
 * @param {string} [options.label] Text label
 * @param {string} [options.emoji] Emoji display
 * @param {boolean} [options.disabled=false] Disabled state
 * @param {string} [options.url] Optional link URL (switches to ButtonStyle.Link)
 * @returns {ButtonBuilder}
 */
export function greyButton({ id, label, emoji, disabled = false, url = null } = {}) {
  const btn = new ButtonBuilder();

  if (url) {
    btn.setStyle(ButtonStyle.Link).setURL(url);
  } else {
    btn.setStyle(ButtonStyle.Secondary);
    if (id) btn.setCustomId(String(id).slice(0, 100));
  }

  if (label !== undefined && label !== null && String(label).trim().length > 0) {
    btn.setLabel(String(label).slice(0, 80));
  }

  if (emoji) {
    btn.setEmoji(emoji);
  }

  if (disabled) {
    btn.setDisabled(true);
  }

  return btn;
}

export default greyButton;

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';

/**
 * Paginates an array of items and calculates indices and readable summaries
 * @template T
 * @param {T[]} items
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=5]
 * @returns {{
 *   page: number,
 *   totalPages: number,
 *   totalItems: number,
 *   slice: T[],
 *   startIdx: number,
 *   endIdx: number,
 *   summaryText: string,
 *   pageLabel: string
 * }}
 */
export function paginateItems(items = [], { page = 1, limit = 5 } = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalItems = safeItems.length;
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(totalItems / safeLimit));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const startOffset = (safePage - 1) * safeLimit;
  const slice = safeItems.slice(startOffset, startOffset + safeLimit);
  const startIdx = totalItems === 0 ? 0 : startOffset + 1;
  const endIdx = Math.min(startOffset + safeLimit, totalItems);

  const summaryText = totalItems === 0
    ? 'Showing 0 results'
    : `Showing ${startIdx}–${endIdx} of ${totalItems}`;

  const pageLabel = `Page ${safePage} of ${totalPages}`;

  return {
    page: safePage,
    totalPages,
    totalItems,
    slice,
    startIdx,
    endIdx,
    summaryText,
    pageLabel
  };
}

/**
 * Creates a standardized 5-button pagination ActionRow:
 * [⏮ First] [◀ Prev] [‹ Page X of Y ›] [Next ▶] [⏭ Last]
 *
 * @param {object} params
 * @param {string} params.customIdPrefix Prefix for button custom IDs (e.g. 'bk_page_server_123')
 * @param {number} params.page Current page (1-indexed)
 * @param {number} params.totalPages Total pages
 * @param {boolean} [params.compact=false] If true, omits First/Last buttons
 * @param {ButtonBuilder|null} [params.leadingButton=null] Optional leading action button (when compact)
 * @param {ButtonBuilder|null} [params.trailingButton=null] Optional trailing action button (when compact)
 * @returns {ActionRowBuilder}
 */
export function createPaginationRow({
  customIdPrefix,
  page,
  totalPages,
  compact = false,
  leadingButton = null,
  trailingButton = null
}) {
  const safePage = Math.min(Math.max(1, page), Math.max(1, totalPages));
  const hasPrev = safePage > 1;
  const hasNext = safePage < totalPages;

  const buttons = [];

  if (leadingButton) {
    buttons.push(leadingButton);
  } else if (!compact && totalPages > 2) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:first:1`)
        .setLabel('⏮')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasPrev)
    );
  }

  // Previous button
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev:${Math.max(1, safePage - 1)}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasPrev)
  );

  // Active page indicator button (mobile friendly)
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:indicator:${safePage}`)
      .setLabel(`‹ ${safePage} / ${totalPages} ›`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true)
  );

  // Next button
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next:${Math.min(totalPages, safePage + 1)}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasNext)
  );

  if (trailingButton) {
    buttons.push(trailingButton);
  } else if (!compact && totalPages > 2) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${customIdPrefix}:last:${totalPages}`)
        .setLabel('⏭')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasNext)
    );
  }

  return new ActionRowBuilder().addComponents(buttons.slice(0, 5));
}

export default {
  paginateItems,
  createPaginationRow
};

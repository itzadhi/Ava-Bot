import {
  ActionRowBuilder,
  StringSelectMenuBuilder
} from 'discord.js';
import { greyButton } from './greyButton.js';

/**
 * Creates a paginated StringSelectMenu and matching grey navigation controls
 * Selection state is preserved across pages in the caller's session state.
 *
 * @param {object} options
 * @param {Array<{label: string, value: string, description?: string, emoji?: string}>} options.items List of all selectable items
 * @param {number} [options.pageSize=25] Items per page (max 25 for Discord select menus)
 * @param {string[]} [options.selected=[]] Array of selected value strings across all pages
 * @param {string} options.customId Custom ID for the StringSelectMenu
 * @param {string} [options.pageButtonPrefix] Custom ID prefix for page buttons (defaults to `${customId}:page`)
 * @param {number} [options.page=1] Current active page (1-indexed)
 * @param {string} [options.placeholder='Select options...'] Placeholder text
 * @param {number} [options.minValues=0] Minimum selectable options
 * @param {number} [options.maxValues] Maximum selectable options (defaults to page item count)
 * @param {boolean} [options.disabled=false]
 * @returns {{
 *   menuRow: ActionRowBuilder|null,
 *   navRow: ActionRowBuilder|null,
 *   page: number,
 *   totalPages: number,
 *   totalItems: number,
 *   slice: Array<object>,
 *   isEmpty: boolean,
 *   summary: string
 * }}
 */
export function paginatedSelect({
  items = [],
  pageSize = 25,
  selected = [],
  customId,
  pageButtonPrefix = null,
  page = 1,
  placeholder = 'Choose options from this page...',
  minValues = 0,
  maxValues = null,
  disabled = false
} = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const totalItems = safeItems.length;
  const limit = Math.max(1, Math.min(pageSize, 25));

  if (totalItems === 0) {
    return {
      menuRow: null,
      navRow: null,
      page: 1,
      totalPages: 1,
      totalItems: 0,
      slice: [],
      isEmpty: true,
      summary: 'No items available'
    };
  }

  const totalPages = Math.max(1, Math.ceil(totalItems / limit));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), totalPages);

  const startIdx = (currentPage - 1) * limit;
  const slice = safeItems.slice(startIdx, startIdx + limit);

  // Map options and mark default if in selected list
  const selectedSet = new Set(Array.isArray(selected) ? selected.map(String) : []);
  const options = slice.map(item => {
    const opt = {
      label: String(item.label || item.name || 'Untitled').slice(0, 100),
      value: String(item.value || item.id),
      default: selectedSet.has(String(item.value || item.id))
    };
    if (item.description) {
      opt.description = String(item.description).slice(0, 100);
    }
    if (item.emoji) {
      opt.emoji = item.emoji;
    }
    return opt;
  });

  const computedMax = maxValues !== null && maxValues !== undefined
    ? Math.min(maxValues, slice.length)
    : Math.max(1, slice.length);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(Math.min(minValues, slice.length))
    .setMaxValues(Math.min(computedMax, slice.length))
    .setDisabled(disabled)
    .addOptions(options);

  const menuRow = new ActionRowBuilder().addComponents(selectMenu);

  // Navigation row with grey buttons: [◀ Prev] [‹ Page X of Y ›] [Next ▶]
  const btnPrefix = pageButtonPrefix || `${customId}:p`;
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  const prevBtn = greyButton({
    id: `${btnPrefix}:prev:${Math.max(1, currentPage - 1)}`,
    label: '◀ Prev',
    disabled: !hasPrev || disabled
  });

  const indicatorBtn = greyButton({
    id: `${btnPrefix}:noop:${currentPage}`,
    label: `‹ ${currentPage} / ${totalPages} ›`,
    disabled: true
  });

  const nextBtn = greyButton({
    id: `${btnPrefix}:next:${Math.min(totalPages, currentPage + 1)}`,
    label: 'Next ▶',
    disabled: !hasNext || disabled
  });

  const navRow = new ActionRowBuilder().addComponents(prevBtn, indicatorBtn, nextBtn);

  return {
    menuRow,
    navRow,
    page: currentPage,
    totalPages,
    totalItems,
    slice,
    isEmpty: false,
    summary: `Showing ${startIdx + 1}–${Math.min(startIdx + limit, totalItems)} of ${totalItems}`
  };
}

export default paginatedSelect;

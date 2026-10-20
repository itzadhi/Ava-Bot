import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';
import { theme } from '../../config/theme.js';
import * as format from './format.js';
import { getBrandAttachment } from '../../ui/theme.js';

/**
 * Standardizes title format: ensures ## heading and optional glyph
 * @param {string} title
 * @param {string} [glyph='']
 * @returns {string}
 */
function formatHeadingTitle(title = '', glyph = '') {
  let clean = String(title || '').trim();
  if (glyph && !clean.startsWith(glyph)) {
    clean = `${glyph} ${clean}`;
  }
  if (!clean.startsWith('## ') && !clean.startsWith('# ') && !clean.startsWith('### ')) {
    clean = `## ${clean}`;
  }
  return clean;
}

/**
 * Resolves buttons or components into Discord ActionRowBuilders (max 5 buttons per row)
 * @param {Array<ActionRowBuilder|ButtonBuilder|object>} components
 * @returns {ActionRowBuilder[]}
 */
export function packActionRows(components = []) {
  if (!Array.isArray(components) || components.length === 0) return [];

  const rows = [];
  const pendingButtons = [];

  for (const item of components) {
    if (!item) continue;
    if (item instanceof ActionRowBuilder) {
      if (pendingButtons.length > 0) {
        for (let i = 0; i < pendingButtons.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(...pendingButtons.slice(i, i + 5)));
        }
        pendingButtons.length = 0;
      }
      rows.push(item);
    } else if (item instanceof ButtonBuilder) {
      pendingButtons.push(item);
    } else if (item && typeof item === 'object') {
      if (item.customId && (item.label || item.emoji || item.style)) {
        pendingButtons.push(createButton(item));
      }
    }
  }

  if (pendingButtons.length > 0) {
    for (let i = 0; i < pendingButtons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(...pendingButtons.slice(i, i + 5)));
    }
  }

  return rows.slice(0, 5); // Discord allows max 5 ActionRows per message
}

/**
 * Core Components V2 Container Builder
 * Single container, rich markdown, optional thumbnail accessory, NO sidebar color strip, and action rows.
 * Strict V2: NEVER includes 'content' or 'embeds' properties.
 */
export function buildContainer({
  title = null,
  glyph = '',
  lines = [],
  description = null,
  thumbnail = null,
  footer = theme.footer.text,
  components = [],
  files = [],
  ephemeral = false
} = {}) {
  const container = new ContainerBuilder();
  const attachedFiles = Array.isArray(files) ? [...files] : [];

  // NO SIDEBAR COLOR: Containers are always clean, borderless dark cards

  let activeThumbnail = thumbnail;
  if (activeThumbnail && typeof activeThumbnail === 'string' && activeThumbnail.startsWith('attachment://logo.jpg')) {
    const brandAttachment = getBrandAttachment();
    if (brandAttachment) {
      attachedFiles.push(brandAttachment);
    } else {
      activeThumbnail = null;
    }
  }

  // Header section
  if (title) {
    const formattedTitle = formatHeadingTitle(title, glyph);
    if (activeThumbnail) {
      const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(formattedTitle))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(activeThumbnail));
      container.addSectionComponents(section);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(formattedTitle));
    }
  } else if (activeThumbnail) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(' '))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(activeThumbnail));
    container.addSectionComponents(section);
  }

  // Normalize lines / description content
  const contentBlocks = [];
  if (description) {
    contentBlocks.push(String(description));
  }

  if (Array.isArray(lines)) {
    const filteredLines = lines.filter(Boolean);
    if (filteredLines.length > 0) {
      contentBlocks.push(filteredLines.join('\n'));
    }
  } else if (lines) {
    contentBlocks.push(String(lines));
  }

  if (contentBlocks.length > 0) {
    if (title || activeThumbnail) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }

    let fullBody = contentBlocks.join('\n\n');
    if (footer) {
      fullBody = `${fullBody}\n\n${format.subtext(footer)}`;
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fullBody));
  } else if (footer) {
    if (title || activeThumbnail) {
      container.addSeparatorComponents(new SeparatorBuilder());
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(format.subtext(footer)));
  }

  // Action rows
  const actionRows = packActionRows(components);
  if (actionRows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const row of actionRows) {
      container.addActionRowComponents(row);
    }
  }

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }

  const payload = {
    flags,
    components: [container]
  };

  if (attachedFiles.length > 0) {
    payload.files = attachedFiles;
  }

  return payload;
}

/**
 * Success Card (✅ emoji, pure borderless dark container)
 */
export function successCard({
  title = 'Action Completed',
  lines = [],
  description = null,
  body = null,
  tip = null,
  footer = theme.footer.text,
  components = [],
  rows = [],
  files = [],
  ephemeral = false
} = {}) {
  const mergedComponents = [...components, ...rows];
  const allLines = [];
  if (description || body) allLines.push(description || body);
  if (Array.isArray(lines)) allLines.push(...lines);
  else if (lines) allLines.push(lines);

  if (tip) {
    allLines.push(`-# 💡 ${tip}`);
  }

  return buildContainer({
    title,
    glyph: theme.emojis.success,
    lines: allLines,
    footer,
    components: mergedComponents,
    files,
    ephemeral
  });
}

/**
 * Error Card (❌ emoji, pure borderless dark container)
 */
export function errorCard({
  title = 'Execution Error',
  reason = 'An unexpected internal error occurred.',
  fix = 'Check permissions and command arguments, then try again.',
  lines = [],
  footer = 'Safety Diagnostics • Argoni',
  components = [],
  rows = [],
  files = [],
  ephemeral = true
} = {}) {
  const mergedComponents = [...components, ...rows];
  const diagnosticLines = [
    `> 🛑 **Issue Encountered**\n> ${reason}`,
    `> 💡 **Recommended Solution**\n> ${fix}`
  ];

  if (Array.isArray(lines) && lines.length > 0) {
    diagnosticLines.push(...lines);
  }

  return buildContainer({
    title,
    glyph: theme.emojis.error,
    lines: diagnosticLines,
    footer,
    components: mergedComponents,
    files,
    ephemeral
  });
}

/**
 * Warning Card (⚠️ emoji, pure borderless dark container)
 */
export function warnCard({
  title = 'Warning',
  description = null,
  body = null,
  lines = [],
  footer = theme.footer.text,
  components = [],
  rows = [],
  files = [],
  ephemeral = false
} = {}) {
  const mergedComponents = [...components, ...rows];
  const allLines = [];
  if (description || body) allLines.push(description || body);
  if (Array.isArray(lines)) allLines.push(...lines);
  else if (lines) allLines.push(lines);

  return buildContainer({
    title,
    glyph: theme.emojis.warn,
    lines: allLines,
    footer,
    components: mergedComponents,
    files,
    ephemeral
  });
}

/**
 * Information Card (ℹ️ emoji, pure borderless dark container)
 */
export function infoCard({
  title = 'Information',
  description = null,
  body = null,
  lines = [],
  thumbnail = null,
  footer = theme.footer.text,
  components = [],
  rows = [],
  files = [],
  ephemeral = false
} = {}) {
  const mergedComponents = [...components, ...rows];
  const allLines = [];
  if (description || body) allLines.push(description || body);
  if (Array.isArray(lines)) allLines.push(...lines);
  else if (lines) allLines.push(lines);

  return buildContainer({
    title,
    glyph: theme.emojis.info,
    lines: allLines,
    thumbnail,
    footer,
    components: mergedComponents,
    files,
    ephemeral
  });
}

/**
 * Confirmation Card with Danger or Primary Confirm and Secondary Cancel
 */
export function confirmCard({
  title = 'Confirmation Required',
  text = null,
  details = null,
  confirmCustomId = 'confirm',
  cancelCustomId = 'cancel',
  confirmLabel = 'Confirm & Proceed',
  cancelLabel = 'Cancel',
  danger = true,
  footer = 'Action expires in 60s • Argoni',
  ephemeral = false
} = {}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmCustomId)
      .setLabel(confirmLabel)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setEmoji(danger ? theme.emojis.warn : theme.emojis.success),
    new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(theme.emojis.error)
  );

  return buildContainer({
    title,
    glyph: danger ? theme.emojis.warn : theme.emojis.info,
    lines: [text || details || 'Please confirm whether you want to proceed with this operation.'],
    footer,
    components: [row],
    ephemeral
  });
}

/**
 * Paginated Card with Prev, Next, and Close controls
 */
export function paginatedCard({
  title = 'Catalog',
  pages = [],
  currentPage = 1,
  totalPages = null,
  customIdPrefix = 'page',
  footer = null,
  extraButtons = [],
  extraRows = [],
  thumbnail = null
} = {}) {
  const safeTotal = totalPages || (Array.isArray(pages) && pages.length > 0 ? pages.length : 1);
  const safePage = Math.min(Math.max(currentPage, 1), safeTotal);

  let pageContent = '';
  if (Array.isArray(pages) && pages.length > 0) {
    pageContent = pages[safePage - 1] || '';
  }

  const buttons = [];
  if (Array.isArray(extraButtons) && extraButtons.length > 0) {
    buttons.push(...extraButtons.slice(0, 2));
  }

  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev:${safePage - 1}`)
      .setLabel('Prev')
      .setEmoji('◀')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next:${safePage + 1}`)
      .setLabel('Next')
      .setEmoji('▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= safeTotal),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:close`)
      .setLabel('Close')
      .setEmoji('✕')
      .setStyle(ButtonStyle.Danger)
  );

  const pagingRow = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
  const rows = [pagingRow, ...(extraRows || [])];

  const pageFooter = `Page ${safePage}/${safeTotal}${footer ? ` • ${footer}` : ` • ${theme.footer.text}`}`;

  return buildContainer({
    title,
    glyph: theme.emojis.sparkle,
    lines: [pageContent],
    thumbnail,
    footer: pageFooter,
    components: rows
  });
}

/**
 * Standardized Interactive Module Panel Card
 * Header with ON/OFF status chip, setting lines, and control buttons/selects
 */
export function panelCard({
  title,
  description = null,
  statusLines = [],
  buttons = [],
  selects = [],
  thumbnail = null,
  footer = 'Manage Server Required • Argoni Dashboard',
  isEnabled = null
} = {}) {
  let statusBadge = '';
  if (isEnabled === true) {
    statusBadge = `  ${theme.emojis.on} \`[ENABLED]\``;
  } else if (isEnabled === false) {
    statusBadge = `  ${theme.emojis.off} \`[DISABLED]\``;
  }

  const fullTitle = `${title}${statusBadge}`;

  const lines = [];
  if (description) {
    lines.push(description);
  }

  if (Array.isArray(statusLines) && statusLines.length > 0) {
    lines.push(...statusLines);
  }

  const allComponents = [];

  // Add select menus first (each select menu requires its own ActionRow)
  if (Array.isArray(selects)) {
    for (const sel of selects) {
      if (sel instanceof ActionRowBuilder) {
        allComponents.push(sel);
      } else if (sel) {
        allComponents.push(new ActionRowBuilder().addComponents(sel));
      }
    }
  }

  // Add buttons
  if (Array.isArray(buttons) && buttons.length > 0) {
    allComponents.push(...buttons);
  }

  return buildContainer({
    title: fullTitle,
    glyph: theme.emojis.gear,
    lines,
    thumbnail,
    footer,
    components: allComponents
  });
}

/**
 * Text Card - Converts any simple text into a compliant borderless Components V2 message
 */
export function textCard(text, { title = null, glyph = '', footer = theme.footer.text, components = [], ephemeral = false } = {}) {
  return buildContainer({
    title,
    glyph,
    lines: [text],
    footer,
    components,
    ephemeral
  });
}

/**
 * Creates an interactive ButtonBuilder from configuration
 */
export function createButton({
  id = null,
  customId = null,
  label = null,
  style = ButtonStyle.Secondary,
  emoji = null,
  url = null,
  disabled = false
} = {}) {
  const btn = new ButtonBuilder();
  if (url) {
    btn.setURL(url).setStyle(ButtonStyle.Link);
  } else {
    btn.setCustomId(id || customId || `btn_${Date.now()}`);
    btn.setStyle(resolveButtonStyle(style));
  }
  if (label) btn.setLabel(String(label));
  if (emoji) btn.setEmoji(emoji);
  if (disabled) btn.setDisabled(true);
  return btn;
}

/**
 * Creates a StringSelectMenuBuilder
 */
export function createStringSelect({
  id = null,
  customId = null,
  placeholder = 'Select an option...',
  options = [],
  minValues = 1,
  maxValues = 1,
  disabled = false
} = {}) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id || customId || `select_${Date.now()}`)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(maxValues)
    .setDisabled(disabled);

  if (Array.isArray(options) && options.length > 0) {
    menu.addOptions(
      options.map(opt => ({
        label: String(opt.label || opt.name || opt.value).slice(0, 100),
        value: String(opt.value || opt.id).slice(0, 100),
        description: opt.description ? String(opt.description).slice(0, 100) : undefined,
        emoji: opt.emoji || undefined,
        default: Boolean(opt.default)
      }))
    );
  }

  return menu;
}

/**
 * Creates a ChannelSelectMenuBuilder
 */
export function createChannelSelect({
  id = null,
  customId = null,
  placeholder = 'Select a channel...',
  channelTypes = [],
  minValues = 1,
  maxValues = 1,
  disabled = false
} = {}) {
  const menu = new ChannelSelectMenuBuilder()
    .setCustomId(id || customId || `ch_select_${Date.now()}`)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(maxValues)
    .setDisabled(disabled);

  if (Array.isArray(channelTypes) && channelTypes.length > 0) {
    menu.setChannelTypes(channelTypes);
  }

  return menu;
}

/**
 * Creates a RoleSelectMenuBuilder
 */
export function createRoleSelect({
  id = null,
  customId = null,
  placeholder = 'Select a role...',
  minValues = 1,
  maxValues = 1,
  disabled = false
} = {}) {
  return new RoleSelectMenuBuilder()
    .setCustomId(id || customId || `role_select_${Date.now()}`)
    .setPlaceholder(placeholder)
    .setMinValues(minValues)
    .setMaxValues(maxValues)
    .setDisabled(disabled);
}

/**
 * Creates a ModalBuilder with TextInput rows
 */
export function createModal({
  id = null,
  customId = null,
  title = 'Modal Form',
  inputs = [],
  fields = []
} = {}) {
  const modal = new ModalBuilder()
    .setCustomId(id || customId || `modal_${Date.now()}`)
    .setTitle(title.slice(0, 45));

  const allInputs = (Array.isArray(inputs) && inputs.length > 0) ? inputs : (Array.isArray(fields) ? fields : []);
  for (const input of allInputs) {
    const textInput = createTextInput(input);
    modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  }

  return modal;
}

/**
 * Creates a TextInputBuilder
 */
export function createTextInput({
  id = null,
  customId = null,
  label = 'Input',
  style = TextInputStyle.Short,
  paragraph = false,
  placeholder = '',
  value = null,
  required = true,
  minLength = null,
  maxLength = null
} = {}) {
  const input = new TextInputBuilder()
    .setCustomId(id || customId || `input_${Date.now()}`)
    .setLabel(label.slice(0, 45))
    .setStyle(paragraph || style === TextInputStyle.Paragraph || style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required);

  if (placeholder) input.setPlaceholder(String(placeholder).slice(0, 100));
  if (value) input.setValue(String(value));
  if (minLength !== null) input.setMinLength(minLength);
  if (maxLength !== null) input.setMaxLength(maxLength);

  return input;
}

/**
 * Helper to resolve ButtonStyle strings or integers
 */
function resolveButtonStyle(style) {
  if (typeof style === 'number') return style;
  switch (String(style).toLowerCase()) {
    case 'primary': return ButtonStyle.Primary;
    case 'secondary': return ButtonStyle.Secondary;
    case 'success': return ButtonStyle.Success;
    case 'danger': return ButtonStyle.Danger;
    case 'link': return ButtonStyle.Link;
    default: return ButtonStyle.Secondary;
  }
}

export default {
  buildContainer,
  successCard,
  errorCard,
  warnCard,
  infoCard,
  confirmCard,
  paginatedCard,
  panelCard,
  textCard,
  createButton,
  createStringSelect,
  createChannelSelect,
  createRoleSelect,
  createModal,
  createTextInput,
  packActionRows
};

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
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ComponentType
} from 'discord.js';
import { theme } from '../../config/theme.js';
import * as format from './format.js';

/**
 * Pure Components V2 UI Component Library
 * Strictly borderless cards (NO accent color / NO sidebar).
 * 100% compliant with Discord Components V2 specifications.
 */

/**
 * Builds a clean, borderless container card payload
 * Accepts either { blocks: [...] } or { title, lines, footer, rows, controls, blocks, ephemeral, files }
 * @param {object} options
 * @returns {object} Discord message payload
 */
export function container({
  title = null,
  lines = [],
  blocks = [],
  rows = [],
  controls = [],
  footer = null,
  thumbnail = null,
  ephemeral = false,
  files = []
} = {}) {
  const c = new ContainerBuilder();

  // If title was provided
  if (title) {
    const headingText = format.heading(2, title);
    if (thumbnail) {
      c.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail))
      );
    } else {
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText));
    }
  }

  // If lines were provided
  if (Array.isArray(lines) && lines.length > 0) {
    if (title) c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  for (const block of blocks) {
    if (!block) continue;
    if (typeof block === 'string' && block.trim()) {
      c.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
    } else if (block instanceof TextDisplayBuilder) {
      c.addTextDisplayComponents(block);
    } else if (block instanceof SectionBuilder) {
      c.addSectionComponents(block);
    } else if (block instanceof SeparatorBuilder) {
      c.addSeparatorComponents(block);
    } else if (block instanceof MediaGalleryBuilder) {
      c.addMediaGalleryComponents(block);
    } else if (block instanceof ActionRowBuilder) {
      c.addActionRowComponents(block);
    } else if (block.components || block.data?.type === ComponentType.ActionRow) {
      c.addActionRowComponents(block);
    }
  }

  const allRows = [...rows, ...controls];
  for (const row of allRows) {
    if (!row) continue;
    if (row instanceof ActionRowBuilder) {
      c.addActionRowComponents(row);
    } else if (Array.isArray(row)) {
      c.addActionRowComponents(new ActionRowBuilder().addComponents(row.slice(0, 5)));
    }
  }

  if (footer) {
    c.addSeparatorComponents(new SeparatorBuilder());
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(format.subtext(footer)));
  }

  const flags = ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;

  const payload = {
    flags,
    components: [c],
    allowedMentions: format.allowedMentionsNone
  };

  if (Array.isArray(files) && files.length > 0) {
    payload.files = files;
  }

  return payload;
}

/**
 * TextDisplay header: `## Title`
 * @param {string} title
 * @param {number} [level=2]
 */
export function header(title, level = 2) {
  return new TextDisplayBuilder().setContent(format.heading(level, title));
}

/**
 * Bulleted lines using the custom cyan dot emoji
 * @param {string[]} lines
 */
export function bulletLines(lines) {
  const dot = theme.emojis.dot || '•';
  const content = lines
    .filter(Boolean)
    .map(line => `${dot} ${line}`)
    .join('\n');
  return new TextDisplayBuilder().setContent(content);
}

/**
 * Chevron lines using the arrow emoji
 * @param {string[]} lines
 */
export function arrowLines(lines) {
  const arrow = theme.emojis.arrow || '❯';
  const content = lines
    .filter(Boolean)
    .map(line => `${arrow} ${line}`)
    .join('\n');
  return new TextDisplayBuilder().setContent(content);
}

/**
 * Pipe-separated blue markdown link row: `[Invite](url) | [Website](url) | [Support](url)`
 * Matches reference style exactly.
 * @param {Array<{label: string, url: string}>} links
 */
export function linkRow(links) {
  const masked = links
    .filter(l => l && l.label && l.url)
    .map(l => format.link(l.label, l.url))
    .join(' | ');
  return new TextDisplayBuilder().setContent(masked);
}

/**
 * Divider with separator line
 */
export function divider() {
  return new SeparatorBuilder();
}

/**
 * Greeting section with optional thumbnail accessory
 * @param {object} options
 * @param {string} options.text
 * @param {string} [options.thumbnailUrl]
 */
export function greetingSection({ text, thumbnailUrl }) {
  const section = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(text)
  );
  if (thumbnailUrl) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
  }
  return section;
}

/**
 * String select menu wrapped in ActionRow
 * @param {object} options
 * @param {string} options.id
 * @param {string} options.placeholder
 * @param {Array<{label: string, value: string, description?: string, emoji?: string}>} options.options
 */
export function categorySelect({ id, placeholder, options }) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

function getCardBody(opts, defaultVal = '') {
  if (Array.isArray(opts.lines) && opts.lines.length > 0) {
    return opts.lines.join('\n');
  }
  return opts.description || opts.reason || opts.warning || opts.text || defaultVal;
}

/**
 * Information Card
 */
export function infoCard(arg1, arg2, opts = {}) {
  let title = 'Information';
  let description = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Information';
    description = getCardBody(arg1);
    options = arg1;
  } else {
    title = arg1 || 'Information';
    description = typeof arg2 === 'object' && arg2 !== null ? getCardBody(arg2) : (arg2 || '');
  }

  const { fields = [], ephemeral = false, footer = null } = options;
  const blocks = [
    header(`${theme.emojis.info} ${title}`),
    divider()
  ];
  if (description) {
    blocks.push(new TextDisplayBuilder().setContent(description));
  }
  if (Array.isArray(fields) && fields.length > 0) {
    const fieldLines = fields.map(f => format.kvLine(f.name || f.label, f.value));
    blocks.push(new TextDisplayBuilder().setContent(fieldLines.join('\n')));
  }
  if (footer) {
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(footer)));
  }
  return container({ blocks, ephemeral });
}

/**
 * Success Card
 */
export function successCard(arg1, arg2, opts = {}) {
  let title = 'Success';
  let description = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Success';
    description = getCardBody(arg1);
    options = arg1;
  } else {
    title = arg1 || 'Success';
    description = typeof arg2 === 'object' && arg2 !== null ? getCardBody(arg2) : (arg2 || '');
  }

  const { ephemeral = false, actions = [] } = options;
  const blocks = [
    header(`${theme.emojis.success} ${title}`),
    divider()
  ];
  if (description) {
    blocks.push(new TextDisplayBuilder().setContent(description));
  }
  if (Array.isArray(actions) && actions.length > 0) {
    blocks.push(...actions);
  }
  return container({ blocks, ephemeral });
}

/**
 * Error Card
 */
export function errorCard(arg1, arg2, opts = {}) {
  let title = 'Error';
  let reason = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Error';
    reason = getCardBody(arg1, 'An unexpected error occurred.');
    options = arg1;
  } else {
    title = arg1 || 'Error';
    reason = typeof arg2 === 'object' && arg2 !== null ? getCardBody(arg2, 'An unexpected error occurred.') : (arg2 || 'An unexpected error occurred.');
  }

  const { hint = options.fix || null, ephemeral = true } = options;
  const blocks = [
    header(`${theme.emojis.error} ${title}`),
    divider(),
    new TextDisplayBuilder().setContent(reason)
  ];
  if (hint) {
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(`💡 Hint: ${hint}`)));
  }
  return container({ blocks, ephemeral });
}

/**
 * Warning Card
 */
export function warnCard(arg1, arg2, opts = {}) {
  let title = 'Warning';
  let warning = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Warning';
    warning = getCardBody(arg1);
    options = arg1;
  } else {
    title = arg1 || 'Warning';
    warning = typeof arg2 === 'object' && arg2 !== null ? getCardBody(arg2) : (arg2 || '');
  }

  const { hint = null, ephemeral = false } = options;
  const blocks = [
    header(`${theme.emojis.warn} ${title}`),
    divider()
  ];
  if (warning) {
    blocks.push(new TextDisplayBuilder().setContent(warning));
  }
  if (hint) {
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(hint)));
  }
  return container({ blocks, ephemeral });
}

/**
 * Cooldown Notification Card
 */
export function cooldownCard(commandName, resetTime, { ephemeral = true } = {}) {
  const blocks = [
    header(`⏳ Slow Down!`),
    divider(),
    new TextDisplayBuilder().setContent(
      `You are on cooldown for ${format.code(commandName)}.\nPlease wait until ${format.time(resetTime, 'R')} before trying again.`
    ),
    new TextDisplayBuilder().setContent(format.subtext(`Remaining cooldown: ${format.time(resetTime, 'T')}`))
  ];
  return container({ blocks, ephemeral });
}

/**
 * Permission Error Card
 */
export function permissionCard({ missing = [], isBot = false, ephemeral = true } = {}) {
  const subject = isBot ? 'I am missing' : 'You are missing';
  const permsList = missing.map(p => format.code(p)).join(', ');
  const blocks = [
    header(isBot ? '🤖 Bot Missing Permissions' : '🚫 Permission Denied'),
    divider(),
    new TextDisplayBuilder().setContent(
      `${subject} the required permission(s) to perform this action:\n${permsList}`
    ),
    new TextDisplayBuilder().setContent(format.subtext('Check your server role hierarchy and channel overrides.'))
  ];
  return container({ blocks, ephemeral });
}

/**
 * Command Usage Help Card
 */
export function usageCard({ name, prefix = 'a!', usage, description, examples = [], aliases = [], ephemeral = true }) {
  const blocks = [
    header(`📖 Command Usage: ${name}`),
    divider(),
    new TextDisplayBuilder().setContent(
      `${format.bold('Description:')} ${description || 'No description provided.'}\n` +
      `${format.bold('Syntax:')} ${format.code(`${prefix}${usage || name}`)}`
    )
  ];
  if (aliases.length > 0) {
    blocks.push(new TextDisplayBuilder().setContent(`${format.bold('Aliases:')} ${aliases.map(a => format.code(a)).join(', ')}`));
  }
  if (examples.length > 0) {
    const exLines = examples.map(e => `${theme.emojis.arrow} ${format.code(`${prefix}${e}`)}`);
    blocks.push(new TextDisplayBuilder().setContent(`${format.bold('Examples:')}\n${exLines.join('\n')}`));
  }
  return container({ blocks, ephemeral });
}

/**
 * Confirmation Card with Confirm/Cancel Buttons
 */
export function confirmCard(arg1, arg2, opts = {}) {
  let title = 'Confirmation';
  let description = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Confirmation';
    description = arg1.description || arg1.text || '';
    options = arg1;
  } else {
    title = arg1 || 'Confirmation';
    description = arg2 || '';
  }

  const {
    confirmId = options.confirmId || 'confirm',
    cancelId = options.cancelId || 'cancel',
    confirmLabel = options.confirmLabel || 'Confirm',
    cancelLabel = options.cancelLabel || 'Cancel',
    ephemeral = options.ephemeral ?? false
  } = options;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary)
  );

  const blocks = [
    header(`⚠️ ${title}`),
    divider()
  ];
  if (description) {
    blocks.push(new TextDisplayBuilder().setContent(description));
  }
  blocks.push(row);
  return container({ blocks, ephemeral });
}

/**
 * Paginated Card Helper
 */
export function paginatedCard({
  title,
  items = [],
  pages = [],
  page = 1,
  currentPage = 1,
  totalPages = null,
  pageSize = 10,
  formatter = (item, idx) => `${idx + 1}. ${item}`,
  customIdPrefix = 'page',
  extraBlocks = [],
  ephemeral = false
} = {}) {
  const contentList = (Array.isArray(pages) && pages.length > 0) ? pages : items;
  const calcTotalPages = totalPages || Math.max(1, Math.ceil(contentList.length / pageSize));
  const activePage = currentPage || page || 1;
  const safePage = Math.min(Math.max(activePage, 1), calcTotalPages);

  let formattedItems = '';
  if (Array.isArray(pages) && pages.length > 0) {
    formattedItems = pages[safePage - 1] || pages[0] || '_No items available._';
  } else {
    const start = (safePage - 1) * pageSize;
    const pageItems = contentList.slice(start, start + pageSize);
    formattedItems = pageItems.map((item, i) => formatter(item, start + i)).join('\n');
  }

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:first`)
      .setLabel('«')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev:${safePage - 1}`)
      .setLabel('‹ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:page`)
      .setLabel(`${safePage} / ${calcTotalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next:${safePage + 1}`)
      .setLabel('Next ›')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= calcTotalPages),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:close`)
      .setLabel('✕ Close')
      .setStyle(ButtonStyle.Secondary)
  );

  const blocks = [
    header(title),
    divider(),
    new TextDisplayBuilder().setContent(formattedItems || '_No items available._'),
    ...extraBlocks,
    divider(),
    new TextDisplayBuilder().setContent(format.subtext(`Page ${safePage} of ${calcTotalPages} • Total: ${contentList.length}`)),
    navRow
  ];

  return container({ blocks, ephemeral });
}

/**
 * Generic List Card Helper
 */
export function listCard({ title, items = [], bullet = theme.emojis.dot, ephemeral = false }) {
  const content = items.map(i => `${bullet} ${i}`).join('\n');
  const blocks = [
    header(title),
    divider(),
    new TextDisplayBuilder().setContent(content || '_Empty list._')
  ];
  return container({ blocks, ephemeral });
}

/**
 * Telemetry & Statistics Card
 */
export function statsCard({ title = 'System Statistics', stats = [], charts = '', ephemeral = false }) {
  const statLines = stats.map(s => format.kvLine(s.label, s.value)).join('\n');
  const blocks = [
    header(`📊 ${title}`),
    divider(),
    new TextDisplayBuilder().setContent(statLines)
  ];
  if (charts) {
    blocks.push(new TextDisplayBuilder().setContent(charts));
  }
  return container({ blocks, ephemeral });
}

/**
 * Member / Bot Profile Card
 */
export function profileCard({ user, title, lines = [], avatarUrl, ephemeral = false }) {
  const greeting = `Hey **${user?.username || 'there'}**!`;
  const sec = greetingSection({
    text: `${greeting}\n${lines.join('\n')}`,
    thumbnailUrl: avatarUrl || user?.displayAvatarURL?.()
  });
  const blocks = [
    header(`👤 ${title || user?.username || 'Profile'}`),
    divider(),
    sec
  ];
  return container({ blocks, ephemeral });
}

/**
 * Leaderboard Ranking Card
 */
export function leaderboardCard({ title, entries = [], userRank = null, ephemeral = false }) {
  const medals = ['🥇', '🥈', '🥉'];
  const formatted = entries.map((entry, idx) => {
    const badge = medals[idx] || `\`#${idx + 1}\``;
    return `${badge} **${entry.name}:** ${entry.value}`;
  }).join('\n');

  const blocks = [
    header(`🏆 ${title}`),
    divider(),
    new TextDisplayBuilder().setContent(formatted || '_No leaderboard data._')
  ];

  if (userRank) {
    blocks.push(divider());
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(`Your rank: #${userRank.position} • ${userRank.value}`)));
  }

  return container({ blocks, ephemeral });
}

/**
 * Moderation Action Result Card
 */
export function moderationResultCard({
  action,
  target,
  moderator,
  reason,
  caseId,
  duration = null,
  undoButton = null
}) {
  const lines = [
    format.kvLine('Target', `${format.userMention(target.id)} (${format.escapeMarkdown(target.tag || target.username)} • \`${target.id}\`)`),
    format.kvLine('Moderator', `${format.userMention(moderator.id)} (\`${moderator.id}\`)`)
  ];

  if (duration) {
    lines.push(format.kvLine('Duration', duration));
  }
  if (caseId) {
    lines.push(format.kvLine('Case ID', format.code(caseId)));
  }

  lines.push(format.kvLine('Timestamp', format.time(new Date(), 'R')));

  const blocks = [
    header(`🔨 ${action}`),
    divider(),
    new TextDisplayBuilder().setContent(lines.join('\n'))
  ];

  if (reason) {
    blocks.push(new TextDisplayBuilder().setContent(`> 📜 **Reason:** ${format.escapeMarkdown(reason)}`));
  }

  if (undoButton) {
    const row = new ActionRowBuilder().addComponents(undoButton);
    blocks.push(row);
  }

  return container({ blocks, ephemeral: false });
}

/**
 * Server Event Audit Log Card (Clean Dark Card, No Accent Color)
 */
export function logCard({
  category = 'server',
  emoji = '📢',
  action,
  user,
  channel,
  moderator,
  reason,
  details = [],
  beforeText = null,
  afterText = null
}) {
  const blocks = [
    header(`${emoji} ${action}`),
    divider()
  ];

  const metaLines = [];
  if (user) {
    metaLines.push(format.kvLine('User', `${format.userMention(user.id)} (${format.escapeMarkdown(user.tag || user.username)} • \`${user.id}\`)`));
  }
  if (channel) {
    metaLines.push(format.kvLine('Channel', format.channelMention(channel.id || channel)));
  }
  if (moderator) {
    metaLines.push(format.kvLine('Moderator', `${format.userMention(moderator.id)} (\`${moderator.id}\`)`));
  }
  if (details.length > 0) {
    metaLines.push(...details.map(d => typeof d === 'string' ? d : format.kvLine(d.label, d.value)));
  }

  metaLines.push(format.kvLine('Timestamp', format.timeLongAndRelative(new Date())));

  blocks.push(new TextDisplayBuilder().setContent(metaLines.join('\n')));

  if (reason) {
    blocks.push(new TextDisplayBuilder().setContent(`> 📜 **Reason:** ${format.escapeMarkdown(reason)}`));
  }

  if (beforeText !== null && afterText !== null) {
    blocks.push(
      new TextDisplayBuilder().setContent(
        `> 📝 **Before Edit:**\n` +
        format.codeBlock('diff', `- ${format.truncate(format.escapeMarkdown(beforeText), 600)}`) +
        `\n> 📝 **After Edit:**\n` +
        format.codeBlock('diff', `+ ${format.truncate(format.escapeMarkdown(afterText), 600)}`)
      )
    );
  }

  blocks.push(new TextDisplayBuilder().setContent(format.subtext(`Category: ${category} • AVA Vault`)));

  return container({ blocks, ephemeral: false });
}

/**
 * Control Panel Card
 */
export function panelCard({
  title,
  status = null,
  isEnabled = null,
  statusLines = [],
  lines = [],
  buttons = [],
  controls = [],
  footer = null,
  ephemeral = false
} = {}) {
  let statusBadge = status;
  if (!statusBadge && isEnabled !== null) {
    statusBadge = isEnabled ? `${theme.emojis.on} [ACTIVE]` : `${theme.emojis.off} [DISABLED]`;
  }

  const blocks = [
    header(statusBadge ? `${title}  ${statusBadge}` : title),
    divider()
  ];

  const allLines = [...(Array.isArray(statusLines) ? statusLines : []), ...(Array.isArray(lines) ? lines : [])];
  if (allLines.length > 0) {
    blocks.push(new TextDisplayBuilder().setContent(allLines.join('\n')));
  }

  const allControls = [...(Array.isArray(buttons) ? buttons : []), ...(Array.isArray(controls) ? controls : [])];
  if (allControls.length > 0) {
    blocks.push(divider());
    blocks.push(...allControls);
  }

  if (footer) {
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(footer)));
  }

  return container({ blocks, ephemeral });
}

/**
 * Clean text card helper
 */
export function textCard(text, { ephemeral = false } = {}) {
  const content = typeof text === 'string' ? text : String(text || '');
  return container({
    blocks: [new TextDisplayBuilder().setContent(content)],
    ephemeral
  });
}

/** Alias buildContainer -> container for backwards compatibility */
export const buildContainer = container;

/** Helper to resolve ButtonStyle strings or integers */
function resolveButtonStyle(style) {
  if (style === ButtonStyle.Link || String(style || '').toLowerCase() === 'link') {
    return ButtonStyle.Link;
  }
  return ButtonStyle.Secondary;
}

/**
 * Creates a ButtonBuilder
 */
export function createButton({
  id = null,
  customId = null,
  label = null,
  style = ButtonStyle.Secondary,
  emoji = null,
  disabled = false,
  url = null
} = {}) {
  const btn = new ButtonBuilder().setDisabled(disabled);

  if (url) {
    btn.setURL(url).setStyle(ButtonStyle.Link);
  } else {
    btn.setCustomId(id || customId || `btn_${Date.now()}`).setStyle(resolveButtonStyle(style));
  }

  if (label) btn.setLabel(String(label).slice(0, 80));
  if (emoji) btn.setEmoji(emoji);

  return btn;
}

/**
 * Creates an ActionRowBuilder with components
 */
export function createActionRow(...components) {
  const row = new ActionRowBuilder();
  const items = components.flat();
  if (items.length > 0) {
    row.addComponents(items.slice(0, 5));
  }
  return row;
}

/**
 * Chunks an array of button builders into valid ActionRowBuilder instances (max 5 per row)
 */
export function packActionRows(components, maxPerRow = 5) {
  const rows = [];
  const items = Array.isArray(components) ? components : [components];

  for (let i = 0; i < items.length; i += maxPerRow) {
    const chunk = items.slice(i, i + maxPerRow);
    rows.push(new ActionRowBuilder().addComponents(chunk));
  }

  return rows;
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
        value: String(opt.value || opt.id || opt.label),
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

export default {
  container,
  buildContainer,
  header,
  bulletLines,
  arrowLines,
  linkRow,
  divider,
  greetingSection,
  categorySelect,
  infoCard,
  successCard,
  errorCard,
  warnCard,
  cooldownCard,
  permissionCard,
  usageCard,
  confirmCard,
  paginatedCard,
  listCard,
  statsCard,
  profileCard,
  leaderboardCard,
  moderationResultCard,
  logCard,
  panelCard,
  textCard,
  createButton,
  createActionRow,
  packActionRows,
  createStringSelect,
  createChannelSelect,
  createRoleSelect,
  createModal,
  createTextInput
};

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
 * @param {object} options
 * @param {Array<any>} [options.blocks=[]] Items to add to container
 * @param {boolean} [options.ephemeral=false]
 * @param {Array<any>} [options.files] Optional attachments
 * @returns {object} Discord message payload
 */
export function container({ blocks = [], ephemeral = false, files = [] } = {}) {
  const c = new ContainerBuilder();

  for (const block of blocks) {
    if (!block) continue;
    if (typeof block === 'string') {
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

/**
 * Information Card
 */
export function infoCard(title, description, { fields = [], ephemeral = false, footer = null } = {}) {
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
 * Information Card
 */
export function infoCard(arg1, arg2, opts = {}) {
  let title = 'Information';
  let description = '';
  let options = opts;

  if (typeof arg1 === 'object' && arg1 !== null) {
    title = arg1.title || 'Information';
    description = arg1.description || arg1.text || '';
    options = arg1;
  } else {
    title = arg1 || 'Information';
    description = arg2 || '';
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
    description = arg1.description || arg1.text || '';
    options = arg1;
  } else {
    title = arg1 || 'Success';
    description = arg2 || '';
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
    reason = arg1.reason || arg1.description || arg1.text || 'An unexpected error occurred.';
    options = arg1;
  } else {
    title = arg1 || 'Error';
    reason = arg2 || 'An unexpected error occurred.';
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
    warning = arg1.warning || arg1.reason || arg1.description || '';
    options = arg1;
  } else {
    title = arg1 || 'Warning';
    warning = arg2 || '';
  }

  const { hint = null, ephemeral = false } = options;
  const blocks = [
    header(`${theme.emojis.warn} ${title}`),
    divider(),
    new TextDisplayBuilder().setContent(warning)
  ];
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
    header(`🚫 Missing Permissions`),
    divider(),
    new TextDisplayBuilder().setContent(
      `${subject} the required permissions to perform this action:\n${permsList}`
    ),
    new TextDisplayBuilder().setContent(format.subtext(`Check your server role hierarchy and channel overrides.`))
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
export function confirmCard({
  title,
  description,
  confirmId,
  cancelId,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  ephemeral = true
}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel(confirmLabel)
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(cancelId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary)
  );

  const blocks = [
    header(`⚠️ ${title}`),
    divider(),
    new TextDisplayBuilder().setContent(description),
    row
  ];
  return container({ blocks, ephemeral });
}

/**
 * Paginated Card Helper
 */
export function paginatedCard({
  title,
  items = [],
  page = 1,
  pageSize = 10,
  formatter = (item, idx) => `${idx + 1}. ${item}`,
  customIdPrefix,
  extraBlocks = [],
  ephemeral = false
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const pageItems = items.slice(start, start + pageSize);

  const formattedItems = pageItems.map((item, i) => formatter(item, start + i)).join('\n');

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:first`)
      .setLabel('«')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev:${safePage - 1}`)
      .setLabel('‹ Prev')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:page`)
      .setLabel(`${safePage} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next:${safePage + 1}`)
      .setLabel('Next ›')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(safePage >= totalPages),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:close`)
      .setLabel('✕ Close')
      .setStyle(ButtonStyle.Danger)
  );

  const blocks = [
    header(title),
    divider(),
    new TextDisplayBuilder().setContent(formattedItems || '_No items available._'),
    ...extraBlocks,
    divider(),
    new TextDisplayBuilder().setContent(format.subtext(`Page ${safePage} of ${totalPages} • Total items: ${items.length}`)),
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

  blocks.push(new TextDisplayBuilder().setContent(format.subtext(`Category: ${category} • Argoni Vault`)));

  return container({ blocks, ephemeral: false });
}

/**
 * Control Panel Card
 */
export function panelCard({
  title,
  status = null,
  lines = [],
  controls = [],
  footer = null,
  ephemeral = false
}) {
  const blocks = [
    header(status ? `${title}  ${status}` : title),
    divider()
  ];

  if (lines.length > 0) {
    blocks.push(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  if (controls.length > 0) {
    blocks.push(divider());
    blocks.push(...controls);
  }

  if (footer) {
    blocks.push(new TextDisplayBuilder().setContent(format.subtext(footer)));
  }

  return container({ blocks, ephemeral });
}

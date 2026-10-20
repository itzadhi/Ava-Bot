import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  MessageFlags
} from 'discord.js';
import { theme } from '../../config/theme.js';
import * as format from '../../utils/ui/format.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { getModuleData, setModuleData } from '../../db/moduleData.js';
import { logger } from '../../utils/logger.js';

// In-memory cache for fast lookup during high-throughput events (60s TTL)
const configCache = new Map();
const CACHE_TTL = 60000;

export const LOG_CATEGORIES = {
  mod: { name: 'Moderation', emoji: '🛡️', desc: 'Bans, kicks, timeouts, unbans & mod commands' },
  messages: { name: 'Messages', emoji: '💬', desc: 'Message deletes, edits & bulk purges' },
  members: { name: 'Members', emoji: '👥', desc: 'Joins, leaves & nickname changes' },
  roles: { name: 'Roles', emoji: '🧲', desc: 'Role add/remove & role creates/updates' },
  channels: { name: 'Channels', emoji: '📁', desc: 'Channel creates, updates & deletions' },
  voice: { name: 'Voice', emoji: '🔊', desc: 'Voice joins, leaves, moves & mute/deafens' },
  server: { name: 'Server', emoji: '🌐', desc: 'Invites, emojis, stickers & guild updates' }
};

/**
 * Retrieves logging configuration for a guild
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function getLogConfig(guildId) {
  const cached = configCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const [dbData, settings] = await Promise.all([
    getModuleData('logs', 'config', guildId).catch(() => null),
    getGuildSettings(guildId).catch(() => null)
  ]);

  const fallbackChannel = settings?.log_channel_id || null;

  const defaultCategories = {
    mod: true,
    messages: true,
    members: true,
    roles: true,
    channels: true,
    voice: true,
    server: true
  };

  const defaultChannels = {
    mod: null,
    messages: null,
    members: null,
    roles: null,
    channels: null,
    voice: null,
    server: null
  };

  const config = {
    enabled: dbData?.enabled !== false && Boolean(fallbackChannel || Object.values(dbData?.channels || {}).some(Boolean)),
    globalChannelId: fallbackChannel,
    categories: { ...defaultCategories, ...(dbData?.categories || {}) },
    channels: { ...defaultChannels, ...(dbData?.channels || {}) }
  };

  configCache.set(guildId, { data: config, timestamp: Date.now() });
  return config;
}

/**
 * Updates logging configuration for a guild
 * @param {string} guildId
 * @param {object} patch
 */
export async function updateLogConfig(guildId, patch) {
  const current = await getLogConfig(guildId);
  const updated = {
    ...current,
    ...patch,
    categories: { ...current.categories, ...(patch.categories || {}) },
    channels: { ...current.channels, ...(patch.channels || {}) }
  };

  if (patch.globalChannelId !== undefined) {
    await updateGuildSettings(guildId, { log_channel_id: patch.globalChannelId });
  }

  await setModuleData('logs', 'config', {
    enabled: updated.enabled,
    categories: updated.categories,
    channels: updated.channels
  }, guildId);

  configCache.set(guildId, { data: updated, timestamp: Date.now() });
  return updated;
}

/**
 * Builds a standardized Components V2 Server Log Card
 * @param {object} options
 */
export function buildLogCard({
  eventName,
  emoji = '📢',
  category = 'server',
  user = null,
  moderator = null,
  channel = null,
  reason = null,
  details = [],
  beforeText = null,
  afterText = null,
  content = null,
  attachments = [],
  thumbnail = null,
  targetId = null,
  timestamp = new Date()
}) {
  const catInfo = LOG_CATEGORIES[category] || LOG_CATEGORIES.server;
  const container = new ContainerBuilder();

  // 1. Heading (event type identified by emoji + bold title)
  const titleText = `## ${emoji} ${eventName}`;
  const userAvatar = thumbnail || user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null;

  if (userAvatar) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(userAvatar));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // 2. Metadata Lines
  const metaLines = [];
  if (user) {
    const userTag = user.tag || user.username || user.id;
    metaLines.push(format.kvLine('User', `${format.userMention(user.id)} (${format.escapeMarkdown(userTag)} • \`${user.id}\`)`));
  }

  if (channel) {
    metaLines.push(format.kvLine('Channel', format.channelMention(channel.id || channel)));
  }

  if (moderator) {
    metaLines.push(format.kvLine('Moderator', `${format.userMention(moderator.id)} (\`${moderator.id}\`)`));
  }

  if (Array.isArray(details) && details.length > 0) {
    metaLines.push(...details.map(d => typeof d === 'string' ? d : format.kvLine(d.label, d.value)));
  }

  // 3. Reason Quote
  if (reason) {
    metaLines.push(`> 📜 **Reason:** ${format.escapeMarkdown(reason)}`);
  }

  // 4. Message Edit Diff Block
  if (beforeText !== null && afterText !== null) {
    metaLines.push(
      `> 📝 **Before Edit:**`,
      format.codeBlock('diff', `- ${format.truncate(format.escapeMarkdown(beforeText), 600)}`),
      `> 📝 **After Edit:**`,
      format.codeBlock('diff', `+ ${format.truncate(format.escapeMarkdown(afterText), 600)}`)
    );
  }

  // 5. Message Content Block (for delete)
  if (content) {
    metaLines.push(
      `> 💬 **Deleted Message Content:**`,
      `>>> ${format.truncate(format.escapeMarkdown(content), 1000)}`
    );
  }

  // 6. Attachments List
  if (Array.isArray(attachments) && attachments.length > 0) {
    const attList = attachments.map(a => `• [${format.escapeMarkdown(a.name || 'Attachment')}](${a.url})`).join('\n');
    metaLines.push(`> 📎 **Attachments (${attachments.length}):**\n${attList}`);
  }

  // 7. Timestamps using <t:unix:F> and <t:unix:R> together
  metaLines.push(format.kvLine('Timestamp', format.timeLongAndRelative(timestamp)));

  // Footer subtext with ID
  const footerLine = format.subtext(`ID: ${targetId || user?.id || 'N/A'} • Category: ${catInfo.name} • ${theme.footer.text}`);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${metaLines.join('\n')}\n\n${footerLine}`)
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: format.allowedMentionsNone
  };
}

/**
 * Safely dispatches a log card to the appropriate server log channel
 * @param {import('discord.js').Guild} guild
 * @param {object} params
 * @param {string} params.category
 * @param {object} params.cardPayload
 */
export async function dispatchLog(guild, { category = 'server', cardPayload }) {
  if (!guild || !cardPayload) return;

  try {
    const config = await getLogConfig(guild.id);
    if (!config.enabled) return;
    if (config.categories[category] === false) return;

    const targetChanId = config.channels[category] || config.globalChannelId;
    if (!targetChanId) return;

    const channel = guild.channels?.cache?.get(targetChanId) || await guild.channels?.fetch?.(targetChanId).catch(() => null);
    if (!channel || !channel.isTextBased()) return;

    await channel.send(cardPayload).catch(err => {
      logger.debug({ err, guildId: guild.id, channelId: targetChanId }, 'Could not dispatch server log');
    });
  } catch (err) {
    logger.debug({ err, guildId: guild?.id }, 'Error during log dispatching');
  }
}

/**
 * Builds the interactive Components V2 Server Logs Panel
 * @param {import('discord.js').Guild} guild
 * @param {object} [activeCategory='all']
 */
export async function buildLogsPanel(guild, activeCategory = 'all') {
  const config = await getLogConfig(guild.id);
  const container = new ContainerBuilder();

  const isEnabled = config.enabled;
  const globalChanDisplay = config.globalChannelId ? `<#${config.globalChannelId}>` : '_None (Not configured)_';

  // 1. Heading
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 📢 Server Logs Interactive Manager  ${isEnabled ? `${theme.emojis.on} \`[ACTIVE]\`` : `${theme.emojis.off} \`[DISABLED]\``}`
    )
  );

  // 2. Settings lines
  const lines = [
    'Automated audit logging with Components V2 container cards, color-coded categories, and diff comparisons.',
    '',
    `${theme.emojis.dot} **Global Log Channel:** ${globalChanDisplay}`,
    `${theme.emojis.dot} **Category Status:**`
  ];

  for (const [key, cat] of Object.entries(LOG_CATEGORIES)) {
    const isCatOn = config.categories[key] !== false;
    const catChan = config.channels[key] ? `<#${config.channels[key]}>` : 'Global channel';
    lines.push(`  ${isCatOn ? '🟢' : '⚪'} **${cat.name}:** ${catChan}`);
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${lines.join('\n')}\n\n${format.subtext('Manage Server Required • Changes save immediately')}`)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // Controls Row 1: Global Channel Select Menu
  const chanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('fb:logs:set_global_chan:0')
    .setPlaceholder('📢 Route All Logs to Channel...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  // Controls Row 2: Category Select Menu to toggle or route
  const catSelect = new StringSelectMenuBuilder()
    .setCustomId('fb:logs:toggle_cat:0')
    .setPlaceholder('🎛️ Toggle Logging Category On/Off...')
    .addOptions(
      Object.entries(LOG_CATEGORIES).map(([key, cat]) => ({
        label: `${cat.name} Logging`,
        value: key,
        description: cat.desc,
        emoji: cat.emoji,
        default: config.categories[key] !== false
      }))
    );

  // Controls Row 3: Action Buttons
  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:logs:toggle_master:0')
      .setLabel(isEnabled ? 'Disable Logging' : 'Enable Logging')
      .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success)
      .setEmoji(isEnabled ? theme.emojis.off : theme.emojis.on),
    new ButtonBuilder()
      .setCustomId('fb:logs:test:0')
      .setLabel('Send Test Log')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔔'),
    new ButtonBuilder()
      .setCustomId('fb:logs:refresh:0')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId('dash:return')
      .setLabel('Dashboard')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(chanSelect),
    new ActionRowBuilder().addComponents(catSelect),
    btnRow
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

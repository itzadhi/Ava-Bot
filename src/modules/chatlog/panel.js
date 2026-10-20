import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType
} from 'discord.js';
import { card, errorCard, successCard } from '../../ui/cards.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getGuildVaultStats, getChannelVaultMessages } from './engine.js';

/**
 * Renders the mobile-friendly centralized Automatic Chat Vault Panel
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} [params.channel]
 * @returns {Promise<object>}
 */
export async function renderChatlogPanel({ guild, channel = null }) {
  const settings = await getGuildSettings(guild.id);
  const activeChannel = channel || guild.channels.cache.find(c => c.isTextBased() && !c.isVoiceBased?.()) || null;
  const stats = getGuildVaultStats(guild.id);

  // Measure current channel messages ready for instant recovery
  let currentChannelCount = 0;
  if (activeChannel) {
    try {
      const msgs = await getChannelVaultMessages({ guild, channel: activeChannel, limit: 100 });
      currentChannelCount = msgs.length;
    } catch (_) {}
  }

  const isEnabled = Boolean(settings.chatlog_enabled);
  const statusLine = isEnabled
    ? '🟢 **Real-Time Auto-Vault: Active**\n> All server messages are continuously captured and encrypted in the background.'
    : '🔴 **Auto-Vault: Inactive**\n> Background protection is currently disabled. Tap **Enable Vault** below to activate.';

  const channelText = activeChannel ? `<#${activeChannel.id}>` : '_None_';

  const textChannels = Array.from(guild.channels?.cache?.values?.() || [])
    .filter(c => typeof c.isTextBased === 'function' && c.isTextBased() && !c.isVoiceBased?.());

  const overviewBlock = [
    statusLine,
    '',
    `• 📁 **Active Channel**: ${channelText} (**${currentChannelCount} messages** ready)`,
    `• 🛡️ **Protected Channels**: **${Math.max(stats.trackedChannels, textChannels.length)} channels**`,
    `• 🔒 **Security**: \`AES-256-GCM Encrypted\``,
    `• ⚡ **Restoration Mode**: **Full Automatic** (No manual files or archives needed)`,
    '',
    '💡 Tap **Restore This Channel** below to instantly recover all chat history via webhooks.'
  ].join('\n');

  const rows = [];

  // Dropdown: Channel Selector to restore any specific channel
  const selectableChannels = textChannels.slice(0, 25);

  if (selectableChannels.length > 0) {
    const options = selectableChannels.map(ch => {
      const isCurrent = activeChannel && ch.id === activeChannel.id;
      return new StringSelectMenuOptionBuilder()
        .setLabel(`#${ch.name.slice(0, 24)}`)
        .setValue(`restore_target:${ch.id}`)
        .setDescription(isCurrent ? 'Current active channel' : `Auto-restore #${ch.name.slice(0, 20)}`)
        .setEmoji('💬');
    });

    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`chatlog_select_channel:${guild.id}`)
        .setPlaceholder('🎯 Select channel to restore...')
        .addOptions(options)
    ));
  }

  // Row 1: Instant Action Buttons
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chatlog_auto_restore_current:${guild.id}`)
      .setLabel('Restore This Channel')
      .setStyle(ButtonStyle.Success)
      .setEmoji('⚡'),
    new ButtonBuilder()
      .setCustomId(`chatlog_auto_restore_all:${guild.id}`)
      .setLabel('Restore All Channels')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`chatlog_btn_refresh:${guild.id}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄')
  );
  rows.push(actionRow);

  return card({
    title: 'Autonomous Chat Vault',
    glyph: '⚡',
    subtitle: `Real-time chat protection for ${guild.name}`,
    body: overviewBlock,
    subtext: 'Argoni Autonomous Vault • Zero manual archiving required',
    rows,
    thumbnail: guild.iconURL() || 'attachment://logo.jpg'
  });
}

/**
 * Renders channel restoration confirmation card
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} params.channel
 * @param {number} params.messageCount
 * @returns {object}
 */
export function renderChannelRestorePrompt({ guild, channel, messageCount }) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chatlog_confirm_restore:${channel.id}`)
      .setLabel(`Confirm Restore (${messageCount} msgs)`)
      .setStyle(ButtonStyle.Success)
      .setEmoji('⚡'),
    new ButtonBuilder()
      .setCustomId(`chatlog_btn_refresh:${guild.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('✖️')
  );

  return card({
    title: `Auto-Restore: #${channel.name}`,
    glyph: '⚡',
    subtitle: `${messageCount} messages ready for recovery`,
    body: [
      `Ready to restore **${messageCount} messages** into <#${channel.id}>.`,
      '',
      '• 🤖 **Engine**: High-speed webhook replay stream',
      '• 🎨 **Formatting**: Rich embeds, bot cards, attachments & author avatars preserved',
      '• ⏱️ **Duration**: ~2-5 seconds depending on message count',
      '',
      '⚠️ Replay will stream messages into this channel. Tap **Confirm Restore** to begin.'
    ].join('\n'),
    subtext: 'Argoni Autonomous Recovery Engine',
    rows: [row],
    thumbnail: guild.iconURL() || 'attachment://logo.jpg'
  });
}

export default {
  renderChatlogPanel,
  renderChannelRestorePrompt
};

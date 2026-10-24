import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { card, errorCard, successCard } from '../../ui/cards.js';
import { getGuildSettings, updateGuildSettings, clearGuildSettingsCache } from '../../db/guilds.js';
import { logAudit } from '../../db/audit.js';

/**
 * Renders the mobile-friendly centralized Server Settings Panel
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @returns {Promise<object>}
 */
export async function renderSettingsPanel({ guild }) {
  const settings = await getGuildSettings(guild.id);

  const block1 = [
    `**Server**: **${guild.name}** (\`${guild.id}\`)`,
    '',
    `• ⚡ **Prefix**: \`${settings.prefix || 'a!'}\` (${settings.prefix_commands_enabled ? 'Enabled' : 'Disabled'})`,
    `• 💬 **Chatlog Vault**: ${settings.chatlog_enabled ? '🟢 `[Active]`' : '🔴 `[Disabled]`'}`,
    `• 🔄 **Message Sync**: ${settings.message_sync_enabled ? '🟢 `[Active]`' : '🔴 `[Disabled]`'}`,
    `• 📢 **Log Channel**: ${settings.log_channel_id ? `<#${settings.log_channel_id}>` : '_None_'}`,
    `• 🛡️ **Backup Role**: ${settings.backup_role_id ? `<@&${settings.backup_role_id}>` : '_None_'}`,
    `• 👑 **Server Owner**: <@${guild.ownerId}>`
  ].join('\n');

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`set_toggle_chatlog:${guild.id}`)
      .setLabel(settings.chatlog_enabled ? 'Chatlog: ON' : 'Chatlog: OFF')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💬'),
    new ButtonBuilder()
      .setCustomId(`set_toggle_sync:${guild.id}`)
      .setLabel(settings.message_sync_enabled ? 'Sync: ON' : 'Sync: OFF')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId(`set_toggle_prefix:${guild.id}`)
      .setLabel(settings.prefix_commands_enabled ? 'Prefix: ON' : 'Prefix: OFF')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⌨️'),
    new ButtonBuilder()
      .setCustomId(`set_btn_reset:${guild.id}`)
      .setLabel('Reset')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
    new ButtonBuilder()
      .setCustomId('fb:panel:tab:sug')
      .setLabel('Staff Ops Panel')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛡️')
  );

  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(`set_sel_log_channel:${guild.id}`)
    .setPlaceholder('📢 Select Backup & Audit Log Channel')
    .setChannelTypes(ChannelType.GuildText);

  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`set_sel_backup_role:${guild.id}`)
    .setPlaceholder('🛡️ Select Backup Manager Role');

  const rows = [
    new ActionRowBuilder().addComponents(channelSelect),
    new ActionRowBuilder().addComponents(roleSelect),
    buttonsRow
  ];

  return card({
    title: 'Server Settings',
    glyph: '⚙️',
    subtitle: `Configuration for ${guild.name}`,
    body: `${block1}\n\n💡 Use the menus above to set channels/roles, or tap buttons to toggle features.`,
    subtext: null,
    rows,
    thumbnail: guild.iconURL() || 'attachment://logo.jpg'
  });
}

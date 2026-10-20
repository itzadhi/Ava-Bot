import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import {
  getTicketSettings,
  updateTicketSettings,
  getTicketCategories,
  getTicketBlacklist
} from '../../db/tickets.js';

export const SETTINGS_TABS = [
  { id: 'general', label: 'General', emoji: '⚙️', desc: 'System enable, ticket types, limits & cooldown' },
  { id: 'staff', label: 'Staff Roles', emoji: '👥', desc: 'Support roles and ticket administrator permissions' },
  { id: 'channels', label: 'Channels & Logs', emoji: '📢', desc: 'Log channel, transcript channel & parent category' },
  { id: 'categories', label: 'Categories', emoji: '📁', desc: 'Manage ticket departments & form questions' },
  { id: 'autoclose', label: 'Auto-Close', emoji: '⏱️', desc: 'Inactivity timers, warning alerts & deletion delays' },
  { id: 'ratings', label: 'Ratings', emoji: '⭐', desc: 'Post-close 1-5 star reviews and customer feedback' },
  { id: 'messages', label: 'Messages', emoji: '💬', desc: 'Custom welcome & close message templates' },
  { id: 'blacklist', label: 'Blacklist', emoji: '🚫', desc: 'Manage restricted users and blocked roles' }
];

/**
 * Builds the interactive Settings Dashboard Components V2 payload
 */
export async function renderTicketSettingsDashboard({
  guild,
  activeTab = 'general',
  note = null
}) {
  const [settings, categories, blacklist] = await Promise.all([
    getTicketSettings(guild.id),
    getTicketCategories(guild.id),
    getTicketBlacklist(guild.id)
  ]);

  const container = new ContainerBuilder();

  // 1. Header Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎫 Ticket System Settings — ${format.escapeMarkdown(guild.name)}\n` +
      `Configure automated support workflows, departments, access control, and logging below.`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  if (note) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`💡 *${format.escapeMarkdown(note)}*`)
    );
    container.addSeparatorComponents(new SeparatorBuilder());
  }

  // 2. Navigation Dropdown
  const tabSelect = new StringSelectMenuBuilder()
    .setCustomId('tkt:cfg:tab_sel')
    .setPlaceholder('Select a settings category...')
    .addOptions(
      SETTINGS_TABS.map(t => 
        new StringSelectMenuOptionBuilder()
          .setLabel(t.label)
          .setDescription(t.desc)
          .setValue(t.id)
          .setEmoji(t.emoji)
          .setDefault(t.id === activeTab)
      )
    );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(tabSelect));
  container.addSeparatorComponents(new SeparatorBuilder());

  // 3. Tab Body
  if (activeTab === 'general') {
    const isEnabled = settings.enabled;
    const type = settings.ticket_type || 'channel';
    const maxOpen = settings.max_open_per_user || 3;
    const cd = settings.cooldown_seconds || 30;
    const formatStr = settings.name_format || 'ticket-{number}';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ⚙️ General Configuration\n` +
        `• **System Status:** ${isEnabled ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n` +
        `• **Ticket Creation Type:** \`${type.toUpperCase()}\` (Private Channels vs Threads)\n` +
        `• **Name Template:** \`${formatStr}\` (Supports \`{number}\`, \`{username}\`)\n` +
        `• **Max Open Tickets (Global):** \`${maxOpen}\` tickets per user\n` +
        `• **Ticket Cooldown:** \`${cd}s\` between new tickets`
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:toggle_enabled')
        .setLabel(isEnabled ? 'Disable System' : 'Enable System')
        .setEmoji(isEnabled ? '🔴' : '🟢')
        .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('tkt:cfg:edit_limits')
        .setLabel('Edit Limits & Cooldown')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tkt:cfg:edit_name_format')
        .setLabel('Name Format')
        .setEmoji('🏷️')
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(row);

  } else if (activeTab === 'staff') {
    const supportRoles = settings.support_role_ids || [];
    const adminRoles = settings.admin_role_ids || [];

    const supportText = supportRoles.length > 0 ? supportRoles.map(r => `<@&${r}>`).join(', ') : '*None (Only Guild Admins)*';
    const adminText = adminRoles.length > 0 ? adminRoles.map(r => `<@&${r}>`).join(', ') : '*None (Only Guild Admins)*';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 👥 Support & Admin Staff Roles\n` +
        `Designated roles can claim, view, and manage tickets without requiring server administrator privileges.\n\n` +
        `• **Support Roles:** ${supportText}\n` +
        `• **Admin Roles:** ${adminText}`
      )
    );

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('tkt:cfg:support_roles_sel')
      .setPlaceholder('Set Support Roles...')
      .setMinValues(0)
      .setMaxValues(5);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));

  } else if (activeTab === 'channels') {
    const logChan = settings.log_channel_id ? `<#${settings.log_channel_id}>` : '*None*';
    const trnChan = settings.transcript_channel_id ? `<#${settings.transcript_channel_id}>` : '*None*';
    const catChan = settings.channel_category_id ? `<#${settings.channel_category_id}>` : '*None*';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 📢 Channels, Logs & Transcripts\n` +
        `• **Audit Log Channel:** ${logChan}\n` +
        `• **Transcript Channel:** ${trnChan}\n` +
        `• **Default Category Channel:** ${catChan}`
      )
    );

    const logSelect = new ChannelSelectMenuBuilder()
      .setCustomId('tkt:cfg:log_chan_sel')
      .setPlaceholder('Select Ticket Log Channel...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const trnSelect = new ChannelSelectMenuBuilder()
      .setCustomId('tkt:cfg:trn_chan_sel')
      .setPlaceholder('Select Transcript Log Channel...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(logSelect));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(trnSelect));

  } else if (activeTab === 'categories') {
    const catList = categories.map((c, i) => 
      `• **${c.emoji || '🎫'} ${format.escapeMarkdown(c.name)}** — Max \`${c.max_open_per_user || 1}\` open · ${c.is_enabled !== false ? '🟢 Active' : '🔴 Disabled'}`
    ).join('\n') || '*No categories configured yet.*';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 📁 Ticket Categories (${categories.length})\n` +
        `${catList}\n\n` +
        `-# *Categories appear on public panels. Each can have its own roles, parent category, and modal questions.*`
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:add_cat_btn')
        .setLabel('Add Category')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Primary)
    );
    container.addActionRowComponents(row);

  } else if (activeTab === 'autoclose') {
    const autoHours = settings.autoclose_hours || 0;
    const warnHours = settings.autoclose_warning_hours || 0;
    const delSec = settings.autodelete_delay_seconds || 10;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ⏱️ Inactivity & Auto-Close\n` +
        `• **Auto-Close Timer:** ${autoHours > 0 ? `\`${autoHours} hours\`` : '🔴 **Disabled**'}\n` +
        `• **Inactivity Warning:** ${warnHours > 0 ? `\`${warnHours} hours before close\`` : '*No warning*'}\n` +
        `• **Channel Deletion Delay:** \`${delSec} seconds\` after closing`
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:toggle_autoclose')
        .setLabel(autoHours > 0 ? `Timer: ${autoHours}h` : 'Enable (24h)')
        .setEmoji('⏱️')
        .setStyle(autoHours > 0 ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tkt:cfg:edit_del_delay')
        .setLabel(`Delete Delay: ${delSec}s`)
        .setEmoji('⏳')
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(row);

  } else if (activeTab === 'ratings') {
    const isRating = settings.rating_enabled;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ⭐ Customer Ratings & Reviews\n` +
        `• **Rating Status:** ${isRating ? '🟢 **Active** (Sends 1-5 star DM prompt after close)' : '🔴 **Disabled**'}\n` +
        `• **Feedback Reviews:** Customers can leave optional text reviews that post to log channels.`
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:toggle_ratings')
        .setLabel(isRating ? 'Disable Ratings' : 'Enable Ratings')
        .setEmoji('⭐')
        .setStyle(isRating ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    container.addActionRowComponents(row);

  } else if (activeTab === 'messages') {
    const welcome = settings.welcome_message || 'Default welcome message';
    const close = settings.close_message || 'Default close message';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 💬 Message Templates\n` +
        `**Welcome Message:**\n> ${format.escapeMarkdown(welcome)}\n\n` +
        `**Close Message:**\n> ${format.escapeMarkdown(close)}\n\n` +
        `-# Supported placeholders: \`{user}\`, \`{number}\`, \`{category}\`, \`{staff}\`, \`{server}\``
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:edit_welcome_msg')
        .setLabel('Edit Welcome')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tkt:cfg:edit_close_msg')
        .setLabel('Edit Close')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(row);

  } else if (activeTab === 'blacklist') {
    const count = blacklist.length;
    const preview = blacklist.slice(0, 5).map(b => 
      `• ${b.target_type === 'user' ? '👤 User' : '🛡️ Role'} <@${b.target_type === 'role' ? '&' : ''}${b.target_id}> — *${format.escapeMarkdown(b.reason)}*`
    ).join('\n') || '*No users or roles currently blacklisted.*';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 🚫 Ticket Blacklist (${count})\n` +
        `${preview}\n\n` +
        `-# *Use \`/ticket blacklist add\` or \`/ticket blacklist remove\` to manage exclusions.*`
      )
    );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:add_bl_btn')
        .setLabel('Add to Blacklist')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Danger)
    );
    container.addActionRowComponents(row);
  }

  // Row 4: Close / Finish
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('tkt:cfg:close_dashboard')
        .setLabel('Close Dashboard')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

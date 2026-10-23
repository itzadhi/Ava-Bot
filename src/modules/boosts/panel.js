import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';

/**
 * Builds the interactive Boost Tracker and Auto-Role configuration panel
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildBoostPanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isTracking = guildSettings.boost_tracking_enabled !== false;
  const isAutoRole = guildSettings.boost_auto_role_enabled !== false;
  const roleId = guildSettings.boost_role_id;
  const channelId = guildSettings.boost_channel_id;
  const customMessage = guildSettings.boost_message || 'Thank you for boosting the server!';

  const totalBoosts = guild?.premiumSubscriptionCount || 0;
  const tier = guild?.premiumTier || 0;
  const tierNames = ['Level 0', 'Level 1', 'Level 2', 'Level 3'];
  const currentTier = tierNames[tier] || `Level ${tier}`;

  const roleDisplay = roleId ? `<@&${roleId}>` : '`None (Not configured)`';
  const chanDisplay = channelId ? `<#${channelId}>` : '`None (System channel default)`';

  // Professional typography: # Heading, ### Subheadings, - Bullets, **Bold** formatting
  const content =
    `# 🚀 Boost Tracker & Auto-Role Panel\n` +
    `Automate booster role rewards and celebrate new server boosts with Components V2 cards.\n\n` +
    `### Current Server Status\n` +
    `- **Boost Level:** **${currentTier}**\n` +
    `- **Total Boosts:** **${totalBoosts}** active boost(s)\n` +
    `- **Boost Tracking:** ${isTracking ? '🟢 **Enabled**' : '🔴 **Disabled**'}\n\n` +
    `### Booster Perks & Automation\n` +
    `- **Booster Perk Role:** ${roleDisplay}\n` +
    `- **Auto-Assign Role:** ${isAutoRole ? '🟢 **Active** (Assigns on boost, removes on expire)' : '⚪ **Disabled**'}\n` +
    `- **Announcement Channel:** ${chanDisplay}\n` +
    `- **Custom Message:** *"${customMessage}"*\n\n` +
    `*Select a perk role and announcement channel below to configure automatic rewards.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Role Select Menu for Booster Perk Role
  const row1 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:bst:role_sel:0')
      .setPlaceholder('Select Role to Auto-Assign to Boosters...')
  );

  // Row 2: Channel Select Menu for Boost Announcement Channel
  const row2 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('fb:bst:chan_sel:0')
      .setPlaceholder('Select Boost Celebration Channel...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  // Row 3: Action & Setting Toggles
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:bst:toggle_track:0')
      .setLabel(isTracking ? 'Disable Tracking' : 'Enable Tracking')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:bst:toggle_role:0')
      .setLabel(isAutoRole ? 'Auto-Role: ON' : 'Auto-Role: OFF')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:bst:edit_msg:0')
      .setLabel('Edit Message')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 4: Utility & Testing
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:bst:test:0')
      .setLabel('Test Celebration Card')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:bst:clear_role:0')
      .setLabel('Clear Booster Role')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:bst:refresh:0')
      .setLabel('Refresh Panel')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1, row2, row3, row4);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds the modal for editing the custom boost announcement message
 * @param {string} currentMessage
 * @returns {ModalBuilder}
 */
export function buildBoostMessageModal(currentMessage = '') {
  const modal = new ModalBuilder()
    .setCustomId('fb:bst:msg_submit:0')
    .setTitle('Custom Boost Message');

  const msgInput = new TextInputBuilder()
    .setCustomId('boost_text')
    .setLabel('Celebration Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Thank you for boosting and supporting our server!')
    .setValue(currentMessage || 'Thank you for boosting the server!')
    .setRequired(true)
    .setMaxLength(500);

  modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
  return modal;
}

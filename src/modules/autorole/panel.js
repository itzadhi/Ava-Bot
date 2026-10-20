import {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  MessageFlags
} from 'discord.js';

/**
 * Builds the interactive Auto-Role configuration panel using Discord Components V2
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAutoRolePanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isEnabled = guildSettings.autorole_enabled !== false;
  const memRoleId = guildSettings.autorole_member_role_id;
  const botRoleId = guildSettings.autorole_bot_role_id;

  const memRoleDisplay = memRoleId ? `<@&${memRoleId}>` : '`None (Not configured)`';
  const botRoleDisplay = botRoleId ? `<@&${botRoleId}>` : '`None (Not configured)`';

  // Professional typography: # Heading, ### Subheadings, - Bullets, **Bold** formatting
  const content =
    `# 👤 Auto-Role Interactive Manager\n` +
    `Seamlessly onboard new arrivals by automatically granting roles the instant they join.\n\n` +
    `### Current Configuration\n` +
    `- **System State:** ${isEnabled ? '🟢 **Active**' : '🔴 **Disabled**'}\n` +
    `- **Human Member Role:** ${memRoleDisplay}\n` +
    `- **Bot Integration Role:** ${botRoleDisplay}\n\n` +
    `*Select roles below to set automatic assignment for members and invited bots.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Role Selector for Human Members
  const row1 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:ar:mem_sel:0')
      .setPlaceholder('Select Role for New Human Members...')
  );

  // Row 2: Role Selector for Invited Bots
  const row2 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:ar:bot_sel:0')
      .setPlaceholder('Select Role for Invited Bots...')
  );

  // Row 3: Toggles and Controls
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:ar:toggle:0')
      .setLabel(isEnabled ? 'Disable Auto-Role' : 'Enable Auto-Role')
      .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('fb:ar:clear_mem:0')
      .setLabel('Clear Member Role')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:ar:clear_bot:0')
      .setLabel('Clear Bot Role')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:ar:refresh:0')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1, row2, row3);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

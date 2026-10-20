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
 * Builds the interactive Sticky Roles configuration panel using Discord Components V2
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildStickyRolesPanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isEnabled = guildSettings.sticky_roles_enabled !== false;
  const allRolesMode = guildSettings.sticky_all_roles !== false;
  const designatedRoleIds = Array.isArray(guildSettings.sticky_role_ids) ? guildSettings.sticky_role_ids : [];

  let rolesDisplay = '`All Member Roles (Default)`';
  if (!allRolesMode) {
    rolesDisplay = designatedRoleIds.length > 0
      ? designatedRoleIds.map(id => `<@&${id}>`).join(', ')
      : '`None (No specific roles designated)`';
  }

  // Professional typography: # Heading, ### Subheadings, - Bullets, **Bold** formatting
  const content =
    `# 🔒 Sticky Roles Interactive Manager\n` +
    `Ensure punishment roles (such as Muted) or membership roles persist even if a user leaves and rejoins.\n\n` +
    `### Configuration Status\n` +
    `- **System State:** ${isEnabled ? '🟢 **Active**' : '🔴 **Disabled**'}\n` +
    `- **Retention Scope:** **${allRolesMode ? 'All Member Roles' : 'Designated Roles Whitelist'}**\n` +
    `- **Active Sticky Roles:** ${rolesDisplay}\n\n` +
    `*Select specific roles below to restrict sticky persistence to designated roles only.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Role Selector for Specific Sticky Roles
  const row1 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:sr:role_sel:0')
      .setPlaceholder('Select Role(s) to designate as Sticky...')
      .setMinValues(0)
      .setMaxValues(10)
  );

  // Row 2: Toggles and Controls
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:sr:toggle:0')
      .setLabel(isEnabled ? 'Disable Sticky Roles' : 'Enable Sticky Roles')
      .setStyle(isEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('fb:sr:mode:0')
      .setLabel(allRolesMode ? 'Mode: All Roles' : 'Mode: Whitelist Only')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('fb:sr:clear:0')
      .setLabel('Clear Whitelist')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:sr:refresh:0')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1, row2);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

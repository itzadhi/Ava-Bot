import {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  MessageFlags
} from 'discord.js';
import { greyButton } from '../../utils/ui/greyButton.js';

/**
 * Builds the interactive Auto-Role configuration panel using Discord Components V2
 * Strictly uses grey buttons (ButtonStyle.Secondary). Supports multiple member roles.
 *
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAutoRolePanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isEnabled = guildSettings.autorole_enabled !== false;

  // Resolve multiple member roles with backward-compatible fallback
  let memRoleIds = [];
  if (Array.isArray(guildSettings.autorole_member_role_ids) && guildSettings.autorole_member_role_ids.length > 0) {
    memRoleIds = guildSettings.autorole_member_role_ids;
  } else if (guildSettings.autorole_member_role_id) {
    memRoleIds = [guildSettings.autorole_member_role_id];
  }

  const botRoleId = guildSettings.autorole_bot_role_id;

  const memRoleDisplay = memRoleIds.length > 0
    ? memRoleIds.map(id => `<@&${id}>`).join(' ')
    : '`None (Not configured)`';

  const botRoleDisplay = botRoleId
    ? `<@&${botRoleId}>`
    : '`None (Not configured)`';

  const content =
    `# 👤 Auto-Role Interactive Manager\n` +
    `Seamlessly onboard new arrivals by automatically granting roles the instant they join.\n\n` +
    `### Current Configuration\n` +
    `- **System State:** ${isEnabled ? 'Active' : 'Disabled'}\n` +
    `- **Human Member Roles (${memRoleIds.length}):** ${memRoleDisplay}\n` +
    `- **Bot Integration Role:** ${botRoleDisplay}\n\n` +
    `*Select roles below to add to automatic assignment. Selections merge automatically.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Role Selector for Human Members (Multi-select)
  const row1 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:ar:mem_sel:0')
      .setPlaceholder('Add Role(s) for New Human Members...')
      .setMinValues(1)
      .setMaxValues(Math.min(25, guild?.roles?.cache?.size || 25))
  );

  container.addActionRowComponents(row1);

  // Row 2: Remove single member role dropdown (if multiple exist)
  if (memRoleIds.length > 0) {
    const removeOptions = memRoleIds.slice(0, 25).map(id => {
      const r = guild?.roles?.cache?.get(id);
      return {
        label: (r?.name || `Role ${id}`).slice(0, 100),
        value: id,
        description: `Remove @${r?.name || id}`.slice(0, 100),
        emoji: '🗑️'
      };
    });

    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId('fb:ar:mem_rem:0')
      .setPlaceholder('Remove a human member role...')
      .addOptions(removeOptions);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(removeMenu));
  }

  // Row 3: Role Selector for Invited Bots
  const rowBot = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:ar:bot_sel:0')
      .setPlaceholder('Select Role for Invited Bots...')
  );
  container.addActionRowComponents(rowBot);

  // Row 4: Toggles and Controls (100% Grey Buttons)
  const toggleBtn = greyButton({
    id: 'fb:ar:toggle:0',
    label: isEnabled ? 'Disable Auto-Role' : 'Enable Auto-Role',
    emoji: isEnabled ? '⏸️' : '▶️'
  });

  const clearMemBtn = greyButton({
    id: 'fb:ar:clear_mem:0',
    label: 'Clear Member Roles',
    emoji: '🗑️',
    disabled: memRoleIds.length === 0
  });

  const clearBotBtn = greyButton({
    id: 'fb:ar:clear_bot:0',
    label: 'Clear Bot Role',
    emoji: '🗑️',
    disabled: !botRoleId
  });

  const refreshBtn = greyButton({
    id: 'fb:ar:refresh:0',
    label: 'Refresh',
    emoji: '🔄'
  });

  const rowControls = new ActionRowBuilder().addComponents(
    toggleBtn,
    clearMemBtn,
    clearBotBtn,
    refreshBtn
  );
  container.addActionRowComponents(rowControls);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

export default {
  buildAutoRolePanel
};

import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { buildAutoRolePanel } from '../../modules/autorole/panel.js';
import { checkStaffPermission } from '../../modules/suggestions/index.js';
import { errorCard } from '../../ui/cards.js';

export default {
  name: 'autorole',
  aliases: ['autoroles', 'joinrole', 'welcome'],
  description: 'Interactive control panel for automatic member and bot role assignment',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageGuild],
  args: [],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be run inside a Discord server.',
        ephemeral: true
      }));
    }

    const isStaff = await checkStaffPermission(ctx).catch(() => false);
    const hasAdmin = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
                     ctx.member?.permissions?.has(PermissionFlagsBits.ManageRoles);

    if (!isStaff && !hasAdmin) {
      return ctx.reply(errorCard({
        title: 'Permission Denied',
        reason: 'You need Manage Roles or Manage Server permission to configure Auto-Roles.',
        ephemeral: true
      }));
    }

    const settings = await getGuildSettings(ctx.guild.id);
    const panelPayload = buildAutoRolePanel(settings, ctx.guild);

    return ctx.reply(panelPayload);
  }
};

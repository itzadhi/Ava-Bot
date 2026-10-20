import { PermissionFlagsBits } from 'discord.js';
import { getAllStickyNotes } from '../../db/sticky.js';
import { buildStickyPanel } from '../../modules/sticky/panel.js';
import { checkStaffPermission } from '../../modules/suggestions/index.js';
import { errorCard } from '../../ui/cards.js';

export default {
  name: 'stickynote',
  aliases: ['sticky', 'stickynotes'],
  description: 'Interactive control panel for channel sticky notes',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild],
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
                     ctx.member?.permissions?.has(PermissionFlagsBits.ManageMessages);

    if (!isStaff && !hasAdmin) {
      return ctx.reply(errorCard({
        title: 'Permission Denied',
        reason: 'You need Manage Messages or Manage Server permission to configure Sticky Notes.',
        ephemeral: true
      }));
    }

    const activeNotes = await getAllStickyNotes(ctx.guild.id);
    const panelPayload = buildStickyPanel(ctx.guild, activeNotes, ctx.channel?.id || null);

    return ctx.reply(panelPayload);
  }
};

import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { buildBoostPanel } from '../../modules/boosts/panel.js';
import { checkStaffPermission } from '../../modules/suggestions/index.js';
import { errorCard } from '../../ui/cards.js';

export default {
  name: 'boosts',
  aliases: ['boosttrack', 'boostrole', 'booster'],
  description: 'Server boost tracking, auto-role assignment, and celebration settings',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  args: [
    {
      name: 'action',
      description: 'Action or setting (e.g. panel, enable, disable)',
      type: 'string',
      required: false,
      choices: [
        { name: 'panel', value: 'panel' },
        { name: 'enable', value: 'enable' },
        { name: 'disable', value: 'disable' }
      ]
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be run inside a Discord server.',
        ephemeral: true
      }));
    }

    // Check staff permissions
    const isStaff = await checkStaffPermission(ctx).catch(() => false);
    const hasAdmin = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
                     ctx.member?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!isStaff && !hasAdmin) {
      return ctx.reply(errorCard({
        title: 'Permission Denied',
        reason: 'You need the Manage Server permission or configured Staff role to access Boost settings.',
        ephemeral: true
      }));
    }

    const action = (ctx.args.action || 'panel').toLowerCase();

    if (action === 'enable') {
      await updateGuildSettings(ctx.guild.id, { boost_tracking_enabled: true });
    } else if (action === 'disable') {
      await updateGuildSettings(ctx.guild.id, { boost_tracking_enabled: false });
    }

    const settings = await getGuildSettings(ctx.guild.id);
    const panelPayload = buildBoostPanel(settings, ctx.guild);

    return ctx.reply(panelPayload);
  }
};

import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { buildAutoModPanel } from '../../modules/automod/panel.js';
import { checkStaffPermission } from '../../modules/suggestions/index.js';
import { errorCard, successCard } from '../../ui/cards.js';

export default {
  name: 'automod',
  aliases: ['am', 'automoderation'],
  description: 'Interactive AutoMod control panel and protection settings',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  args: [
    {
      name: 'action',
      description: 'Action or setting (e.g. panel, enable, disable, action, log)',
      type: 'string',
      required: false,
      choices: [
        { name: 'panel', value: 'panel' },
        { name: 'enable', value: 'enable' },
        { name: 'disable', value: 'disable' },
        { name: 'status', value: 'status' }
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
        reason: 'You need the Manage Server permission or configured Staff role to access AutoMod settings.',
        ephemeral: true
      }));
    }

    const subAction = (ctx.args.action || 'panel').toLowerCase();

    if (subAction === 'enable') {
      await updateGuildSettings(ctx.guild.id, { automod_enabled: true });
      const settings = await getGuildSettings(ctx.guild.id);
      const panel = buildAutoModPanel(settings, ctx.guild);
      return ctx.reply(panel);
    }

    if (subAction === 'disable') {
      await updateGuildSettings(ctx.guild.id, { automod_enabled: false });
      const settings = await getGuildSettings(ctx.guild.id);
      const panel = buildAutoModPanel(settings, ctx.guild);
      return ctx.reply(panel);
    }

    // Default: render full interactive control panel
    const settings = await getGuildSettings(ctx.guild.id);
    const panelPayload = buildAutoModPanel(settings, ctx.guild);

    return ctx.reply(panelPayload);
  }
};

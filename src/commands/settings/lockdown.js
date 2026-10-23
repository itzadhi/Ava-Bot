import { PermissionFlagsBits } from 'discord.js';
import { getLockdownState } from '../../db/antinuke.js';
import { initiateLockdown, terminateLockdown } from '../../modules/antinuke/lockdown.js';
import { getGuildRoles } from '../../db/permify.js';
import { errorCard, infoCard, successCard, permissionCard } from '../../utils/ui/components.js';

export default {
  name: 'lockdown',
  aliases: ['lock', 'unlock', 'raidlock'],
  description: 'Manage server lockdown defense during raids or emergency incidents',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  args: [
    {
      name: 'action',
      description: 'Lockdown action (on, off, status)',
      type: 'string',
      required: false,
      choices: [
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
        { name: 'status', value: 'status' }
      ]
    },
    {
      name: 'reason',
      description: 'Reason for manual lockdown',
      type: 'string',
      required: false
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

    const member = ctx.member;
    const isOwner = ctx.guild.ownerId === member.id;
    const hasAdmin = member?.permissions?.has(PermissionFlagsBits.Administrator) ||
                     member?.permissions?.has(PermissionFlagsBits.ManageGuild);

    const roles = await getGuildRoles(ctx.guild.id).catch(() => ({ staff: [], owner: [] }));
    const authorizedRoles = new Set([...(roles.staff || []), ...(roles.owner || [])]);
    const isStaff = member?.roles?.cache?.some(r => authorizedRoles.has(r.id));

    if (!isOwner && !hasAdmin && !isStaff) {
      return ctx.reply(permissionCard({
        missing: ['Manage Server or Staff Role'],
        isBot: false,
        ephemeral: true
      }));
    }

    const action = (ctx.args.action || 'status').toLowerCase();
    const reason = ctx.args.reason || `Manual command triggered by ${ctx.user.tag}`;

    // 1. Lockdown ON
    if (action === 'on' || action === 'lock') {
      const activeState = await getLockdownState(ctx.guild.id);
      if (activeState?.active) {
        return ctx.reply(infoCard({
          title: 'Lockdown Already Active',
          body: 'The server is already under lockdown protection.'
        }));
      }

      await initiateLockdown(ctx.guild, reason, [], ctx.channel.id);

      return ctx.reply(successCard({
        title: 'Lockdown Activated',
        body: `Emergency server lockdown initiated. Public channel overwrites have been restricted.\n> **Reason:** ${reason}`,
        tip: 'Run `/lockdown off` or use the alert card buttons to lift the lockdown.'
      }));
    }

    // 2. Lockdown OFF
    if (action === 'off' || action === 'unlock') {
      const activeState = await getLockdownState(ctx.guild.id);
      if (!activeState?.active) {
        return ctx.reply(infoCard({
          title: 'Server Not Locked',
          body: 'There is currently no active lockdown in this server.'
        }));
      }

      await terminateLockdown(ctx.guild, reason, true);

      return ctx.reply(successCard({
        title: 'Lockdown Terminated',
        body: 'Server lockdown lifted. Original channel permissions have been restored.'
      }));
    }

    // 3. Status
    const state = await getLockdownState(ctx.guild.id);
    if (!state || !state.active) {
      return ctx.reply(infoCard({
        title: 'Lockdown Status: Normal',
        body: '🟢 **All channels are operational.** No active lockdown or raid mitigation in progress.'
      }));
    }

    const startedMs = state.started_at ? new Date(state.started_at).getTime() : Date.now();
    const durationMins = Math.round((Date.now() - startedMs) / 60000);

    return ctx.reply(infoCard({
      title: 'Lockdown Status: ACTIVE',
      body: [
        `🚨 **Server is currently LOCKED DOWN.**`,
        ``,
        `- **Reason:** ${state.reason || 'Coordinated raid flood'}`,
        `- **Active For:** \`${durationMins} minutes\``,
        `- **Channels Locked:** \`${Object.keys(state.saved_overwrites || {}).length}\``,
        `- **Offenders Tracked:** \`${(state.offenders || []).length}\``,
        `- **Auto-Calm Expiry:** ${state.calm_until ? `<t:${Math.floor(new Date(state.calm_until).getTime() / 1000)}:R>` : 'Active'}`,
        `- **Max Duration Cap:** ${state.max_until ? `<t:${Math.floor(new Date(state.max_until).getTime() / 1000)}:R>` : '15m'}`
      ].join('\n')
    }));
  }
};

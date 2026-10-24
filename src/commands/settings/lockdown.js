import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import {
  getLockdownState,
  initiateLockdown,
  terminateLockdown,
  repairCorruptedLockdown
} from '../../modules/antinuke/lockdown.js';
import { getGuildRoles } from '../../db/permify.js';
import { errorCard, infoCard, successCard, permissionCard } from '../../utils/ui/components.js';
import { buildProgressCard } from '../../core/jobs/jobManager.js';
import { greyButton } from '../../utils/ui/greyButton.js';

export default {
  name: 'lockdown',
  aliases: ['lock', 'unlock', 'raidlock'],
  description: 'Manage server lockdown defense during raids or emergency incidents',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  args: [
    {
      name: 'action',
      description: 'Lockdown action (on, off, status, repair)',
      type: 'string',
      required: false,
      choices: [
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
        { name: 'status', value: 'status' },
        { name: 'repair', value: 'repair' }
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

    // 1. Lockdown ON (Immediate Fast-Path & Progress Card < 500ms)
    if (action === 'on' || action === 'lock') {
      const activeState = await getLockdownState(ctx.guild.id);
      if (activeState && (activeState.state === 'locking' || activeState.state === 'locked')) {
        return ctx.reply(infoCard({
          title: 'Lockdown Already Active',
          body: `The server is already in **${activeState.state.toUpperCase()}** state.\nRun \`/lockdown off\` to restore channels.`
        }));
      }

      const result = await initiateLockdown(ctx.guild, reason, [], ctx.channel.id, ctx.user.id);

      const progressCard = buildProgressCard({
        title: 'EMERGENCY SERVER LOCKDOWN',
        progress: { total: result.channelCount, done: 0, failed: 0, percentage: 5 },
        elapsedSeconds: 0,
        statusText: '⚡ Fast-path role lock active. Securing channel overwrites in background...',
        buttons: [
          greyButton({
            id: `antinuke:unlock_now:${ctx.guild.id}:${ctx.user.id}:0`,
            label: 'Unlock Now',
            emoji: '🔓'
          })
        ]
      });

      return ctx.reply(progressCard);
    }

    // 2. Lockdown OFF (Immediate Progress Card & Concurrent Restore)
    if (action === 'off' || action === 'unlock') {
      const activeState = await getLockdownState(ctx.guild.id);
      if (!activeState || activeState.state === 'idle') {
        return ctx.reply(infoCard({
          title: 'Server Not Locked',
          body: 'There is currently no active lockdown in this server.'
        }));
      }

      const result = await terminateLockdown(ctx.guild, reason, true);

      const progressCard = buildProgressCard({
        title: 'RESTORING SERVER PERMISSIONS',
        progress: { total: activeState.counters?.total || 1, done: 0, failed: 0, percentage: 10 },
        elapsedSeconds: 0,
        statusText: 'Reverting lockdown overwrites and restoring original permissions...',
        buttons: []
      });

      return ctx.reply(progressCard);
    }

    // 3. Repair (Corrupted Lockdown State Recovery)
    if (action === 'repair') {
      if (!isOwner && !hasAdmin) {
        return ctx.reply(permissionCard({
          missing: ['Server Owner Only (Lockdown repair is strictly restricted)'],
          isBot: false,
          ephemeral: true
        }));
      }

      const repairResult = await repairCorruptedLockdown(ctx.guild);

      return ctx.reply(infoCard({
        title: 'Lockdown Integrity Repair',
        body: [
          `**Scanned Channels:** \`${repairResult.scanned}\``,
          `**Repaired Overwrites:** \`${repairResult.fixed}\``,
          ``,
          '### Diagnostic Details',
          ...(repairResult.details.length > 0 ? repairResult.details.map(d => `- ${d}`) : ['- No stuck lockdown overwrites detected.'])
        ].join('\n'),
        ephemeral: true
      }));
    }

    // 4. Status
    const state = await getLockdownState(ctx.guild.id);
    if (!state || state.state === 'idle') {
      return ctx.reply(infoCard({
        title: 'Lockdown Status: Normal',
        body: '🟢 **All channels are operational.** No active lockdown or raid mitigation in progress.'
      }));
    }

    const counters = state.counters || {};
    const unlockTime = state.unlock_at ? new Date(state.unlock_at).getTime() : 0;
    const unlockDisplay = unlockTime > 0 ? `<t:${Math.floor(unlockTime / 1000)}:R>` : '`None`';

    return ctx.reply(infoCard({
      title: `Lockdown Status: ${state.state.toUpperCase()}`,
      body: [
        `🚨 **Server protection state is ${state.state.toUpperCase()}.**`,
        ``,
        `- **State:** \`${state.state}\``,
        `- **Initiated By:** \`${state.started_by || 'Unknown'}\``,
        `- **Reason:** > ${state.reason || 'None provided'}`,
        `- **Total Channels Tracked:** \`${counters.total || 0}\``,
        `- **Locked Channels:** \`${counters.locked || 0}\``,
        `- **Failed Overwrites:** \`${counters.failed || 0}\``,
        `- **Scheduled Auto-Unlock:** ${unlockDisplay}`
      ].join('\n')
    }));
  }
};

import { PermissionFlagsBits } from 'discord.js';
import {
  getAntiNukeSettings,
  updateAntiNukeSettings,
  getAntiNukeTrusted,
  getAntiNukeExempt,
  saveAllChannelSnapshots
} from '../../db/antinuke.js';
import { getTicketSettings } from '../../db/tickets.js';
import { buildAntiNukeWizard, checkBotPermissions } from '../../modules/antinuke/panel.js';
import { errorCard, infoCard, successCard, permissionCard } from '../../utils/ui/components.js';

export default {
  name: 'antinuke',
  aliases: ['an', 'serverprotection', 'defense'],
  description: 'Interactive Anti-Nuke control panel and server defense wizard',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.Administrator],
  args: [
    {
      name: 'action',
      description: 'Action to perform (panel, status, enable, disable, test)',
      type: 'string',
      required: false,
      choices: [
        { name: 'panel', value: 'panel' },
        { name: 'status', value: 'status' },
        { name: 'enable', value: 'enable' },
        { name: 'disable', value: 'disable' },
        { name: 'test', value: 'test' }
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

    const userId = ctx.user.id;
    const isOwner = ctx.guild.ownerId === userId;

    const trusted = await getAntiNukeTrusted(ctx.guild.id);
    const settings = await getAntiNukeSettings(ctx.guild.id);
    const isExtraOwner = (trusted.extraOwners || []).includes(userId) || (settings.extra_owners || []).includes(userId);

    // Strictly enforce Server Owner & Extra Owner access
    if (!isOwner && !isExtraOwner) {
      return ctx.reply(permissionCard({
        missing: ['Server Owner Only (Anti-Nuke settings are strictly restricted to the primary server owner)'],
        isBot: false,
        ephemeral: true
      }));
    }

    const action = (ctx.args.action || 'panel').toLowerCase();

    // 1. Simulation Test Command (/antinuke test)
    if (action === 'test') {
      const isSimEnabled = process.env.ENABLE_SIMULATION === 'true' || process.env.NODE_ENV === 'test';
      if (!isSimEnabled && !isOwner) {
        return ctx.reply(errorCard({
          title: 'Simulation Disabled',
          reason: 'Simulation testing is only permitted when ENABLE_SIMULATION=true is set in server environment.',
          ephemeral: true
        }));
      }

      const permCheck = checkBotPermissions(ctx.guild);
      const thresholds = settings.thresholds || {};

      const simLines = [
        `## 🧪 Anti-Nuke Protection Dry-Run Simulation`,
        `Analyzing what WOULD occur during a theoretical incident without applying punishments:`,
        ``,
        `### Pre-Flight Diagnostics`,
        `- **Bot Permissions:** ${permCheck.healthy ? '🟢 Pass (All capabilities verified)' : `⚠️ Missing: ${permCheck.missing.join(', ')}`}`,
        `- **Channel Snapshots:** Live in Supabase \`channel_snapshots\` table`,
        `- **Mode:** Simulation / Dry Run (0 members harmed)`,
        ``,
        `### Simulated Mass Channel Deletion`,
        `- **Trigger Threshold:** Deleting \`${thresholds.channel_delete_limit || 3}\` channels in \`${thresholds.channel_delete_window_seconds || 10}s\``,
        `- **Detection Result:** Audit log reader intercepts executor, checks immune whitelist.`,
        `- **Punishment Decision:** Would execute \`${settings.punishment?.toUpperCase() || 'BAN'}\` on executor.`,
        `- **Restoration Decision:** Would recreate categories sequentially, re-attach children, rebuild overwrites, and call \`remapChannelIds()\`.`,
        ``,
        `### Simulated Raid Lockdown`,
        `- **Trigger Threshold:** \`${thresholds.raid_distinct_users || 5}\` users sending \`${thresholds.raid_messages_per_user || 4}\` msgs in \`${thresholds.raid_window_seconds || 5}s\``,
        `- **Action Decision:** Overwrites for @everyone denied, spam purges in background, calm timer starts for \`${thresholds.lockdown_calm_seconds || 60}s\`.`,
        `- **Recovery Decision:** Restores exact saved overwrites upon calm timeout.`
      ];

      return ctx.reply(infoCard({
        title: 'Simulation Complete',
        body: simLines.join('\n'),
        ephemeral: true
      }));
    }

    // 2. Enable
    if (action === 'enable') {
      await updateAntiNukeSettings(ctx.guild.id, { enabled: true });
      await saveAllChannelSnapshots(ctx.guild);
      return ctx.reply(successCard({
        title: 'Anti-Nuke Armed',
        body: 'Server protection is now **Active**. Channel snapshots have been refreshed.',
        tip: 'Run `/antinuke panel` to review trusted roles and thresholds.'
      }));
    }

    // 3. Disable
    if (action === 'disable') {
      await updateAntiNukeSettings(ctx.guild.id, { enabled: false });
      return ctx.reply(infoCard({
        title: 'Anti-Nuke Disabled',
        body: 'Server protection has been **Deactivated**.'
      }));
    }

    // 4. Status
    if (action === 'status') {
      const permCheck = checkBotPermissions(ctx.guild);
      return ctx.reply(infoCard({
        title: 'Anti-Nuke Status',
        body: [
          `- **State:** ${settings.enabled ? '🟢 Active' : '⚪ Disabled'}`,
          `- **Mode:** ${settings.dry_run ? '🟡 Dry Run' : '⚡ Active Enforcement'}`,
          `- **Punishment:** \`${(settings.punishment || 'ban').toUpperCase()}\``,
          `- **Trusted Roles:** \`${trusted.roles.length}\``,
          `- **Trusted Users:** \`${trusted.users.length}\``,
          `- **Bot Permissions:** ${permCheck.healthy ? '🟢 Pass' : '⚠️ Missing Perms'}`
        ].join('\n')
      }));
    }

    // Default: Open the 7-page wizard
    const [exempt, ticketSettings] = await Promise.all([
      getAntiNukeExempt(ctx.guild.id),
      getTicketSettings(ctx.guild.id).catch(() => null)
    ]);

    const panelPayload = buildAntiNukeWizard({
      guild: ctx.guild,
      userId,
      page: 1,
      settings,
      trusted,
      exempt,
      ticketCategoryId: ticketSettings?.channel_category_id || null
    });

    return ctx.reply(panelPayload);
  }
};

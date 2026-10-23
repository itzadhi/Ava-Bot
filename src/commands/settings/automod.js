import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { getAutoModSettings, updateAutoModSettings, getAutoModWords, getAutoModRegexRules, getAutoModAllowlist, getAutoModExemptions } from '../../db/automod.js';
import { buildAutoModWizard } from '../../modules/automod/panel.js';
import { scanMessage } from '../../modules/automod/engine.js';
import { getGuildRoles } from '../../db/permify.js';
import { isTrusted } from '../../db/antinuke.js';
import { errorCard, infoCard, successCard, permissionCard } from '../../utils/ui/components.js';

export default {
  name: 'automod',
  aliases: ['am', 'automoderation'],
  description: 'Interactive AutoMod control panel, rules configuration, and live text testing',
  category: 'settings',
  userPermissions: [PermissionFlagsBits.ManageGuild],
  args: [
    {
      name: 'action',
      description: 'Action to perform (panel, test, enable, disable, status)',
      type: 'string',
      required: false,
      choices: [
        { name: 'panel', value: 'panel' },
        { name: 'test', value: 'test' },
        { name: 'enable', value: 'enable' },
        { name: 'disable', value: 'disable' },
        { name: 'status', value: 'status' }
      ]
    },
    {
      name: 'text',
      description: 'Sample text to test when using "test" action',
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
    const isImmune = await isTrusted(ctx.guild, member.id, member).catch(() => false);

    if (!isOwner && !hasAdmin && !isStaff && !isImmune) {
      return ctx.reply(permissionCard({
        missing: ['Manage Server or Staff Role'],
        isBot: false,
        ephemeral: true
      }));
    }

    const action = (ctx.args.action || 'panel').toLowerCase();

    // 1. Direct text testing (/automod test <text>)
    if (action === 'test') {
      const sample = ctx.args.text;
      if (!sample) {
        return ctx.reply(errorCard({
          title: 'Missing Parameter',
          reason: 'Please provide sample text to test: `/automod test <text>`',
          ephemeral: true
        }));
      }

      const mockMsg = {
        guild: ctx.guild,
        author: { id: ctx.user.id, bot: false },
        member: { id: ctx.user.id, roles: { cache: new Map() }, permissions: { has: () => false } },
        channel: ctx.channel,
        content: sample,
        mentions: { users: new Map(), roles: new Map() }
      };

      const result = await scanMessage(mockMsg);

      return ctx.reply(infoCard({
        title: 'AutoMod Live Evaluation Test',
        subtitle: result.violated ? '🛑 **VIOLATION DETECTED**' : '✅ **CLEAN MESSAGE**',
        body: result.violated
          ? `> 🛑 **Rule Hit:** \`${result.rule}\`\n> ⚠️ **Severity Tier:** **${result.severity || 'medium'}**\n> ⚙️ **Configured Action:** \`${result.action || 'delete'}\`\n> 📝 **Enforcement Reason:** ${result.reason}\n> 🔍 **Matched Segment:** \`${result.matchedText || 'N/A'}\`\n\n*Testing against live guild configuration in Supabase.*`
          : `> ✅ This sample text passed all active AutoMod filters, wordlists, and regex rules without triggering moderation.`,
        ephemeral: true
      }));
    }

    // 2. Direct enable
    if (action === 'enable') {
      await updateAutoModSettings(ctx.guild.id, { enabled: true });
      return ctx.reply(successCard({
        title: 'AutoMod Enabled',
        body: 'Automated moderation protection has been set to **Active**.',
        tip: 'Use `/automod panel` to adjust wordlists and regex filters.'
      }));
    }

    // 3. Direct disable
    if (action === 'disable') {
      await updateAutoModSettings(ctx.guild.id, { enabled: false });
      return ctx.reply(infoCard({
        title: 'AutoMod Disabled',
        body: 'Automated moderation protection has been **Disabled** for this server.'
      }));
    }

    // 4. Status overview
    if (action === 'status') {
      const settings = await getAutoModSettings(ctx.guild.id);
      const words = await getAutoModWords(ctx.guild.id);
      const regexRules = await getAutoModRegexRules(ctx.guild.id);
      return ctx.reply(infoCard({
        title: 'AutoMod Protection Status',
        body: [
          `- **State:** ${settings.enabled !== false ? '🟢 Active' : '⚪ Disabled'}`,
          `- **Enforcement:** \`${settings.action || 'delete'}\``,
          `- **Word Filter:** \`${words.length}\` custom phrase(s)`,
          `- **Custom Regex:** \`${regexRules.length}\` rule(s)`,
          `- **Anti-Invites:** ${settings.anti_invites ? '🟢 Enabled' : '⚪ Disabled'}`,
          `- **Anti-Links:** ${settings.anti_links ? '🟢 Enabled' : '⚪ Disabled'}`,
          `- **Anti-Spam:** ${settings.anti_spam ? '🟢 Enabled' : '⚪ Disabled'}`
        ].join('\n')
      }));
    }

    // Default: Render the full 8-page paginated wizard
    const [settings, words, allowlist, regexRules, exemptions] = await Promise.all([
      getAutoModSettings(ctx.guild.id),
      getAutoModWords(ctx.guild.id),
      getAutoModAllowlist(ctx.guild.id),
      getAutoModRegexRules(ctx.guild.id),
      getAutoModExemptions(ctx.guild.id)
    ]);

    const panelPayload = buildAutoModWizard({
      guildId: ctx.guild.id,
      userId: ctx.user.id,
      page: 1,
      settings,
      words,
      allowlist,
      regexRules,
      exemptions
    });

    return ctx.reply(panelPayload);
  }
};

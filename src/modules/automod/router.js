import {
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder
} from 'discord.js';
import {
  getAutoModSettings,
  updateAutoModSettings,
  getAutoModWords,
  addAutoModWord,
  removeAutoModWord,
  getAutoModAllowlist,
  addAutoModAllowlist,
  getAutoModRegexRules,
  saveAutoModRegexRule,
  deleteAutoModRegexRule,
  getAutoModExemptions,
  addAutoModExemption,
  removeAutoModExemption
} from '../../db/automod.js';
import {
  buildAutoModWizard,
  buildAddWordModal,
  buildRemoveWordModal,
  buildTestTextModal,
  buildAddRegexModal,
  buildTestRegexModal,
  buildStrikeThresholdsModal
} from './panel.js';
import { scanMessage } from './engine.js';
import { validateRegexPattern, safeRegexExec } from './normalizer.js';
import { getGuildRoles } from '../../db/permify.js';
import { isTrusted } from '../../db/antinuke.js';
import { errorCard, infoCard, successCard, permissionCard } from '../../utils/ui/components.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { logger } from '../../utils/logger.js';

/**
 * Checks if the interacting member is authorized to modify AutoMod configuration
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function isAuthorizedStaff(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  const member = interaction.member;

  // Real owner is always authorized
  if (interaction.guild.ownerId === member.id) return true;

  // Administrator / ManageGuild
  if (member.permissions?.has('Administrator') || member.permissions?.has('ManageGuild')) {
    return true;
  }

  // Permify Staff / Owner Roles
  const roles = await getGuildRoles(interaction.guild.id).catch(() => ({ staff: [], owner: [] }));
  const authorizedRoles = new Set([...(roles.staff || []), ...(roles.owner || [])]);
  if (member.roles?.cache?.some(r => authorizedRoles.has(r.id))) {
    return true;
  }

  // Anti-Nuke trusted
  const trusted = await isTrusted(interaction.guild, member.id, member).catch(() => false);
  return Boolean(trusted);
}

/**
 * Renders the wizard payload for a guild
 */
async function renderWizard(guildId, userId, page = 1) {
  const [settings, words, allowlist, regexRules, exemptions] = await Promise.all([
    getAutoModSettings(guildId),
    getAutoModWords(guildId),
    getAutoModAllowlist(guildId),
    getAutoModRegexRules(guildId),
    getAutoModExemptions(guildId)
  ]);

  return buildAutoModWizard({
    guildId,
    userId,
    page,
    settings,
    words,
    allowlist,
    regexRules,
    exemptions
  });
}

/**
 * Routes all automod:* interactions
 * Custom ID format: automod:<action>:<guildId>:<userId>:<page>
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAutoModInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('automod:')) return false;

  const parts = customId.split(':');
  const action = parts[1];
  const guildId = parts[2] || interaction.guildId;
  const targetUserId = parts[3] || interaction.user.id;
  const page = parseInt(parts[4] || '1', 10);

  // Authorization check
  const authorized = await isAuthorizedStaff(interaction);
  if (!authorized) {
    await interaction.reply({
      ...permissionCard({ missing: ['Manage Server or Staff Role'], isBot: false }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  // Verify opener check (if interaction user does not match opener and not guild owner)
  if (targetUserId && targetUserId !== interaction.user.id && interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      ...errorCard({
        title: 'Session Locked',
        reason: 'This AutoMod control panel was opened by another administrator.',
        fix: 'Run /automod to generate your own control panel session.'
      }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  try {
    // 1. Navigation
    if (action === 'nav') {
      const payload = await renderWizard(guildId, targetUserId, page);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 2. Close Panel
    if (action === 'close') {
      await interaction.message?.delete().catch(() => {});
      return true;
    }

    // 3. Refresh
    if (action === 'refresh') {
      const payload = await renderWizard(guildId, targetUserId, page);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 4. Toggle Master State
    if (action === 'toggle_master') {
      const current = await getAutoModSettings(guildId);
      const updated = await updateAutoModSettings(guildId, { enabled: current.enabled === false });
      if (updated.error) {
        await interaction.reply({ ...errorCard({ title: 'Database Error', reason: updated.error.message }), flags: MessageFlags.Ephemeral });
        return true;
      }
      const payload = await renderWizard(guildId, targetUserId, 1);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 5. Toggle DM Notices
    if (action === 'toggle_dm') {
      const current = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { dm_user_on_action: current.dm_user_on_action === false });
      const payload = await renderWizard(guildId, targetUserId, 1);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 6. Test Text Modal Open & Submit
    if (action === 'test_text_modal') {
      const modal = buildTestTextModal(guildId, targetUserId, page);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'test_text_submit') {
      const sample = interaction.fields.getTextInputValue('sample_text') || '';
      // Create a mock message to run through scanMessage
      const mockMsg = {
        guild: interaction.guild,
        author: { id: 'test_user', bot: false },
        member: { id: 'test_user', roles: { cache: new Map() }, permissions: { has: () => false } },
        channel: interaction.channel,
        content: sample,
        mentions: { users: new Map(), roles: new Map() }
      };

      const result = await scanMessage(mockMsg);
      const testCard = infoCard({
        title: 'AutoMod Scan Result',
        subtitle: `Sample text evaluation: ${result.violated ? '🛑 **VIOLATION DETECTED**' : '✅ **CLEAN**'}`,
        body: result.violated
          ? `> 🛑 **Rule Hit:** \`${result.rule}\`\n> ⚠️ **Severity:** **${result.severity || 'medium'}**\n> ⚙️ **Action:** \`${result.action || 'delete'}\`\n> 📝 **Reason:** ${result.reason}\n> 🔍 **Matched Text:** \`${result.matchedText || 'N/A'}\``
          : `> ✅ This message passed all active AutoMod filters, wordlists, and regex rules without triggering moderation.`,
        ephemeral: true
      });

      await interaction.reply(testCard).catch(() => {});
      return true;
    }

    // 7. Word Category Toggles
    if (action === 'toggle_slurs') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { slurs_category_enabled: s.slurs_category_enabled === false });
      const payload = await renderWizard(guildId, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_prof') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { profanity_category_enabled: s.profanity_category_enabled === false });
      const payload = await renderWizard(guildId, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_custom') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { custom_category_enabled: s.custom_category_enabled === false });
      const payload = await renderWizard(guildId, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 8. Add Words Modal & Submit
    if (action === 'word_add_modal') {
      const modal = buildAddWordModal(guildId, targetUserId);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'word_add_submit') {
      const input = interaction.fields.getTextInputValue('words_input') || '';
      const matchTypeRaw = (interaction.fields.getTextInputValue('match_type_input') || 'word').trim().toLowerCase();
      const matchType = ['word', 'substring', 'wildcard'].includes(matchTypeRaw) ? matchTypeRaw : 'word';

      const wordsList = input.split(/[,\n]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
      let added = 0;
      for (const w of wordsList) {
        const res = await addAutoModWord(guildId, { word: w, category: 'custom', severity: 'medium', match_type: matchType });
        if (!res.error) added++;
      }

      await interaction.reply({
        ...successCard({
          title: 'Words Added',
          body: `Added **${added}** prohibited phrase(s) with match type \`${matchType}\`.`
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 9. Remove Words Modal & Submit
    if (action === 'word_remove_modal') {
      const modal = buildRemoveWordModal(guildId, targetUserId);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'word_remove_submit') {
      const input = interaction.fields.getTextInputValue('words_to_remove') || '';
      const wordsList = input.split(/[,\n]+/).map(w => w.trim().toLowerCase()).filter(Boolean);
      let removed = 0;
      for (const w of wordsList) {
        const res = await removeAutoModWord(guildId, w);
        if (!res.error) removed++;
      }

      await interaction.reply({
        ...successCard({
          title: 'Words Removed',
          body: `Removed **${removed}** prohibited phrase(s).`
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 10. View Words (Paginated list)
    if (action === 'view_words') {
      const words = await getAutoModWords(guildId);
      const list = words.map(w => `• \`${w.word}\` (${w.category}, ${w.match_type})`).join('\n') || '*No custom words added yet.*';
      await interaction.reply({
        ...infoCard({
          title: `Registered Words (${words.length})`,
          body: list.slice(0, 3500)
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 11. Custom Regex Modal & Submit
    if (action === 'regex_add_modal') {
      const modal = buildAddRegexModal(guildId, targetUserId);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'regex_add_submit') {
      const name = interaction.fields.getTextInputValue('rule_name') || '';
      const pattern = interaction.fields.getTextInputValue('rule_pattern') || '';
      const flags = interaction.fields.getTextInputValue('rule_flags') || 'i';
      const ruleAction = interaction.fields.getTextInputValue('rule_action') || 'delete';

      const validation = validateRegexPattern(pattern, flags);
      if (!validation.valid) {
        await interaction.reply({
          ...errorCard({
            title: 'Invalid Regex Pattern',
            reason: validation.error,
            fix: 'Please simplify the regex and remove nested quantifiers to avoid catastrophic backtracking.'
          }),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return true;
      }

      const saveRes = await saveAutoModRegexRule(guildId, {
        name,
        pattern,
        flags,
        severity: 'medium',
        action: ruleAction,
        enabled: true
      });

      if (saveRes.error) {
        await interaction.reply({ ...errorCard({ title: 'Error Saving Rule', reason: saveRes.error.message }), flags: MessageFlags.Ephemeral });
        return true;
      }

      await interaction.reply({
        ...successCard({
          title: 'Regex Rule Created',
          body: `Rule **${name}** registered successfully: \`/${pattern}/${flags}\` [Action: \`${ruleAction}\`]`
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 12. Test Regex Pattern Modal & Submit
    if (action === 'regex_test_modal') {
      const modal = buildTestRegexModal(guildId, targetUserId);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'regex_test_submit') {
      const pattern = interaction.fields.getTextInputValue('test_pattern') || '';
      const sample = interaction.fields.getTextInputValue('test_sample') || '';

      const valid = validateRegexPattern(pattern, 'i');
      if (!valid.valid || !valid.regex) {
        await interaction.reply({
          ...errorCard({ title: 'Regex Validation Error', reason: valid.error }),
          flags: MessageFlags.Ephemeral
        }).catch(() => {});
        return true;
      }

      const match = safeRegexExec(valid.regex, sample);
      await interaction.reply({
        ...infoCard({
          title: 'Regex Pattern Test',
          subtitle: match.matched ? '🛑 **PATTERN MATCHED**' : '✅ **NO MATCH**',
          body: match.matched
            ? `> **Matched Snippet:** \`${match.matchText}\`\n> **Target Text:** "${sample}"`
            : `> The regex \`/${pattern}/i\` did not match the provided sample text.`
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 13. Regex Delete Menu
    if (action === 'regex_delete_menu') {
      const rules = await getAutoModRegexRules(guildId);
      if (rules.length === 0) {
        await interaction.reply({ ...infoCard({ title: 'No Rules', body: 'No regex rules exist to delete.' }), flags: MessageFlags.Ephemeral });
        return true;
      }

      const options = rules.slice(0, 25).map(r => ({
        label: r.name.slice(0, 100),
        value: r.id,
        description: `/${r.pattern}/`.slice(0, 100)
      }));

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`automod:regex_delete_action:${guildId}:${targetUserId}:3`)
          .setPlaceholder('Select regex rule to delete...')
          .addOptions(options)
      );

      await interaction.reply({
        components: [row],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    if (action === 'regex_delete_action') {
      const ruleId = interaction.values?.[0];
      if (ruleId) {
        await deleteAutoModRegexRule(guildId, ruleId);
      }
      await interaction.reply({
        ...successCard({ title: 'Rule Deleted', body: 'The selected regex rule was deleted.' }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 14. Toggles on Page 4 (Invites & Links)
    if (action === 'toggle_invites') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { anti_invites: !s.anti_invites });
      const payload = await renderWizard(guildId, targetUserId, 4);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_links') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { anti_links: !s.anti_links });
      const payload = await renderWizard(guildId, targetUserId, 4);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 15. Toggles on Page 5 (Spam, Caps, Mentions)
    if (action === 'toggle_spam') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { anti_spam: !s.anti_spam });
      const payload = await renderWizard(guildId, targetUserId, 5);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_caps') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { anti_caps: !s.anti_caps });
      const payload = await renderWizard(guildId, targetUserId, 5);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_mentions') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { anti_mentions: !s.anti_mentions });
      const payload = await renderWizard(guildId, targetUserId, 5);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 16. Exemptions (Page 6)
    if (action === 'exempt_roles') {
      const roleIds = interaction.values || [];
      const currentExempt = await getAutoModExemptions(guildId);
      for (const oldId of currentExempt.roles) {
        if (!roleIds.includes(oldId)) {
          await removeAutoModExemption(guildId, oldId, 'role');
        }
      }
      for (const newId of roleIds) {
        await addAutoModExemption(guildId, newId, 'role');
      }
      const payload = await renderWizard(guildId, targetUserId, 6);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_ticket_exempt') {
      const s = await getAutoModSettings(guildId);
      await updateAutoModSettings(guildId, { ticket_category_exempt: s.ticket_category_exempt === false });
      const payload = await renderWizard(guildId, targetUserId, 6);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'clear_exemptions') {
      const cur = await getAutoModExemptions(guildId);
      for (const r of cur.roles) await removeAutoModExemption(guildId, r, 'role');
      for (const c of cur.channels) await removeAutoModExemption(guildId, c, 'channel');
      for (const u of cur.users) await removeAutoModExemption(guildId, u, 'user');
      const payload = await renderWizard(guildId, targetUserId, 6);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 17. Action Select (Page 7)
    if (action === 'action_sel') {
      const chosen = interaction.values?.[0] || 'delete';
      await updateAutoModSettings(guildId, { action: chosen });
      const payload = await renderWizard(guildId, targetUserId, 7);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // 18. Strikes Modal & Submit (Page 7)
    if (action === 'strikes_modal') {
      const s = await getAutoModSettings(guildId);
      const modal = buildStrikeThresholdsModal(guildId, targetUserId, s);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'strikes_submit') {
      const timeoutVal = parseInt(interaction.fields.getTextInputValue('timeout_strikes') || '3', 10);
      const kickVal = parseInt(interaction.fields.getTextInputValue('kick_strikes') || '5', 10);
      const banVal = parseInt(interaction.fields.getTextInputValue('ban_strikes') || '7', 10);
      const expVal = parseInt(interaction.fields.getTextInputValue('expiry_hours') || '24', 10);

      await updateAutoModSettings(guildId, {
        strike_threshold_timeout: Math.max(1, timeoutVal),
        strike_threshold_kick: Math.max(2, kickVal),
        strike_threshold_ban: Math.max(3, banVal),
        strike_expiry_hours: Math.max(1, expVal)
      });

      await interaction.reply({
        ...successCard({
          title: 'Strike Escalation Saved',
          body: `Escalations configured: Timeout at **${timeoutVal}** • Kick at **${kickVal}** • Ban at **${banVal}** strikes (Expires in **${expVal}h**).`
        }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // 19. Log Channel Select (Page 8)
    if (action === 'log_chan_sel') {
      const chanId = interaction.values?.[0] || null;
      await updateAutoModSettings(guildId, { log_channel_id: chanId });
      const payload = await renderWizard(guildId, targetUserId, 8);
      await interaction.update(payload).catch(() => {});
      return true;
    }

  } catch (err) {
    logger.error({ err, customId }, 'Error handling automod interaction');
    await interaction.reply({
      ...errorCard({
        title: 'Action Error',
        reason: err.message || 'An unexpected error occurred during AutoMod interaction.'
      }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  return true;
}

export default {
  handleAutoModInteraction
};

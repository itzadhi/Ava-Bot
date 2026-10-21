import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} from 'discord.js';
import { getSession, endSession, updateSession } from './session.js';
import { renderWizardStep } from './wizard.js';
import { errorCard } from '../../ui/cards.js';
import { executePermifyApply, executePermifyUndo } from './engine.js';
import { logger } from '../../utils/logger.js';
import * as format from '../../utils/ui/format.js';
import { greyButton } from '../../utils/ui/greyButton.js';

/**
 * Validates role candidates against hierarchy, managed state, and group exclusivity
 *
 * @param {import('discord.js').Guild} guild
 * @param {string[]} roleIds
 * @param {object} context
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateRoleSelection(guild, roleIds, { currentGroup, staffRoleIds = [], memberRoleIds = [], ownerRoleIds = [] }) {
  const botMember = guild.members.me;
  const botHighest = botMember?.roles?.highest?.position ?? 0;
  const isBotAdmin = botMember?.permissions?.has(PermissionFlagsBits.Administrator);

  for (const roleId of roleIds) {
    if (roleId === guild.id) {
      return { valid: false, reason: 'The `@everyone` role cannot be assigned to role groups.' };
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return { valid: false, reason: `Role ID \`${roleId}\` does not exist on this server.` };
    }
    if (role.managed) {
      return { valid: false, reason: `Role **${role.name}** is managed by an integration/bot and cannot be assigned.` };
    }
    if (!isBotAdmin && role.position >= botHighest) {
      return { valid: false, reason: `Role **${role.name}** is higher than or equal to the bot's highest role (${botMember?.roles?.highest?.name}).` };
    }

    if (currentGroup !== 'staff' && staffRoleIds.includes(roleId)) {
      return { valid: false, reason: `Role **${role.name}** is already configured in the Staff group. A role cannot belong to multiple groups.` };
    }
    if (currentGroup !== 'member' && memberRoleIds.includes(roleId)) {
      return { valid: false, reason: `Role **${role.name}** is already configured in the Member group. A role cannot belong to multiple groups.` };
    }
    if (currentGroup !== 'owner' && ownerRoleIds.includes(roleId)) {
      return { valid: false, reason: `Role **${role.name}** is already configured in the Owner group. A role cannot belong to multiple groups.` };
    }
  }

  return { valid: true };
}

/**
 * Central router for all permify interactive events (buttons, menus, modals)
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} True if handled
 */
export async function handlePermifyInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('permify:')) return false;

  const parts = customId.split(':');
  const action = parts[1];
  const targetGuildId = parts[2];
  const targetUserId = parts[3];
  const currentStep = parseInt(parts[4], 10) || 1;

  // 1. Guild & Session Verification
  const guild = interaction.guild;
  if (!guild || guild.id !== targetGuildId) {
    await interaction.reply(errorCard({
      title: 'Context Mismatch',
      reason: 'This interaction belongs to a different server.',
      ephemeral: true
    }));
    return true;
  }

  // 2. Authorization check: Only session owner may interact
  if (interaction.user.id !== targetUserId) {
    await interaction.reply(errorCard({
      title: 'Wizard Active',
      reason: `Only <@${targetUserId}> can interact with this permission wizard.`,
      fix: 'Wait for this setup session to finish or open a new one once completed.',
      ephemeral: true
    }));
    return true;
  }

  const session = getSession(guild.id);

  // Allow close action even if session ended
  if (action === 'close') {
    if (session) endSession(guild.id);
    await interaction.message?.delete().catch(() => {});
    return true;
  }

  // Prompt for Undo confirmation modal
  if (action === 'open_undo') {
    const modal = new ModalBuilder()
      .setCustomId(`permify:undo_modal:${guild.id}:${interaction.user.id}`)
      .setTitle('Confirm Snapshot Restore');

    const input = new TextInputBuilder()
      .setCustomId('undo_confirm_input')
      .setLabel('Type UNDO to revert to the snapshot')
      .setPlaceholder('UNDO')
      .setStyle(TextInputStyle.Short)
      .setMinLength(4)
      .setMaxLength(4)
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  // Handle Undo Modal Submit
  if (action === 'undo_modal' && interaction.isModalSubmit()) {
    const text = interaction.fields.getTextInputValue('undo_confirm_input')?.trim();
    if (text !== 'UNDO') {
      await interaction.reply(errorCard({
        title: 'Undo Confirmation Failed',
        reason: 'You did not type UNDO.',
        fix: 'Click "Undo Last Run" again and type UNDO in all uppercase letters.',
        ephemeral: true
      }));
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    await executePermifyUndo(interaction, guild);
    return true;
  }

  if (!session) {
    await interaction.reply(errorCard({
      title: 'Session Expired',
      reason: 'This permission wizard session has expired due to 15 minutes of inactivity.',
      fix: 'Run /permify to start a fresh wizard.',
      ephemeral: true
    }));
    return true;
  }

  try {
    // 3. Dispatch specific actions
    switch (action) {
      // ─── NAVIGATION ────────────────────────────────────────────────────────
      case 'nav_next': {
        // Step Validation before advancing
        if (session.step === 4 && session.staffRoleIds.length === 0) {
          return interaction.reply(errorCard({
            title: 'Role Required',
            reason: 'You must configure at least one Staff role before proceeding.',
            fix: 'Pick one or more roles from the Staff Role Selector menu.',
            ephemeral: true
          }));
        }
        if (session.step === 5 && session.memberRoleIds.length === 0) {
          return interaction.reply(errorCard({
            title: 'Role Required',
            reason: 'You must configure at least one Member role before proceeding.',
            fix: 'Pick one or more roles from the Member Role Selector menu.',
            ephemeral: true
          }));
        }
        if (session.step === 6 && session.ownerRoleIds.length === 0) {
          return interaction.reply(errorCard({
            title: 'Role Required',
            reason: 'You must configure at least one Owner/Admin role before proceeding.',
            fix: 'Pick one or more roles from the Owner Role Selector menu.',
            ephemeral: true
          }));
        }

        session.step = Math.min(7, session.step + 1);
        updateSession(guild.id, { step: session.step });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'nav_prev': {
        session.step = Math.max(1, session.step - 1);
        updateSession(guild.id, { step: session.step });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'cancel': {
        endSession(guild.id);
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## 🛑 Permify Cancelled\n` +
            format.blockQuote('The server permission wizard was cancelled. No channel permissions were changed.') + '\n' +
            format.subtext(`Cancelled by <@${interaction.user.id}> at ${format.time(new Date(), 't')}`)
          )
        );
        await interaction.update({
          components: [container],
          flags: MessageFlags.IsComponentsV2
        });
        return true;
      }

      // ─── STEP 1 CONTROLS ──────────────────────────────────────────────────
      case 'toggle_custom': {
        session.includeCustomOverwrites = !session.includeCustomOverwrites;
        updateSession(guild.id, { includeCustomOverwrites: session.includeCustomOverwrites });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 2 CONTROLS (CATEGORIES) ──────────────────────────────────────
      case 'sel_cat': {
        // StringSelectMenu multi-select from current page
        const pickedValues = interaction.values || [];
        // Determine items that were presented on current page
        const limit = 25;
        const start = ((session.categoryPage || 1) - 1) * limit;
        const pageCategories = Array.from(
          guild.channels.cache.filter(c => c.type === 4).values()
        ).slice(start, start + limit);
        const pageCatIds = new Set(pageCategories.map(c => c.id));

        // Keep selections from other pages, and update selections from this page
        const otherPageSelections = session.staffCategoryIds.filter(id => !pageCatIds.has(id));
        session.staffCategoryIds = Array.from(new Set([...otherPageSelections, ...pickedValues]));
        updateSession(guild.id, { staffCategoryIds: session.staffCategoryIds });

        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'page_cat': {
        const subAction = parts[5];
        const targetPage = parseInt(parts[6], 10) || 1;
        session.categoryPage = targetPage;
        updateSession(guild.id, { categoryPage: targetPage });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'cat_sel_page': {
        const limit = 25;
        const start = ((session.categoryPage || 1) - 1) * limit;
        const pageCategories = Array.from(
          guild.channels.cache.filter(c => c.type === 4).values()
        ).slice(start, start + limit);
        const newIds = pageCategories.map(c => c.id);
        session.staffCategoryIds = Array.from(new Set([...session.staffCategoryIds, ...newIds]));
        updateSession(guild.id, { staffCategoryIds: session.staffCategoryIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'cat_clear_page': {
        const limit = 25;
        const start = ((session.categoryPage || 1) - 1) * limit;
        const pageCategories = Array.from(
          guild.channels.cache.filter(c => c.type === 4).values()
        ).slice(start, start + limit);
        const pageCatIds = new Set(pageCategories.map(c => c.id));
        session.staffCategoryIds = session.staffCategoryIds.filter(id => !pageCatIds.has(id));
        updateSession(guild.id, { staffCategoryIds: session.staffCategoryIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'cat_clear_all': {
        session.staffCategoryIds = [];
        updateSession(guild.id, { staffCategoryIds: [] });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 3 CONTROLS (CHANNELS) ────────────────────────────────────────
      case 'sel_chan': {
        const pickedValues = interaction.values || [];
        const catSet = new Set(session.staffCategoryIds);
        const eligible = Array.from(
          guild.channels.cache.filter(c => [0, 2, 5, 13, 15].includes(c.type) && (!c.parentId || !catSet.has(c.parentId))).values()
        );
        const limit = 25;
        const start = ((session.channelPage || 1) - 1) * limit;
        const pageChans = eligible.slice(start, start + limit);
        const pageChanIds = new Set(pageChans.map(c => c.id));

        const otherPageSelections = session.staffChannelIds.filter(id => !pageChanIds.has(id));
        session.staffChannelIds = Array.from(new Set([...otherPageSelections, ...pickedValues]));
        updateSession(guild.id, { staffChannelIds: session.staffChannelIds });

        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'page_chan': {
        const targetPage = parseInt(parts[6], 10) || 1;
        session.channelPage = targetPage;
        updateSession(guild.id, { channelPage: targetPage });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'chan_sel_page': {
        const catSet = new Set(session.staffCategoryIds);
        const eligible = Array.from(
          guild.channels.cache.filter(c => [0, 2, 5, 13, 15].includes(c.type) && (!c.parentId || !catSet.has(c.parentId))).values()
        );
        const limit = 25;
        const start = ((session.channelPage || 1) - 1) * limit;
        const pageChans = eligible.slice(start, start + limit);
        const newIds = pageChans.map(c => c.id);
        session.staffChannelIds = Array.from(new Set([...session.staffChannelIds, ...newIds]));
        updateSession(guild.id, { staffChannelIds: session.staffChannelIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'chan_clear_page': {
        const catSet = new Set(session.staffCategoryIds);
        const eligible = Array.from(
          guild.channels.cache.filter(c => [0, 2, 5, 13, 15].includes(c.type) && (!c.parentId || !catSet.has(c.parentId))).values()
        );
        const limit = 25;
        const start = ((session.channelPage || 1) - 1) * limit;
        const pageChans = eligible.slice(start, start + limit);
        const pageChanIds = new Set(pageChans.map(c => c.id));
        session.staffChannelIds = session.staffChannelIds.filter(id => !pageChanIds.has(id));
        updateSession(guild.id, { staffChannelIds: session.staffChannelIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'chan_clear_all': {
        session.staffChannelIds = [];
        updateSession(guild.id, { staffChannelIds: [] });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 4 CONTROLS (STAFF ROLES) ─────────────────────────────────────
      case 'pick_staff': {
        const selected = interaction.values || [];
        const validation = validateRoleSelection(guild, selected, {
          currentGroup: 'staff',
          staffRoleIds: session.staffRoleIds,
          memberRoleIds: session.memberRoleIds,
          ownerRoleIds: session.ownerRoleIds
        });

        if (!validation.valid) {
          return interaction.reply(errorCard({
            title: 'Invalid Role Selection',
            reason: validation.reason,
            fix: 'Choose roles that are not managed, below the bot, and not assigned to other groups.',
            ephemeral: true
          }));
        }

        session.staffRoleIds = Array.from(new Set([...session.staffRoleIds, ...selected]));
        updateSession(guild.id, { staffRoleIds: session.staffRoleIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'rem_staff': {
        const toRemove = interaction.values?.[0];
        if (toRemove) {
          session.staffRoleIds = session.staffRoleIds.filter(id => id !== toRemove);
          updateSession(guild.id, { staffRoleIds: session.staffRoleIds });
        }
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'clear_staff': {
        session.staffRoleIds = [];
        updateSession(guild.id, { staffRoleIds: [] });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 5 CONTROLS (MEMBER ROLES) ────────────────────────────────────
      case 'pick_member': {
        const selected = interaction.values || [];
        const validation = validateRoleSelection(guild, selected, {
          currentGroup: 'member',
          staffRoleIds: session.staffRoleIds,
          memberRoleIds: session.memberRoleIds,
          ownerRoleIds: session.ownerRoleIds
        });

        if (!validation.valid) {
          return interaction.reply(errorCard({
            title: 'Invalid Role Selection',
            reason: validation.reason,
            fix: 'Choose roles that are not managed, below the bot, and not assigned to other groups.',
            ephemeral: true
          }));
        }

        session.memberRoleIds = Array.from(new Set([...session.memberRoleIds, ...selected]));
        updateSession(guild.id, { memberRoleIds: session.memberRoleIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'rem_member': {
        const toRemove = interaction.values?.[0];
        if (toRemove) {
          session.memberRoleIds = session.memberRoleIds.filter(id => id !== toRemove);
          updateSession(guild.id, { memberRoleIds: session.memberRoleIds });
        }
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'clear_member': {
        session.memberRoleIds = [];
        updateSession(guild.id, { memberRoleIds: [] });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'toggle_autorole': {
        session.connectAutorole = !session.connectAutorole;
        updateSession(guild.id, { connectAutorole: session.connectAutorole });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 6 CONTROLS (OWNER ROLES) ─────────────────────────────────────
      case 'pick_owner': {
        const selected = interaction.values || [];
        const validation = validateRoleSelection(guild, selected, {
          currentGroup: 'owner',
          staffRoleIds: session.staffRoleIds,
          memberRoleIds: session.memberRoleIds,
          ownerRoleIds: session.ownerRoleIds
        });

        if (!validation.valid) {
          return interaction.reply(errorCard({
            title: 'Invalid Role Selection',
            reason: validation.reason,
            fix: 'Choose roles that are not managed, below the bot, and not assigned to other groups.',
            ephemeral: true
          }));
        }

        session.ownerRoleIds = Array.from(new Set([...session.ownerRoleIds, ...selected]));
        updateSession(guild.id, { ownerRoleIds: session.ownerRoleIds });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'rem_owner': {
        const toRemove = interaction.values?.[0];
        if (toRemove) {
          session.ownerRoleIds = session.ownerRoleIds.filter(id => id !== toRemove);
          updateSession(guild.id, { ownerRoleIds: session.ownerRoleIds });
        }
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'clear_owner': {
        session.ownerRoleIds = [];
        updateSession(guild.id, { ownerRoleIds: [] });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      // ─── STEP 7 CONTROLS (PREVIEW & APPLY) ─────────────────────────────────
      case 'toggle_everyone': {
        session.hideEveryone = !session.hideEveryone;
        updateSession(guild.id, { hideEveryone: session.hideEveryone });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'toggle_backfill': {
        session.backfillMembers = !session.backfillMembers;
        updateSession(guild.id, { backfillMembers: session.backfillMembers });
        const payload = await renderWizardStep(session, guild);
        await interaction.update(payload);
        return true;
      }

      case 'open_confirm': {
        const modal = new ModalBuilder()
          .setCustomId(`permify:confirm_modal:${guild.id}:${interaction.user.id}:7`)
          .setTitle('Confirm Permission Rebuild');

        const input = new TextInputBuilder()
          .setCustomId('confirm_input')
          .setLabel('Type CONFIRM to execute permission rebuild')
          .setPlaceholder('CONFIRM')
          .setStyle(TextInputStyle.Short)
          .setMinLength(7)
          .setMaxLength(7)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
        return true;
      }

      case 'confirm_modal': {
        if (!interaction.isModalSubmit()) return false;
        const text = interaction.fields.getTextInputValue('confirm_input')?.trim();
        if (text !== 'CONFIRM') {
          await interaction.reply(errorCard({
            title: 'Confirmation Failed',
            reason: 'You did not type CONFIRM.',
            fix: 'Click "Apply Everything" again and type CONFIRM in uppercase to proceed.',
            ephemeral: true
          }));
          return true;
        }

        // Defer interaction to prepare for long-running apply engine
        await interaction.deferUpdate().catch(() => {});
        session.status = 'applying';
        updateSession(guild.id, { status: 'applying' });

        // Kick off execution engine in background
        await executePermifyApply(interaction, session);
        return true;
      }

      default:
        logger.warn({ customId }, 'Unrecognized permify action');
        return false;
    }
  } catch (err) {
    logger.error({ err, customId }, 'Error in permify interaction router');
    const errCard = errorCard({
      title: 'Action Error',
      reason: err.message || 'An unexpected error occurred.',
      fix: 'Please retry or reopen /permify.',
      ephemeral: true
    });
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errCard).catch(() => {});
    } else {
      await interaction.reply(errCard).catch(() => {});
    }
    return true;
  }
}

export default {
  handlePermifyInteraction,
  validateRoleSelection
};

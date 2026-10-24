import { MessageFlags } from 'discord.js';
import {
  getAntiNukeSettings,
  updateAntiNukeSettings,
  getAntiNukeTrusted,
  addAntiNukeTrusted,
  removeAntiNukeTrusted,
  getAntiNukeExempt,
  addAntiNukeExempt,
  removeAntiNukeExempt,
  saveAllChannelSnapshots,
  getLockdownState,
  saveLockdownState
} from '../../db/antinuke.js';
import { getTicketSettings } from '../../db/tickets.js';
import {
  buildAntiNukeWizard,
  buildChannelThresholdModal,
  buildLockdownThresholdModal,
  buildExtraLimitsModal,
  buildExtraOwnerModal
} from './panel.js';
import { terminateLockdown } from './lockdown.js';
import { errorCard, successCard, infoCard, permissionCard } from '../../utils/ui/components.js';
import { logger } from '../../utils/logger.js';

/**
 * Validates that the interacting user is the real server owner or registered extra owner
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
async function isServerOwnerOrExtra(interaction) {
  if (!interaction.guild || !interaction.user) return false;
  const uid = interaction.user.id;

  // Real guild owner
  if (interaction.guild.ownerId === uid) return true;

  // Extra owners
  const settings = await getAntiNukeSettings(interaction.guild.id);
  if (Array.isArray(settings.extra_owners) && settings.extra_owners.includes(uid)) {
    return true;
  }

  const trusted = await getAntiNukeTrusted(interaction.guild.id);
  if (trusted.extraOwners.includes(uid)) return true;

  return false;
}

/**
 * Renders Anti-Nuke wizard payload
 */
async function renderWizard(guild, userId, page = 1) {
  const [settings, trusted, exempt, ticketSettings] = await Promise.all([
    getAntiNukeSettings(guild.id),
    getAntiNukeTrusted(guild.id),
    getAntiNukeExempt(guild.id),
    getTicketSettings(guild.id).catch(() => null)
  ]);

  return buildAntiNukeWizard({
    guild,
    userId,
    page,
    settings,
    trusted,
    exempt,
    ticketCategoryId: ticketSettings?.channel_category_id || null
  });
}

/**
 * Handles all antinuke:* interactions
 * Format: antinuke:<action>:<guildId>:<userId>:<page>
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>}
 */
export async function handleAntiNukeInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('antinuke:')) return false;

  const parts = customId.split(':');
  const action = parts[1];
  const guildId = parts[2] || interaction.guildId;
  const targetUserId = parts[3] || interaction.user.id;
  const page = parseInt(parts[4] || '1', 10);

  // 1. Alert Card Buttons (Accessible by Server Owner and Staff)
  if (action === 'unlock_now') {
    const isOwner = await isServerOwnerOrExtra(interaction);
    if (!isOwner && !interaction.member?.permissions?.has('Administrator')) {
      await interaction.reply({ ...permissionCard({ missing: ['Administrator or Server Owner'] }), flags: MessageFlags.Ephemeral });
      return true;
    }
    await terminateLockdown(interaction.guild, `Manually unlocked by <@${interaction.user.id}>`, true);
    await interaction.reply({
      ...successCard({ title: 'Lockdown Terminated', body: 'Channel permissions restored successfully.' }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  if (action === 'extend_lock') {
    const isOwner = await isServerOwnerOrExtra(interaction);
    if (!isOwner && !interaction.member?.permissions?.has('Administrator')) {
      await interaction.reply({ ...permissionCard({ missing: ['Administrator or Server Owner'] }), flags: MessageFlags.Ephemeral });
      return true;
    }
    const state = await getLockdownState(guildId);
    if (state && state.active) {
      const currentMax = state.max_until ? new Date(state.max_until).getTime() : Date.now();
      state.max_until = new Date(currentMax + 10 * 60 * 1000).toISOString();
      state.calm_until = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await saveLockdownState(guildId, state);
      await interaction.reply({
        ...successCard({ title: 'Lockdown Extended', body: 'Extended lockdown duration by +10 minutes.' }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
    return true;
  }

  if (action === 'undo_bans') {
    const isOwner = await isServerOwnerOrExtra(interaction);
    if (!isOwner) {
      await interaction.reply({ ...permissionCard({ missing: ['Server Owner Only'] }), flags: MessageFlags.Ephemeral });
      return true;
    }
    const state = await getLockdownState(guildId);
    const offenders = state?.offenders || [];
    let unbanned = 0;
    for (const uid of offenders) {
      try {
        await interaction.guild.bans.remove(uid, 'AVA Anti-Nuke: Reverting incident bans');
        unbanned++;
      } catch (_) {}
    }
    await interaction.reply({
      ...successCard({ title: 'Incident Bans Reverted', body: `Successfully unbanned **${unbanned}** member(s).` }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  // 2. Control Panel Interactions: Restricted STRICTLY to Server Owner & Extra Owners
  const isOwner = await isServerOwnerOrExtra(interaction);
  if (!isOwner) {
    await interaction.reply({
      ...permissionCard({
        missing: ['Server Owner Only (Anti-Nuke settings are restricted to the primary server owner)'],
        isBot: false,
        ephemeral: true
      }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  // Opener check
  if (targetUserId && targetUserId !== interaction.user.id && interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({
      ...errorCard({
        title: 'Session Locked',
        reason: 'This Anti-Nuke panel was initiated by the server owner.',
        fix: 'Run /antinuke to create a dedicated control session.'
      }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
    return true;
  }

  try {
    // Navigation
    if (action === 'nav') {
      const payload = await renderWizard(interaction.guild, targetUserId, page);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Close
    if (action === 'close') {
      await interaction.message?.delete().catch(() => {});
      return true;
    }

    // Toggle Enable
    if (action === 'toggle_enable') {
      const s = await getAntiNukeSettings(guildId);
      const newEnabled = !s.enabled;
      await updateAntiNukeSettings(guildId, { enabled: newEnabled });
      if (newEnabled) {
        // Full channel snapshot refresh on enable
        saveAllChannelSnapshots(interaction.guild).catch(() => {});
      }
      const payload = await renderWizard(interaction.guild, targetUserId, 1);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Toggle Dry Run
    if (action === 'toggle_dry_run') {
      const s = await getAntiNukeSettings(guildId);
      await updateAntiNukeSettings(guildId, { dry_run: !s.dry_run });
      const payload = await renderWizard(interaction.guild, targetUserId, 1);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Refresh Snapshots
    if (action === 'snapshot_all') {
      const count = await saveAllChannelSnapshots(interaction.guild);
      await interaction.reply({
        ...successCard({ title: 'Snapshots Updated', body: `Captured structural snapshots for **${count}** channels in Supabase.` }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // Trusted Roles Select
    if (action === 'trusted_roles_sel') {
      const roleIds = interaction.values || [];
      const cur = await getAntiNukeTrusted(guildId);
      for (const oldId of cur.roles) {
        if (!roleIds.includes(oldId)) await removeAntiNukeTrusted(guildId, oldId, 'role');
      }
      for (const newId of roleIds) {
        await addAntiNukeTrusted(guildId, newId, 'role');
      }
      const payload = await renderWizard(interaction.guild, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Trusted Users Select
    if (action === 'trusted_users_sel') {
      const userIds = interaction.values || [];
      const cur = await getAntiNukeTrusted(guildId);
      for (const oldId of cur.users) {
        if (!userIds.includes(oldId)) await removeAntiNukeTrusted(guildId, oldId, 'user');
      }
      for (const newId of userIds) {
        await addAntiNukeTrusted(guildId, newId, 'user');
      }
      const payload = await renderWizard(interaction.guild, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Extra Owner Modal & Submit
    if (action === 'extra_owner_modal') {
      const modal = buildExtraOwnerModal(guildId, targetUserId);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'extra_owner_submit') {
      const newOwnerId = interaction.fields.getTextInputValue('extra_owner_id')?.trim();
      if (newOwnerId) {
        await addAntiNukeTrusted(guildId, newOwnerId, 'extra_owner');
      }
      await interaction.reply({
        ...successCard({ title: 'Extra Owner Registered', body: `Granted owner privileges to <@${newOwnerId}>.` }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // Clear Trusted
    if (action === 'clear_trusted') {
      const cur = await getAntiNukeTrusted(guildId);
      for (const r of cur.roles) await removeAntiNukeTrusted(guildId, r, 'role');
      for (const u of cur.users) await removeAntiNukeTrusted(guildId, u, 'user');
      for (const o of cur.extraOwners) await removeAntiNukeTrusted(guildId, o, 'extra_owner');
      const payload = await renderWizard(interaction.guild, targetUserId, 2);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Toggle Single Restore
    if (action === 'toggle_single_restore') {
      const s = await getAntiNukeSettings(guildId);
      const curVal = Boolean(s.thresholds?.restore_single_deletions);
      await updateAntiNukeSettings(guildId, {
        thresholds: { restore_single_deletions: !curVal }
      });
      const payload = await renderWizard(interaction.guild, targetUserId, 3);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Channel Threshold Modal & Submit
    if (action === 'channel_threshold_modal') {
      const s = await getAntiNukeSettings(guildId);
      const modal = buildChannelThresholdModal(guildId, targetUserId, s.thresholds);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'channel_threshold_submit') {
      const limitVal = parseInt(interaction.fields.getTextInputValue('delete_limit') || '3', 10);
      const windowVal = parseInt(interaction.fields.getTextInputValue('window_seconds') || '10', 10);
      await updateAntiNukeSettings(guildId, {
        thresholds: {
          channel_delete_limit: Math.max(1, limitVal),
          channel_delete_window_seconds: Math.max(2, windowVal)
        }
      });
      await interaction.reply({
        ...successCard({ title: 'Thresholds Updated', body: `Trigger set to **${limitVal} channels** within **${windowVal}s**.` }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    // Punishment Select
    if (action === 'punishment_sel') {
      const p = interaction.values?.[0] || 'ban';
      await updateAntiNukeSettings(guildId, { punishment: p });
      const payload = await renderWizard(interaction.guild, targetUserId, 3);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Exempt Channels & Categories Select
    if (action === 'exempt_channels_sel') {
      const chanIds = interaction.values || [];
      const cur = await getAntiNukeExempt(guildId);
      for (const oldId of cur.channels) {
        if (!chanIds.includes(oldId)) await removeAntiNukeExempt(guildId, oldId, 'channel');
      }
      for (const newId of chanIds) {
        await addAntiNukeExempt(guildId, newId, 'channel');
      }
      const payload = await renderWizard(interaction.guild, targetUserId, 4);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'exempt_categories_sel') {
      const catIds = interaction.values || [];
      const cur = await getAntiNukeExempt(guildId);
      for (const oldId of cur.categories) {
        if (!catIds.includes(oldId)) await removeAntiNukeExempt(guildId, oldId, 'category');
      }
      for (const newId of catIds) {
        await addAntiNukeExempt(guildId, newId, 'category');
      }
      const payload = await renderWizard(interaction.guild, targetUserId, 4);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'clear_exempt') {
      const cur = await getAntiNukeExempt(guildId);
      for (const c of cur.channels) await removeAntiNukeExempt(guildId, c, 'channel');
      for (const cat of cur.categories) await removeAntiNukeExempt(guildId, cat, 'category');
      const payload = await renderWizard(interaction.guild, targetUserId, 4);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Lockdown Modal & Submit
    if (action === 'lockdown_modal') {
      const s = await getAntiNukeSettings(guildId);
      const modal = buildLockdownThresholdModal(guildId, targetUserId, s.thresholds);
      await interaction.showModal(modal).catch(() => {});
      return true;
    }

    if (action === 'lockdown_submit') {
      const raidUsers = parseInt(interaction.fields.getTextInputValue('raid_users') || '5', 10);
      const raidWindow = parseInt(interaction.fields.getTextInputValue('raid_window') || '5', 10);
      const calmSecs = parseInt(interaction.fields.getTextInputValue('calm_seconds') || '60', 10);
      const maxDuration = parseInt(interaction.fields.getTextInputValue('max_duration') || '900', 10);

      await updateAntiNukeSettings(guildId, {
        thresholds: {
          raid_distinct_users: Math.max(2, raidUsers),
          raid_window_seconds: Math.max(2, raidWindow),
          lockdown_calm_seconds: Math.max(10, calmSecs),
          lockdown_max_duration_seconds: Math.min(3600, Math.max(60, maxDuration))
        }
      });

      await interaction.reply({
        ...successCard({ title: 'Lockdown Settings Saved', body: `Configured: **${raidUsers} users / ${raidWindow}s** • Calm: **${calmSecs}s** • Max: **${maxDuration}s**` }),
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
      return true;
    }

    if (action === 'lockdown_punishment_sel') {
      const p = interaction.values?.[0] || 'ban';
      await updateAntiNukeSettings(guildId, { lockdown_punishment: p });
      const payload = await renderWizard(interaction.guild, targetUserId, 5);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Extra Toggles
    if (action === 'toggle_bot_add') {
      const s = await getAntiNukeSettings(guildId);
      const curVal = s.thresholds?.bot_add_protection !== false;
      await updateAntiNukeSettings(guildId, {
        thresholds: { bot_add_protection: !curVal }
      });
      const payload = await renderWizard(interaction.guild, targetUserId, 6);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'toggle_dang_perms') {
      const s = await getAntiNukeSettings(guildId);
      const curVal = s.thresholds?.dangerous_perm_grant !== false;
      await updateAntiNukeSettings(guildId, {
        thresholds: { dangerous_perm_grant: !curVal }
      });
      const payload = await renderWizard(interaction.guild, targetUserId, 6);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    // Page 7 Selects
    if (action === 'log_channel_sel') {
      const chanId = interaction.values?.[0] || null;
      await updateAntiNukeSettings(guildId, { log_channel_id: chanId });
      const payload = await renderWizard(interaction.guild, targetUserId, 7);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'alert_channel_sel') {
      const chanId = interaction.values?.[0] || null;
      await updateAntiNukeSettings(guildId, { alert_channel_id: chanId });
      const payload = await renderWizard(interaction.guild, targetUserId, 7);
      await interaction.update(payload).catch(() => {});
      return true;
    }

    if (action === 'ping_role_sel') {
      const roleId = interaction.values?.[0] || null;
      await updateAntiNukeSettings(guildId, { ping_role_id: roleId });
      const payload = await renderWizard(interaction.guild, targetUserId, 7);
      await interaction.update(payload).catch(() => {});
      return true;
    }

  } catch (err) {
    logger.error({ err, customId }, 'Error handling antinuke interaction');
    await interaction.reply({
      ...errorCard({ title: 'Anti-Nuke Error', reason: err.message }),
      flags: MessageFlags.Ephemeral
    }).catch(() => {});
  }

  return true;
}

export default {
  handleAntiNukeInteraction
};

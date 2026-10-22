import { PermissionFlagsBits } from 'discord.js';
import {
  getTicketCategories,
  getTicketCategory,
  saveTicketCategory,
  deleteTicketCategory,
  getCategoryQuestions,
  saveCategoryQuestions,
  getTicketSettings
} from '../../db/tickets.js';

/**
 * Ensures default categories exist for a guild if none are configured
 */
export async function ensureDefaultCategories(guildId) {
  const existing = await getTicketCategories(guildId);
  if (existing.length > 0) return existing;

  const defaults = [
    {
      guild_id: guildId,
      name: 'General Support',
      emoji: '🎫',
      description: 'General questions and server assistance',
      position: 0,
      max_open_per_user: 1,
      is_enabled: true
    },
    {
      guild_id: guildId,
      name: 'Billing & Store',
      emoji: '💳',
      description: 'Inquiries regarding store purchases and subscriptions',
      position: 1,
      max_open_per_user: 1,
      is_enabled: true
    },
    {
      guild_id: guildId,
      name: 'Report & Appeal',
      emoji: '🛡️',
      description: 'Report disruptive behavior or appeal moderation actions',
      position: 2,
      max_open_per_user: 1,
      is_enabled: true
    }
  ];

  const created = [];
  for (const cat of defaults) {
    const record = await saveTicketCategory(cat);
    created.push(record);
  }
  return created;
}

/**
 * Validates member eligibility against a category's role requirements
 * @param {import('discord.js').GuildMember} member
 * @param {object} category
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkCategoryAccess(member, category) {
  if (!member || !category) return { allowed: true };

  // Blocked Roles Check
  if (category.blocked_role_ids && category.blocked_role_ids.length > 0) {
    const hasBlocked = category.blocked_role_ids.some(rId => member.roles.cache.has(rId));
    if (hasBlocked) {
      return {
        allowed: false,
        reason: `Your roles are blocked from opening tickets in **${category.name}**.`
      };
    }
  }

  // Required Roles Check
  if (category.required_role_ids && category.required_role_ids.length > 0) {
    const hasRequired = category.required_role_ids.some(rId => member.roles.cache.has(rId));
    if (!hasRequired) {
      return {
        allowed: false,
        reason: `You need a required role to open tickets in **${category.name}**.`
      };
    }
  }

  return { allowed: true };
}

import { getGuildRoles } from '../../db/permify.js';

/**
 * Checks if a member has staff or admin access for tickets
 * @param {object} options
 * @param {import('discord.js').GuildMember} options.member
 * @param {object} [options.category]
 * @param {string} [options.guildId]
 * @returns {Promise<boolean>}
 */
export async function checkStaffAccess({ member, category, guildId }) {
  if (!member) return false;
  const gid = guildId || member.guild?.id;
  if (
    member.id === member.guild?.ownerId ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageChannels)
  ) {
    return true;
  }
  const settings = await getTicketSettings(gid);
  const staffRoles = new Set([
    ...(settings?.support_role_ids || []),
    ...(settings?.admin_role_ids || []),
    ...(category?.support_role_ids || [])
  ]);

  const permifyRoles = await getGuildRoles(gid).catch(() => null);
  if (permifyRoles?.staff) {
    for (const r of permifyRoles.staff) staffRoles.add(r);
  }
  if (permifyRoles?.owner) {
    for (const r of permifyRoles.owner) staffRoles.add(r);
  }

  return staffRoles.size > 0 && member.roles?.cache?.some(r => staffRoles.has(r.id));
}

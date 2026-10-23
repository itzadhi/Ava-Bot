import { PermissionFlagsBits } from 'discord.js';
import { getGuildRoles } from '../../db/permify.js';

/**
 * Checks whether a guild member has Shop Manager privileges.
 * Managers can edit settings, create/edit/archive products, restock, and manage categories.
 *
 * Privileged users:
 * 1. Server Owner
 * 2. Administrator permission
 * 3. Configured shop manager_role_ids
 * 4. Permify Owner roles (fallback default)
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} [shopSettings]
 * @returns {Promise<boolean>}
 */
export async function isShopManager(member, shopSettings = null) {
  if (!member || !member.guild) return false;

  // 1. Server owner
  if (member.guild.ownerId === member.id) return true;

  // 2. Administrator permission
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;

  // 3. Explicitly configured shop manager roles
  const managerRoles = shopSettings?.manager_role_ids || [];
  if (Array.isArray(managerRoles) && managerRoles.some(roleId => member.roles.cache.has(roleId))) {
    return true;
  }

  // 4. Default fallback: Permify Owner roles
  try {
    const permifyRoles = await getGuildRoles(member.guild.id);
    const ownerRoles = permifyRoles?.owner || [];
    if (ownerRoles.some(roleId => member.roles.cache.has(roleId))) {
      return true;
    }
  } catch (_) {}

  return false;
}

/**
 * Checks whether a guild member has Shop Staff privileges.
 * Staff can view orders, mark paid, deliver items, and handle tickets.
 *
 * Privileged users:
 * 1. Anyone who is a Shop Manager
 * 2. Configured shop support_role_ids
 * 3. Permify Staff roles (fallback default)
 *
 * @param {import('discord.js').GuildMember} member
 * @param {object} [shopSettings]
 * @returns {Promise<boolean>}
 */
export async function isShopStaff(member, shopSettings = null) {
  if (!member || !member.guild) return false;

  // Managers automatically have staff rights
  const isManager = await isShopManager(member, shopSettings);
  if (isManager) return true;

  // Explicitly configured support roles
  const supportRoles = shopSettings?.support_role_ids || [];
  if (Array.isArray(supportRoles) && supportRoles.some(roleId => member.roles.cache.has(roleId))) {
    return true;
  }

  // Default fallback: Permify Staff roles
  try {
    const permifyRoles = await getGuildRoles(member.guild.id);
    const staffRoles = permifyRoles?.staff || [];
    if (staffRoles.some(roleId => member.roles.cache.has(roleId))) {
      return true;
    }
  } catch (_) {}

  return false;
}

export default {
  isShopManager,
  isShopStaff
};

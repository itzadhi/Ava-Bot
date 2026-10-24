import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getMemberStickyRoles, saveMemberStickyRoles } from '../../db/sticky.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles member leave event by persisting their roles
 * @param {import('discord.js').GuildMember} member
 */
export async function handleStickyRoleMemberLeave(member) {
  if (!member.guild || member.user?.bot) return;

  const guild = member.guild;
  const settings = await getGuildSettings(guild.id);
  if (!settings || settings.sticky_roles_enabled === false) return;

  // Filter out @everyone and managed integration roles (nitro boost role, bot roles, etc.)
  const eligibleRoleIds = [];
  const cache = member.roles?.cache;
  if (cache && typeof cache.entries === 'function') {
    for (const [id, role] of cache.entries()) {
      if (id !== guild.id && !role?.managed) {
        eligibleRoleIds.push(id);
      }
    }
  }

  let roleIdsToSave = eligibleRoleIds;

  // If specific roles mode is active, filter against configured whitelist
  if (settings.sticky_all_roles === false && Array.isArray(settings.sticky_role_ids) && settings.sticky_role_ids.length > 0) {
    roleIdsToSave = roleIdsToSave.filter(id => settings.sticky_role_ids.includes(id));
  }

  if (roleIdsToSave.length > 0) {
    await saveMemberStickyRoles(guild.id, member.id, roleIdsToSave);
    logger.info({ guildId: guild.id, userId: member.id, count: roleIdsToSave.length }, 'Saved member sticky roles upon departure');
  }
}

/**
 * Handles member rejoin event by restoring saved roles
 * @param {import('discord.js').GuildMember} member
 */
export async function handleStickyRoleMemberRejoin(member) {
  if (!member.guild || member.user?.bot) return;

  const guild = member.guild;
  const settings = await getGuildSettings(guild.id);
  if (!settings || settings.sticky_roles_enabled === false) return;

  const savedRoleIds = await getMemberStickyRoles(guild.id, member.id);
  if (!savedRoleIds || savedRoleIds.length === 0) return;

  const me = guild.members.me || guild.client?.user;
  const botHasManageRoles = guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles);
  if (!botHasManageRoles) {
    logger.warn({ guildId: guild.id }, 'Cannot restore sticky roles: Bot missing Manage Roles permission');
    return;
  }

  // Filter roles that still exist in guild and are below bot's highest role
  const botHighestPosition = guild.members.me.roles.highest.position;
  const validRoles = savedRoleIds.filter(roleId => {
    const role = guild.roles.cache.get(roleId);
    return role && role.position < botHighestPosition && !role.managed;
  });

  if (validRoles.length > 0) {
    try {
      await member.roles.add(validRoles, 'AVA Sticky Roles: Restoring previous member roles upon rejoining');
      logger.info({ guildId: guild.id, userId: member.id, roles: validRoles }, 'Restored member sticky roles upon rejoin');
    } catch (err) {
      logger.warn({ err, guildId: guild.id, userId: member.id }, 'Error adding sticky roles to rejoining member');
    }
  }
}

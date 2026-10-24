import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getGuildRoles } from '../../db/permify.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles member join event to automatically assign configured welcome roles
 * Supports multiple member roles and excludes staff and owner roles.
 *
 * @param {import('discord.js').GuildMember} member
 */
export async function handleAutoRoleMemberJoin(member) {
  if (!member.guild) return;

  const guild = member.guild;
  const settings = await getGuildSettings(guild.id);
  if (!settings || settings.autorole_enabled === false) return;

  const botHasManageRoles = guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles);
  if (!botHasManageRoles) {
    logger.warn({ guildId: guild.id }, 'Cannot assign auto-roles: Bot missing Manage Roles permission');
    return;
  }

  const isBot = Boolean(member.user?.bot);

  // 1. Bot Auto-Role
  if (isBot && settings.autorole_bot_role_id) {
    const roleId = settings.autorole_bot_role_id;
    const role = guild.roles.cache.get(roleId);
    if (role && role.position < guild.members.me.roles.highest.position) {
      try {
        await member.roles.add(roleId, 'AVA Auto-Role: Automated bot role assignment');
        logger.info({ guildId: guild.id, userId: member.id, roleId }, 'Auto-assigned bot role upon join');
      } catch (err) {
        logger.warn({ err, guildId: guild.id, roleId }, 'Error assigning bot auto-role');
      }
    }
    return;
  }

  // 2. Human Member Auto-Role (Multi-role support with fallback)
  if (!isBot) {
    let targetRoleIds = [];
    if (Array.isArray(settings.autorole_member_role_ids) && settings.autorole_member_role_ids.length > 0) {
      targetRoleIds = settings.autorole_member_role_ids;
    } else if (settings.autorole_member_role_id) {
      targetRoleIds = [settings.autorole_member_role_id];
    }

    if (targetRoleIds.length === 0) return;

    // Safety rule: Never assign Staff or Owner roles via autorole
    const guildRoles = await getGuildRoles(guild.id);
    const forbiddenRoles = new Set([...(guildRoles.staff || []), ...(guildRoles.owner || [])]);

    const botHighest = guild.members.me.roles.highest.position;
    const assignableRoleIds = targetRoleIds.filter(id => {
      if (forbiddenRoles.has(id)) return false;
      const role = guild.roles.cache.get(id);
      return role && role.position < botHighest;
    });

    if (assignableRoleIds.length > 0) {
      try {
        if (assignableRoleIds.length === 1) {
          await member.roles.add(assignableRoleIds[0], 'AVA Auto-Role: Automated member role assignment');
        } else {
          await member.roles.add(assignableRoleIds, 'AVA Auto-Role: Automated member role assignment');
        }
        logger.info({
          guildId: guild.id,
          userId: member.id,
          roleCount: assignableRoleIds.length
        }, 'Auto-assigned member roles upon join');
      } catch (err) {
        logger.warn({ err, guildId: guild.id }, 'Error assigning member auto-roles');
      }
    }
  }
}

export default {
  handleAutoRoleMemberJoin
};

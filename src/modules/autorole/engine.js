import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { logger } from '../../utils/logger.js';

/**
 * Handles member join event to automatically assign configured welcome roles
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
        await member.roles.add(roleId, 'Argoni Auto-Role: Automated bot role assignment');
        logger.info({ guildId: guild.id, userId: member.id, roleId }, 'Auto-assigned bot role upon join');
      } catch (err) {
        logger.warn({ err, guildId: guild.id, roleId }, 'Error assigning bot auto-role');
      }
    }
  }

  // 2. Human Member Auto-Role
  if (!isBot && settings.autorole_member_role_id) {
    const roleId = settings.autorole_member_role_id;
    const role = guild.roles.cache.get(roleId);
    if (role && role.position < guild.members.me.roles.highest.position) {
      try {
        await member.roles.add(roleId, 'Argoni Auto-Role: Automated member role assignment');
        logger.info({ guildId: guild.id, userId: member.id, roleId }, 'Auto-assigned human member role upon join');
      } catch (err) {
        logger.warn({ err, guildId: guild.id, roleId }, 'Error assigning member auto-role');
      }
    }
  }
}

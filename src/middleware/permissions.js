import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { getGuildSettings } from '../db/guilds.js';
import { errorCard } from '../ui/cards.js';
import { config } from '../config.js';

export async function checkPermissions(ctx, command) {
  // If command is invoked in DM (only owner prefix allowed), skip guild perm checks
  if (!ctx.guild) {
    if (config.OWNER_IDS.includes(ctx.user.id)) {
      return { ok: true };
    }
    return { ok: false };
  }

  const isGuildOwner = ctx.guild.ownerId === ctx.user.id;
  const isBotOwner = config.OWNER_IDS.includes(ctx.user.id);

  // 1. OWNER ONLY CHECK
  if (command.ownerOnly) {
    if (!isBotOwner) {
      if (ctx.isSlash) {
        await ctx.reply(errorCard({
          title: 'Unauthorized',
          reason: 'This command is strictly reserved for the bot owner.',
          fix: 'Only authorized administrators can run this action.',
          ephemeral: true
        }));
      }
      return { ok: false };
    }
    return { ok: true };
  }

  // 2. SERVER OWNER ONLY CHECK (only for commands explicitly requiring serverOwnerOnly)
  if (command.serverOwnerOnly) {
    if (!isGuildOwner && !isBotOwner) {
      await ctx.reply(errorCard({
        title: 'Server Owner Only',
        subtitle: `Restricted on ${ctx.guild.name}`,
        reason: 'This command is strictly reserved for the Server Owner.',
        fix: `Only the server owner (<@${ctx.guild.ownerId}>) is authorized to run this action.`,
        ephemeral: true
      }));
      return { ok: false };
    }
  }

  // 3. USER PERMISSIONS CHECK (ManageGuild, Administrator, or Staff role)
  if (command.userPermissions && command.userPermissions.length > 0) {
    if (!isGuildOwner && !isBotOwner) {
      const member = ctx.member;
      let hasRequired = false;

      if (member) {
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) {
          hasRequired = true;
        } else {
          hasRequired = command.userPermissions.some(perm => member.permissions?.has(perm));
        }

        // Check configured staff role
        if (!hasRequired) {
          const settings = await getGuildSettings(ctx.guild.id);
          if (settings?.staff_role_id && member.roles?.cache?.has(settings.staff_role_id)) {
            hasRequired = true;
          }
        }
      }

      if (!hasRequired) {
        const missingNames = [];
        for (const perm of command.userPermissions) {
          for (const [k, v] of Object.entries(PermissionFlagsBits)) {
            if (v === perm) missingNames.push(k);
          }
        }

        await ctx.reply(errorCard({
          title: 'Permission Denied',
          subtitle: `Required permission(s) missing for /${command.name}`,
          reason: `You need the following permission(s): **${missingNames.join(', ')}** (or the server Staff role).`,
          fix: 'Ask a server administrator to grant you the required permissions or the staff role.',
          ephemeral: true
        }));
        return { ok: false };
      }
    }
  }

  // 4. BOT PERMISSIONS CHECK
  if (command.botPermissions && command.botPermissions.length > 0) {
    const botMember = ctx.guild.members.me;
    if (botMember) {
      const missing = [];
      for (const perm of command.botPermissions) {
        if (!botMember.permissions.has(perm)) {
          for (const [k, v] of Object.entries(PermissionFlagsBits)) {
            if (v === perm) missing.push(k);
          }
        }
      }

      if (missing.length > 0) {
        await ctx.reply(errorCard({
          title: 'Bot Missing Permissions',
          subtitle: `Argoni requires additional Discord permissions to run /${command.name}.`,
          reason: `Missing bot permissions: **${missing.join(', ')}**`,
          fix: 'Navigate to Server Settings -> Roles -> Argoni, and enable the missing permissions.',
          ephemeral: true
        }));
        return { ok: false };
      }
    }
  }

  return { ok: true };
}

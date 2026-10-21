import {
  PermissionFlagsBits,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  SeparatorBuilder
} from 'discord.js';
import {
  getSession,
  isGuildLocked,
  createSession
} from '../../modules/permify/session.js';
import { renderWizardStep } from '../../modules/permify/wizard.js';
import { getLatestSnapshot, getGuildRoles } from '../../db/permify.js';
import { permissionCard, errorCard } from '../../utils/ui/components.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import * as format from '../../utils/ui/format.js';

export default {
  name: 'permify',
  aliases: ['perm', 'permissions', 'perms-wizard', 'setup-perms'],
  description: 'First-time server permission setup wizard and role architect',
  category: 'settings',
  cooldown: 30, // 30-second per-guild cooldown
  args: [],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Required',
        reason: 'This command can only be used inside a Discord server.',
        ephemeral: true
      }));
    }

    const guild = ctx.guild;
    const user = ctx.user;
    const member = ctx.member;

    // 1. Authorization: Only Server Owner or members with Administrator
    const isOwner = guild.ownerId === user.id;
    const isAdmin = member?.permissions?.has(PermissionFlagsBits.Administrator);

    if (!isOwner && !isAdmin) {
      return ctx.reply(permissionCard({
        missing: ['Administrator'],
        isBot: false,
        ephemeral: true
      }));
    }

    // 2. Bot Pre-Check: Administrator, or ManageChannels, ManageRoles, ViewChannel, SendMessages, ManageMessages
    const botMember = guild.members.me;
    if (!botMember) {
      return ctx.reply(errorCard({
        title: 'Bot Member Unavailable',
        reason: 'Unable to resolve the bot in this server.',
        ephemeral: true
      }));
    }

    const hasAdmin = botMember.permissions.has(PermissionFlagsBits.Administrator);
    if (!hasAdmin) {
      const required = [
        { perm: PermissionFlagsBits.ManageChannels, name: 'ManageChannels' },
        { perm: PermissionFlagsBits.ManageRoles, name: 'ManageRoles' },
        { perm: PermissionFlagsBits.ViewChannel, name: 'ViewChannel' },
        { perm: PermissionFlagsBits.SendMessages, name: 'SendMessages' },
        { perm: PermissionFlagsBits.ManageMessages, name: 'ManageMessages' }
      ];

      const missing = required
        .filter(r => !botMember.permissions.has(r.perm))
        .map(r => r.name);

      if (missing.length > 0) {
        return ctx.reply(permissionCard({
          missing,
          isBot: true,
          ephemeral: true
        }));
      }
    }

    // 3. Guild Lock Check
    if (isGuildLocked(guild.id)) {
      const activeSession = getSession(guild.id);
      return ctx.reply(errorCard({
        title: 'Wizard Active',
        reason: `A permission wizard is already running in this server (opened by <@${activeSession?.userId || 'Unknown'}>).`,
        fix: 'Please wait for the current session to complete or expire after 15 minutes of inactivity.',
        ephemeral: true
      }));
    }

    // 4. Check for Recovery / Crash snapshot if available
    const latestSnapshot = await getLatestSnapshot(guild.id);

    // 5. Initialize fresh session with pre-populated roles if existing
    const session = createSession({
      guildId: guild.id,
      userId: user.id,
      channelId: ctx.channel.id
    });

    const existingRoles = await getGuildRoles(guild.id);
    if (existingRoles.staff?.length > 0) session.staffRoleIds = existingRoles.staff;
    if (existingRoles.member?.length > 0) session.memberRoleIds = existingRoles.member;
    if (existingRoles.owner?.length > 0) session.ownerRoleIds = existingRoles.owner;

    // 6. If a previous snapshot exists, show recovery prompt banner or proceed directly
    const payload = await renderWizardStep(session, guild);

    // If there is an existing snapshot, append an Undo option row in step 1 for quick recovery
    if (latestSnapshot && payload.components?.[0]) {
      const restoreRow = new ActionRowBuilder().addComponents(
        greyButton({
          id: `permify:open_undo:${guild.id}:${user.id}`,
          label: `Undo Last Run (${format.time(latestSnapshot.created_at, 'R')})`,
          emoji: '🔄'
        })
      );
      payload.components[0].addActionRowComponents(restoreRow);
    }

    const replyMsg = await ctx.reply(payload);
    if (replyMsg && replyMsg.id) {
      session.messageId = replyMsg.id;
    }
  }
};

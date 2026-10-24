import { PermissionFlagsBits, ChannelType } from 'discord.js';
import {
  getActiveSyncsBySource,
  recordSyncedMessage,
  isMessageAlreadySynced
} from '../../db/syncs.js';
import { getGuildSettings } from '../../db/guilds.js';
import { addJob } from '../../services/queue.js';
import { logger } from '../../utils/logger.js';
import { buildContainer } from '../../utils/ui/builders.js';

/**
 * Handles message sync event with loop prevention
 * @param {import('discord.js').Message} message 
 */
export async function handleMessageSync(message) {
  // Ignore bots and webhooks to avoid recursive sync
  if (message.author.bot || message.webhookId || !message.guild) return;

  // Check if message is already a synced copy
  if (await isMessageAlreadySynced(message.id)) return;

  const syncs = await getActiveSyncsBySource(message.guild.id, 'messages');
  if (!syncs || syncs.length === 0) return;

  // Verify source guild has message sync enabled
  const sourceSettings = await getGuildSettings(message.guild.id);
  if (!sourceSettings.message_sync_enabled) return;

  // Never sync private ticket channels or temporary voice channels
  if (message.channel.name?.startsWith('ticket-') || message.channel.name?.startsWith('tkt-')) return;

  for (const sync of syncs) {
    if (!sync.source_channel || sync.source_channel !== message.channel.id) continue;

    const targetGuild = message.client.guilds.cache.get(sync.target_guild);
    if (!targetGuild) continue;

    // Verify target guild has message sync enabled
    const targetSettings = await getGuildSettings(targetGuild.id);
    if (!targetSettings.message_sync_enabled) continue;

    const targetChannel = sync.target_channel
      ? targetGuild.channels.cache.get(sync.target_channel)
      : targetGuild.channels.cache.find(c => c.name === message.channel.name && c.isTextBased());

    if (!targetChannel || !targetChannel.isTextBased()) continue;

    await addJob(async () => {
      try {
        const hooks = await targetChannel.fetchWebhooks().catch(() => new Map());
        let webhook = hooks.find(h => h.owner?.id === message.client.user.id);

        if (!webhook && targetGuild.members.me?.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
          webhook = await targetChannel.createWebhook({
            name: 'AVA Sync',
            reason: `Cross-server message sync from ${message.guild.name}`
          });
        }

        const attachments = Array.from(message.attachments.values()).map(a => a.url);
        const timeHeader = `-# Synced from **${message.guild.name}** <t:${Math.floor(Date.now() / 1000)}:R>`;
        const content = message.content ? `${message.content}\n${timeHeader}` : timeHeader;

        let sentMsg;
        if (webhook) {
          sentMsg = await webhook.send({
            content,
            username: `${message.author.username} [Sync]`,
            avatarURL: message.author.displayAvatarURL(),
            files: attachments
          });
        } else if (targetChannel.permissionsFor(targetGuild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
          sentMsg = await targetChannel.send(buildContainer({
            title: `${message.author.username} [Sync]`,
            lines: [
              `**Server:** ${message.guild.name}`,
              message.content || '_No text content_',
              timeHeader
            ],
            thumbnail: message.author.displayAvatarURL?.()
          }));
        }

        if (sentMsg) {
          await recordSyncedMessage(message.id, sentMsg.id, sync.id);
        }
      } catch (err) {
        logger.error({ err, syncId: sync.id }, 'Error synchronizing message to target guild');
      }
    });
  }
}

/**
 * Handles ban synchronization between guilds
 * @param {import('discord.js').GuildBan} ban 
 */
export async function handleBanSync(ban) {
  const syncs = await getActiveSyncsBySource(ban.guild.id, 'bans');
  if (!syncs || syncs.length === 0) return;

  for (const sync of syncs) {
    const targetGuild = ban.client.guilds.cache.get(sync.target_guild);
    if (!targetGuild) continue;

    if (!targetGuild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) continue;

    await addJob(async () => {
      try {
        await targetGuild.bans.create(ban.user.id, {
          reason: `AVA Ban Sync: Banned in ${ban.guild.name} (${ban.reason || 'No reason provided'})`
        });
        logger.info(`Synced ban for user ${ban.user.tag} to guild ${targetGuild.name}`);
      } catch (err) {
        logger.error({ err, targetGuild: targetGuild.name }, 'Error syncing ban to target guild');
      }
    });
  }
}

/**
 * Handles role-assignment synchronization for members
 * @param {import('discord.js').GuildMember} oldMember 
 * @param {import('discord.js').GuildMember} newMember 
 */
export async function handleRoleAssignSync(oldMember, newMember) {
  const syncs = await getActiveSyncsBySource(newMember.guild.id, 'role-assign');
  if (!syncs || syncs.length === 0) return;

  for (const sync of syncs) {
    const targetGuild = newMember.client.guilds.cache.get(sync.target_guild);
    if (!targetGuild) continue;

    const targetMember = await targetGuild.members.fetch(newMember.id).catch(() => null);
    if (!targetMember) continue;

    const sourceRoleId = sync.source_channel; // Stored in source_channel column
    const targetRoleId = sync.target_channel; // Stored in target_channel column

    const hadRole = oldMember.roles.cache.has(sourceRoleId);
    const hasRole = newMember.roles.cache.has(sourceRoleId);

    if (!hadRole && hasRole) {
      // Role was added
      await addJob(async () => {
        try {
          await targetMember.roles.add(targetRoleId, `AVA Sync: Assigned role in ${newMember.guild.name}`);
        } catch (_) {}
      });
    } else if (hadRole && !hasRole) {
      // Role was removed
      await addJob(async () => {
        try {
          await targetMember.roles.remove(targetRoleId, `AVA Sync: Removed role in ${newMember.guild.name}`);
        } catch (_) {}
      });
    }
  }
}

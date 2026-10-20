import {
  AuditLogEvent,
  ChannelType
} from 'discord.js';
import { buildLogCard, dispatchLog } from './engine.js';
import * as format from '../../utils/ui/format.js';
import { logger } from '../../utils/logger.js';

/**
 * Registers all Server Logging event listeners on the Discord client
 * @param {import('discord.js').Client} client
 */
export function registerLogListeners(client) {
  // 1. Member Joined
  client.on('guildMemberAdd', async (member) => {
    try {
      if (!member.guild) return;
      const card = buildLogCard({
        eventName: 'Member Joined',
        emoji: '📥',
        category: 'members',
        user: member.user,
        targetId: member.id,
        details: [
          format.kvLine('Account Created', format.timeLongAndRelative(member.user.createdAt)),
          format.kvLine('Member Count', `${member.guild.memberCount}`)
        ]
      });
      await dispatchLog(member.guild, { category: 'members', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in guildMemberAdd logger');
    }
  });

  // 2. Member Left
  client.on('guildMemberRemove', async (member) => {
    try {
      if (!member.guild) return;
      const rolesList = member.roles?.cache
        ? member.roles.cache.filter(r => r.id !== member.guild.id).map(r => `<@&${r.id}>`).join(' ')
        : 'None';

      const card = buildLogCard({
        eventName: 'Member Left',
        emoji: '📤',
        category: 'members',
        user: member.user,
        targetId: member.id,
        details: [
          format.kvLine('Joined Server', member.joinedAt ? format.timeLongAndRelative(member.joinedAt) : 'Unknown'),
          format.kvLine('Roles Before Leaving', rolesList || 'None')
        ]
      });
      await dispatchLog(member.guild, { category: 'members', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in guildMemberRemove logger');
    }
  });

  // 3. Member Banned
  client.on('guildBanAdd', async (ban) => {
    try {
      if (!ban.guild) return;
      const card = buildLogCard({
        eventName: 'Member Banned',
        emoji: '🔨',
        category: 'mod',
        user: ban.user,
        targetId: ban.user?.id,
        reason: ban.reason || 'No reason provided'
      });
      await dispatchLog(ban.guild, { category: 'mod', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in guildBanAdd logger');
    }
  });

  // 4. Member Unbanned
  client.on('guildBanRemove', async (ban) => {
    try {
      if (!ban.guild) return;
      const card = buildLogCard({
        eventName: 'Member Unbanned',
        emoji: '🔓',
        category: 'mod',
        user: ban.user,
        targetId: ban.user?.id
      });
      await dispatchLog(ban.guild, { category: 'mod', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in guildBanRemove logger');
    }
  });

  // 5. Member Updated (Nicknames, Roles, Timeouts)
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      const guild = newMember.guild;
      if (!guild) return;

      // Nickname change
      if (oldMember.nickname !== newMember.nickname) {
        const card = buildLogCard({
          eventName: 'Nickname Changed',
          emoji: '📝',
          category: 'members',
          user: newMember.user,
          targetId: newMember.id,
          details: [
            format.kvLine('Before', format.code(oldMember.nickname || oldMember.user.username)),
            format.kvLine('After', format.code(newMember.nickname || newMember.user.username))
          ]
        });
        await dispatchLog(guild, { category: 'members', cardPayload: card });
      }

      // Role changes
      if (oldMember.roles?.cache && newMember.roles?.cache) {
        const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

        if (addedRoles.size > 0 || removedRoles.size > 0) {
          const roleDetails = [];
          if (addedRoles.size > 0) {
            roleDetails.push(format.kvLine('Roles Added', addedRoles.map(r => `<@&${r.id}>`).join(' ')));
          }
          if (removedRoles.size > 0) {
            roleDetails.push(format.kvLine('Roles Removed', removedRoles.map(r => `<@&${r.id}>`).join(' ')));
          }

          const card = buildLogCard({
            eventName: 'Member Roles Updated',
            emoji: '🧲',
            category: 'roles',
            user: newMember.user,
            targetId: newMember.id,
            details: roleDetails
          });
          await dispatchLog(guild, { category: 'roles', cardPayload: card });
        }
      }

      // Timeout change
      const oldTimeout = oldMember.communicationDisabledUntilTimestamp;
      const newTimeout = newMember.communicationDisabledUntilTimestamp;
      if (oldTimeout !== newTimeout) {
        if (newTimeout && newTimeout > Date.now()) {
          const card = buildLogCard({
            eventName: 'Member Timed Out',
            emoji: '⏳',
            category: 'mod',
            user: newMember.user,
            targetId: newMember.id,
            details: [
              format.kvLine('Timeout Expires', format.timeLongAndRelative(new Date(newTimeout)))
            ]
          });
          await dispatchLog(guild, { category: 'mod', cardPayload: card });
        } else if (oldTimeout && (!newTimeout || newTimeout <= Date.now())) {
          const card = buildLogCard({
            eventName: 'Member Timeout Removed',
            emoji: '⏰',
            category: 'mod',
            user: newMember.user,
            targetId: newMember.id
          });
          await dispatchLog(guild, { category: 'mod', cardPayload: card });
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Error in guildMemberUpdate logger');
    }
  });

  // 6. Message Deleted
  client.on('messageDelete', async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;
      if (!message.content && (!message.attachments || message.attachments.size === 0)) return;

      const card = buildLogCard({
        eventName: 'Message Deleted',
        emoji: '🗑️',
        category: 'messages',
        user: message.author,
        channel: message.channel,
        targetId: message.id,
        content: message.content || null,
        attachments: message.attachments ? Array.from(message.attachments.values()).map(a => ({ name: a.name, url: a.url })) : []
      });

      await dispatchLog(message.guild, { category: 'messages', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in messageDelete logger');
    }
  });

  // 7. Message Edited
  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      if (!oldMessage.content && !newMessage.content) return;

      const card = buildLogCard({
        eventName: 'Message Edited',
        emoji: '📝',
        category: 'messages',
        user: newMessage.author,
        channel: newMessage.channel,
        targetId: newMessage.id,
        beforeText: oldMessage.content || '_No original text captured_',
        afterText: newMessage.content || '_Empty message_',
        details: [
          `[Jump to Message](${newMessage.url})`
        ]
      });

      await dispatchLog(newMessage.guild, { category: 'messages', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in messageUpdate logger');
    }
  });

  // 8. Bulk Message Delete (Batched into one card)
  client.on('messageDeleteBulk', async (messages, channel) => {
    try {
      const guild = channel.guild;
      if (!guild) return;

      const authors = new Set();
      for (const m of messages.values()) {
        if (m.author) authors.add(`<@${m.author.id}>`);
      }

      const card = buildLogCard({
        eventName: 'Bulk Messages Deleted',
        emoji: '🧹',
        category: 'messages',
        channel,
        targetId: channel.id,
        details: [
          format.kvLine('Messages Purged', `**${messages.size}** messages`),
          format.kvLine('Affected Authors', Array.from(authors).slice(0, 10).join(' ') || 'Unknown')
        ]
      });

      await dispatchLog(guild, { category: 'messages', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in messageDeleteBulk logger');
    }
  });

  // 9. Channel Created, Deleted & Updated
  client.on('channelCreate', async (channel) => {
    try {
      if (!channel.guild) return;
      const card = buildLogCard({
        eventName: 'Channel Created',
        emoji: '📁',
        category: 'channels',
        channel,
        targetId: channel.id,
        details: [
          format.kvLine('Channel Name', format.code(channel.name)),
          format.kvLine('Channel Type', `${channel.type}`)
        ]
      });
      await dispatchLog(channel.guild, { category: 'channels', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in channelCreate logger');
    }
  });

  client.on('channelDelete', async (channel) => {
    try {
      if (!channel.guild) return;
      const card = buildLogCard({
        eventName: 'Channel Deleted',
        emoji: '🗑️',
        category: 'channels',
        targetId: channel.id,
        details: [
          format.kvLine('Channel Name', format.code(channel.name)),
          format.kvLine('Channel Type', `${channel.type}`)
        ]
      });
      await dispatchLog(channel.guild, { category: 'channels', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in channelDelete logger');
    }
  });

  client.on('channelUpdate', async (oldChan, newChan) => {
    try {
      if (!newChan.guild) return;
      if (oldChan.name === newChan.name && oldChan.topic === newChan.topic) return;

      const changes = [];
      if (oldChan.name !== newChan.name) {
        changes.push(format.kvLine('Renamed', `${format.code(oldChan.name)} ➔ ${format.code(newChan.name)}`));
      }
      if (oldChan.topic !== newChan.topic) {
        changes.push(format.kvLine('Topic Changed', format.truncate(newChan.topic || 'None', 200)));
      }

      const card = buildLogCard({
        eventName: 'Channel Updated',
        emoji: '📝',
        category: 'channels',
        channel: newChan,
        targetId: newChan.id,
        details: changes
      });
      await dispatchLog(newChan.guild, { category: 'channels', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in channelUpdate logger');
    }
  });

  // 10. Role Created, Deleted & Updated
  client.on('roleCreate', async (role) => {
    try {
      if (!role.guild) return;
      const card = buildLogCard({
        eventName: 'Role Created',
        emoji: '🛡️',
        category: 'roles',
        targetId: role.id,
        details: [
          format.kvLine('Role', `<@&${role.id}> (${format.code(role.name)})`),
          format.kvLine('Color', `#${role.color.toString(16).padStart(6, '0')}`)
        ]
      });
      await dispatchLog(role.guild, { category: 'roles', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in roleCreate logger');
    }
  });

  client.on('roleDelete', async (role) => {
    try {
      if (!role.guild) return;
      const card = buildLogCard({
        eventName: 'Role Deleted',
        emoji: '🗑️',
        category: 'roles',
        targetId: role.id,
        details: [
          format.kvLine('Role Name', format.code(role.name)),
          format.kvLine('Role ID', format.code(role.id))
        ]
      });
      await dispatchLog(role.guild, { category: 'roles', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in roleDelete logger');
    }
  });

  // 11. Voice State (Join, Leave, Move)
  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const user = newState.member?.user || oldState.member?.user;
      if (!user || user.bot) return;

      // Join
      if (!oldState.channelId && newState.channelId) {
        const card = buildLogCard({
          eventName: 'Voice Channel Joined',
          emoji: '🔊',
          category: 'voice',
          user,
          channel: newState.channel,
          targetId: user.id
        });
        await dispatchLog(guild, { category: 'voice', cardPayload: card });
      }
      // Leave
      else if (oldState.channelId && !newState.channelId) {
        const card = buildLogCard({
          eventName: 'Voice Channel Left',
          emoji: '🔇',
          category: 'voice',
          user,
          channel: oldState.channel,
          targetId: user.id
        });
        await dispatchLog(guild, { category: 'voice', cardPayload: card });
      }
      // Move
      else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        const card = buildLogCard({
          eventName: 'Voice Channel Switched',
          emoji: '🔄',
          category: 'voice',
          user,
          targetId: user.id,
          details: [
            format.kvLine('From', format.channelMention(oldState.channelId)),
            format.kvLine('To', format.channelMention(newState.channelId))
          ]
        });
        await dispatchLog(guild, { category: 'voice', cardPayload: card });
      }
    } catch (err) {
      logger.debug({ err }, 'Error in voiceStateUpdate logger');
    }
  });

  // 12. Invite Created & Deleted
  client.on('inviteCreate', async (invite) => {
    try {
      if (!invite.guild) return;
      const card = buildLogCard({
        eventName: 'Invite Created',
        emoji: '🔗',
        category: 'server',
        user: invite.inviter,
        channel: invite.channel,
        targetId: invite.code,
        details: [
          format.kvLine('Invite Code', format.code(invite.code)),
          format.kvLine('Max Uses', `${invite.maxUses || 'Unlimited'}`),
          format.kvLine('Expires', invite.expiresAt ? format.timeLongAndRelative(invite.expiresAt) : 'Never')
        ]
      });
      await dispatchLog(invite.guild, { category: 'server', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in inviteCreate logger');
    }
  });

  client.on('inviteDelete', async (invite) => {
    try {
      if (!invite.guild) return;
      const card = buildLogCard({
        eventName: 'Invite Deleted',
        emoji: '🗑️',
        category: 'server',
        targetId: invite.code,
        details: [
          format.kvLine('Invite Code', format.code(invite.code))
        ]
      });
      await dispatchLog(invite.guild, { category: 'server', cardPayload: card });
    } catch (err) {
      logger.debug({ err }, 'Error in inviteDelete logger');
    }
  });
}

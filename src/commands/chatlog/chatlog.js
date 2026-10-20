import { PermissionFlagsBits } from 'discord.js';
import { renderChatlogPanel } from '../../modules/chatlog/panel.js';

export default {
  name: 'chatlog',
  description: 'Open the centralized encrypted channel chatlog vault panel',
  category: 'chatlog',
  permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild],
  botPermissions: [PermissionFlagsBits.ManageWebhooks],
  cooldown: 3,
  args: [],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.replyError('Chatlog commands must be executed within a Discord server.', 'Run this in a server.');
    }

    const payload = await renderChatlogPanel({ guild: ctx.guild, channel: ctx.channel });
    return ctx.reply(payload);
  }
};

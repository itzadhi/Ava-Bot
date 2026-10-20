import { PermissionFlagsBits } from 'discord.js';
import { renderModulePanelById } from '../../modules/panel/index.js';

export default {
  name: 'logs',
  aliases: ['log', 'logging'],
  description: 'Open the server event logging and channel routing panel',
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  args: [],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.replyError('Logging can only be configured in a server.', 'Run this command in a server.');
    }
    const payload = await renderModulePanelById('logs', ctx.guild);
    return ctx.reply(payload);
  }
};

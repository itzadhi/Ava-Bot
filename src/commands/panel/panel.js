import { PermissionFlagsBits } from 'discord.js';
import { startDashboardSession } from '../../modules/panel/index.js';

export default {
  name: 'panel',
  aliases: ['dash', 'dashboard', 'control'],
  description: 'Open the central Argoni Control Dashboard for all server modules',
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  args: [
    {
      name: 'module',
      description: 'Quickly open a specific module panel (e.g. automod, logs, autorole)',
      type: 'string',
      required: false
    }
  ],
  async execute(ctx) {
    return startDashboardSession(ctx);
  }
};

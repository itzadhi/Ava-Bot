import { PermissionFlagsBits } from 'discord.js';
import { renderStaffPanel } from '../../modules/staff/panel.js';

export default {
  name: 'setting',
  aliases: ['settings'],
  description: 'Open the centralized server settings and staff control panel',
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 2,
  args: [
    {
      name: 'tab',
      description: 'Choose panel tab (settings, suggestions, feedback, voice)',
      type: 'choice',
      choices: ['settings', 'suggestions', 'feedback', 'voice'],
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.replyError('Settings can only be managed inside a Discord server.', 'Run this command in a server.');
    }

    const tabAliasMap = {
      settings: 'settings',
      suggestions: 'sug',
      sug: 'sug',
      feedback: 'fbk',
      fbk: 'fbk',
      voice: 'voice',
      staff: 'sug'
    };

    const chosenTab = tabAliasMap[ctx.args.tab || ctx.args.view] || 'settings';
    const payload = await renderStaffPanel({ guild: ctx.guild, activeTab: chosenTab });
    return ctx.reply(payload);
  }
};


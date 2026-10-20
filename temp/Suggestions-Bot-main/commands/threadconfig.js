// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /threadconfig Command
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { handleThreadConfig } from '../utils/commandLogic.js';

export const data = new SlashCommandBuilder()
  .setName('threadconfig')
  .setDescription('Configure thread settings for suggestions')
  .addIntegerOption(option =>
    option
      .setName('slowmode')
      .setDescription('Slowmode in seconds for suggestion threads (0 = disabled, max 21600)')
      .setMinValue(0)
      .setMaxValue(21600),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return await interaction.editReply({ content: 'You need the **Manage Server** permission to use this command.' });
    }

    const slowmode = interaction.options.getInteger('slowmode') ?? undefined;
    const result = await handleThreadConfig(interaction.guildId, slowmode);

    if (result.error) {
      return await interaction.editReply({ content: result.error });
    }

    await interaction.editReply({ content: result.success ?? result.info });
  } catch (error) {
    console.error('[threadconfig] Error:', error);
    const content = 'An error occurred while configuring thread settings.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// Prefix: !threadconfig [seconds]
export const prefixExecute = async (message, args) => {
  try {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return await message.reply('You need the **Manage Server** permission to use this command.');
    }

    const slowmode = args[0] !== undefined ? parseInt(args[0], 10) : undefined;
    if (slowmode !== undefined && isNaN(slowmode)) {
      return await message.reply('Please provide a valid number of seconds (0–21600).');
    }

    const result = await handleThreadConfig(message.guildId, slowmode);

    if (result.error) {
      return await message.reply(result.error);
    }

    await message.reply(result.success ?? result.info);
  } catch (error) {
    console.error('[threadconfig prefix] Error:', error);
    await message.reply('An error occurred while configuring thread settings.').catch(() => null);
  }
};

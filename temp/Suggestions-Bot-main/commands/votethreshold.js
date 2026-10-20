// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /votethreshold Command
// Made by ayliee, Aerox Development
//
// Sets how many upvotes a suggestion needs before it is
// forwarded to the logs channel as a "Potential Content Idea".
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { handleSetThreshold } from '../utils/commandLogic.js';
import { readDb, getGuild } from '../utils/db.js';

export const data = new SlashCommandBuilder()
  .setName('votethreshold')
  .setDescription('Set how many upvotes a suggestion needs to be sent to the logs channel')
  .addIntegerOption(option =>
    option
      .setName('votes')
      .setDescription('Number of upvotes required (minimum 1)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(9999),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return await interaction.editReply({ content: 'You need the **Manage Server** permission to use this command.' });
    }

    // Surface current settings alongside the update
    const db = readDb();
    const guildData = getGuild(db, interaction.guildId);
    const logsSet = !!guildData.logsChannelId;

    const threshold = interaction.options.getInteger('votes', true);
    const result = await handleSetThreshold(interaction.guildId, threshold);

    if (result.error) return await interaction.editReply({ content: result.error });

    const warning = !logsSet
      ? '\n\n> **Note:** No logs channel is set yet. Use `/setlogs` to configure one.'
      : '';

    await interaction.editReply({ content: result.success + warning });
  } catch (error) {
    console.error('[votethreshold] Error:', error);
    const content = 'An error occurred while setting the vote threshold.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

export const prefixExecute = async (message, args) => {
  try {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return await message.reply('You need the **Manage Server** permission to use this command.');
    }

    const threshold = parseInt(args[0], 10);
    if (!args[0] || isNaN(threshold) || threshold < 1) {
      return await message.reply('Please provide a valid number (≥ 1). Usage: `!votethreshold 10`');
    }

    const result = await handleSetThreshold(message.guildId, threshold);
    if (result.error) return await message.reply(result.error);
    await message.reply(result.success);
  } catch (error) {
    console.error('[votethreshold prefix] Error:', error);
    await message.reply('An error occurred while setting the vote threshold.').catch(() => null);
  }
};

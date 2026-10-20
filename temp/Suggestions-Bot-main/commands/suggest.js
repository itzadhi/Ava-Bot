// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /suggest Command
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { handleSuggest } from '../utils/commandLogic.js';

export const data = new SlashCommandBuilder()
  .setName('suggest')
  .setDescription('Submit a new suggestion to the server')
  .addStringOption(option =>
    option
      .setName('text')
      .setDescription('Your suggestion')
      .setRequired(true)
      .setMaxLength(1500),
  );

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const text = interaction.options.getString('text', true);
    const result = await handleSuggest(
      interaction.guildId,
      interaction.user,
      text,
      interaction.client,
    );

    if (result.error) {
      return await interaction.editReply({ content: result.error });
    }

    await interaction.editReply({ content: result.success });
  } catch (error) {
    console.error('[suggest] Error:', error);
    const content = 'An error occurred while processing your suggestion.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// Prefix command handler: !suggest <text>
export const prefixExecute = async (message, args) => {
  try {
    const text = args.join(' ').trim();
    if (!text) {
      return await message.reply('Please provide suggestion text. Usage: `!suggest <your suggestion>`');
    }

    // Clean up the trigger message if the bot has permission
    if (message.channel.permissionsFor(message.client.user)?.has(PermissionFlagsBits.ManageMessages)) {
      await message.delete().catch(() => null);
    }

    const result = await handleSuggest(message.guildId, message.author, text, message.client);

    if (result.error) {
      return await message.channel.send(`${message.author}, ${result.error}`);
    }

    await message.channel.send(`${message.author}, ${result.success}`);
  } catch (error) {
    console.error('[suggest prefix] Error:', error);
    await message.reply('An error occurred while processing your suggestion.').catch(() => null);
  }
};

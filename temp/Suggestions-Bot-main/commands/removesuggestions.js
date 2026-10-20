// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /removesuggestions Command
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { handleRemoveSuggestions } from '../utils/commandLogic.js';

export const data = new SlashCommandBuilder()
  .setName('removesuggestions')
  .setDescription('Remove the configured suggestion channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return await interaction.editReply({ content: 'You need the **Manage Server** permission to use this command.' });
    }

    const result = await handleRemoveSuggestions(interaction.guildId);

    if (result.error) {
      return await interaction.editReply({ content: result.error });
    }

    await interaction.editReply({ content: result.success });
  } catch (error) {
    console.error('[removesuggestions] Error:', error);
    const content = 'An error occurred while removing the suggestion channel.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// Prefix: !removesuggestions
export const prefixExecute = async (message) => {
  try {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return await message.reply('You need the **Manage Server** permission to use this command.');
    }

    const result = await handleRemoveSuggestions(message.guildId);

    if (result.error) {
      return await message.reply(result.error);
    }

    await message.reply(result.success);
  } catch (error) {
    console.error('[removesuggestions prefix] Error:', error);
    await message.reply('An error occurred while removing the suggestion channel.').catch(() => null);
  }
};

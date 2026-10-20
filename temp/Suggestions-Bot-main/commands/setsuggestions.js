// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /setsuggestions Command
// Made by ayliee, Aerox Development
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { handleSetSuggestions } from '../utils/commandLogic.js';

export const data = new SlashCommandBuilder()
  .setName('setsuggestions')
  .setDescription('Set the channel where suggestions will be posted')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('The channel to post suggestions in')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return await interaction.editReply({ content: 'You need the **Manage Server** permission to use this command.' });
    }

    const channel = interaction.options.getChannel('channel', true);
    const result = await handleSetSuggestions(interaction.guildId, channel.id, interaction.client);

    if (result.error) {
      return await interaction.editReply({ content: result.error });
    }

    await interaction.editReply({ content: result.success });
  } catch (error) {
    console.error('[setsuggestions] Error:', error);
    const content = 'An error occurred while setting the suggestion channel.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// Prefix: !setsuggestions #channel
export const prefixExecute = async (message, args) => {
  try {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return await message.reply('You need the **Manage Server** permission to use this command.');
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
      return await message.reply('Please mention a channel. Usage: `!setsuggestions #channel`');
    }

    const result = await handleSetSuggestions(message.guildId, channel.id, message.client);

    if (result.error) {
      return await message.reply(result.error);
    }

    await message.reply(result.success);
  } catch (error) {
    console.error('[setsuggestions prefix] Error:', error);
    await message.reply('An error occurred while setting the suggestion channel.').catch(() => null);
  }
};

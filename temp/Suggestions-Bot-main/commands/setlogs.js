// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /setlogs Command
// Made by ayliee, Aerox Development
//
// Sets the channel where high-vote suggestions are forwarded
// as "Potential Content Ideas".
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } from 'discord.js';
import { handleSetLogs } from '../utils/commandLogic.js';

export const data = new SlashCommandBuilder()
  .setName('setlogs')
  .setDescription('Set the channel where high-vote suggestions are forwarded as potential ideas')
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('The logs channel')
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
    const result = await handleSetLogs(interaction.guildId, channel.id, interaction.client);

    if (result.error) return await interaction.editReply({ content: result.error });
    await interaction.editReply({ content: result.success });
  } catch (error) {
    console.error('[setlogs] Error:', error);
    const content = 'An error occurred while setting the logs channel.';
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

    const channel = message.mentions.channels.first();
    if (!channel) {
      return await message.reply('Please mention a channel. Usage: `!setlogs #channel`');
    }

    const result = await handleSetLogs(message.guildId, channel.id, message.client);
    if (result.error) return await message.reply(result.error);
    await message.reply(result.success);
  } catch (error) {
    console.error('[setlogs prefix] Error:', error);
    await message.reply('An error occurred while setting the logs channel.').catch(() => null);
  }
};

// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /moderate Command
// Made by ayliee, Aerox Development
//
// Allows moderators to approve, deny, or mark suggestions as
// under consideration. Updates the suggestion message in-place.
// ──────────────────────────────────────────────────────────────

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { handleModerate } from '../utils/commandLogic.js';
import { readDb, getGuild } from '../utils/db.js';
import { CV2_FLAGS } from '../utils/components.js';

export const data = new SlashCommandBuilder()
  .setName('moderate')
  .setDescription('Approve, deny, or mark a suggestion as under consideration')
  .addStringOption(option =>
    option
      .setName('message_id')
      .setDescription('The ID of the suggestion message to moderate')
      .setRequired(true),
  )
  .addStringOption(option =>
    option
      .setName('status')
      .setDescription('New status for the suggestion')
      .setRequired(true)
      .addChoices(
        { name: 'Approve', value: 'approved' },
        { name: 'Deny', value: 'denied' },
        { name: 'Under Consideration', value: 'considered' },
      ),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export const execute = async (interaction) => {
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return await interaction.editReply({ content: 'You need **Manage Messages** permission to moderate suggestions.' });
    }

    const messageId = interaction.options.getString('message_id', true).trim();
    const status = interaction.options.getString('status', true);

    // Validate suggestion exists in db
    const db = readDb();
    const guildData = getGuild(db, interaction.guildId);

    if (!guildData.suggestions?.[messageId]) {
      return await interaction.editReply({
        content: `No suggestion found with message ID \`${messageId}\`.`,
      });
    }

    const moderatorTag = interaction.user.username;
    const result = await handleModerate(interaction.guildId, messageId, moderatorTag, status);

    if (result.error) {
      return await interaction.editReply({ content: result.error });
    }

    // Edit the original suggestion message in the suggestion channel
    const channel = await interaction.client.channels
      .fetch(guildData.suggestionChannelId)
      .catch(() => null);

    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit({
          components: [result.container],
          flags: CV2_FLAGS,
        }).catch(err => console.error('[moderate] Failed to edit message:', err));
      }
    }

    const labels = { approved: 'Approved', denied: 'Denied', considered: 'Marked as Under Consideration' };
    await interaction.editReply({ content: `Suggestion **${labels[status]}** successfully.` });
  } catch (error) {
    console.error('[moderate] Error:', error);
    const content = 'An error occurred while moderating the suggestion.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// ── Prefix command handler ─────────────────────────────────────
// Usage: !moderate <message_id> <approved|denied|considered>
export const prefixExecute = async (message, args) => {
  try {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return await message.reply('You need **Manage Messages** permission to moderate suggestions.');
    }

    const [messageId, status] = args;
    const validStatuses = ['approved', 'denied', 'considered'];

    if (!messageId || !status) {
      return await message.reply(
        'Usage: `!moderate <message_id> <approved|denied|considered>`',
      );
    }

    if (!validStatuses.includes(status)) {
      return await message.reply(
        `Invalid status. Use one of: \`${validStatuses.join('` · `')}\``,
      );
    }

    const db = readDb();
    const guildData = getGuild(db, message.guildId);

    if (!guildData.suggestions?.[messageId]) {
      return await message.reply(`No suggestion found with message ID \`${messageId}\`.`);
    }

    const result = await handleModerate(message.guildId, messageId, message.author.username, status);
    if (result.error) return await message.reply(result.error);

    const channel = await message.client.channels.fetch(guildData.suggestionChannelId).catch(() => null);
    if (channel) {
      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (msg) {
        await msg.edit({ components: [result.container], flags: CV2_FLAGS })
          .catch(err => console.error('[moderate prefix] Failed to edit message:', err));
      }
    }

    const labels = { approved: 'Approved', denied: 'Denied', considered: 'Marked as Under Consideration' };
    await message.reply(`Suggestion **${labels[status]}** successfully.`);
  } catch (error) {
    console.error('[moderate prefix] Error:', error);
    await message.reply('An error occurred while moderating the suggestion.').catch(() => null);
  }
};

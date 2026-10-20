// ──────────────────────────────────────────────────────────────
// Suggestion Bot — MessageCreate Event
// Made by ayliee, Aerox Development
//
// Two behaviours:
//  1. Auto-suggest: any message sent in the configured suggestion
//     channel is automatically converted into a suggestion card
//     (the original message is deleted, bot posts the styled card).
//  2. Prefix commands: messages starting with "!" in other channels.
// ──────────────────────────────────────────────────────────────

import { Events } from 'discord.js';
import { Constants } from '../utils/constants.js';
import { readDb, getGuild } from '../utils/db.js';
import { handleSuggest } from '../utils/commandLogic.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) return;

    const db = readDb();
    const guildData = getGuild(db, message.guild.id);

    // ── Auto-suggest: message posted in the suggestion channel ──
    if (
      guildData.suggestionChannelId &&
      message.channel.id === guildData.suggestionChannelId
    ) {
      const text = message.content.trim();
      if (!text) return; // Ignore empty / attachment-only messages

      // Delete the user's original message
      await message.delete().catch(() => null);

      // Post the styled suggestion card
      const result = await handleSuggest(
        message.guild.id,
        message.author,
        text,
        message.client,
      );

      if (result.error) {
        // Send a short ephemeral-style notice that self-destructs
        const notice = await message.channel.send(
          `<@${message.author.id}> ${result.error}`,
        ).catch(() => null);
        if (notice) setTimeout(() => notice.delete().catch(() => null), 7000);
      }
      return;
    }

    // ── Prefix commands (other channels) ──────────────────────
    const prefix = Constants.PREFIX;
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const commandName = args.shift()?.toLowerCase();
    if (!commandName) return;

    const command = message.client.commands?.get(commandName);
    if (!command?.prefixExecute) return;

    try {
      await command.prefixExecute(message, args);
    } catch (error) {
      console.error(`[messageCreate] Error in prefix command "${commandName}":`, error);
      await message.reply('An error occurred while executing that command.').catch(() => null);
    }
  },
};

// ──────────────────────────────────────────────────────────────
// Suggestion Bot — InteractionCreate Event
// Made by ayliee, Aerox Development
//
// Handles slash commands and vote button interactions.
// Vote button customId: "vote_up_<guildId>_<messageId>"
//                        "vote_down_<guildId>_<messageId>"
//
// Votes are one-time: already-voted presses are silently ignored.
// The suggestion message is a single ContainerBuilder (buttons inside).
// ──────────────────────────────────────────────────────────────

import { Events, MessageFlags } from 'discord.js';
import { handleVote } from '../utils/commandLogic.js';
import { CV2_FLAGS } from '../utils/components.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {

    // ── Slash Commands ──────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const command = interaction.client.commands?.get(interaction.commandName);
      if (!command) return;

      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(`[interactionCreate] Command "${interaction.commandName}" error:`, error);
        const content = 'There was an error while executing this command.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content }).catch(() => null);
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
        }
      }
      return;
    }

    // ── Vote Buttons ────────────────────────────────────────────
    if (interaction.isButton()) {
      // customId format: "vote_up_<guildId>_<messageId>"
      const parts = interaction.customId.split('_');
      if (parts.length < 4 || parts[0] !== 'vote') return;

      const direction = parts[1];   // "up" or "down"
      const guildId   = parts[2];
      const messageId = parts[3];
      const isUpvote  = direction === 'up';

      try {
        await interaction.deferUpdate();

        const result = await handleVote(
          guildId,
          messageId,
          interaction.user.id,
          isUpvote,
          interaction.client,
        );

        // Already voted — acknowledge silently, no edit needed
        if (result.alreadyVoted) return;

        if (result.error) {
          console.warn('[vote]', result.error);
          return;
        }

        // Edit the message — the container now includes updated buttons inside
        await interaction.message.edit({
          components: [result.container],
          flags: CV2_FLAGS,
        });
      } catch (error) {
        console.error('[interactionCreate] Vote button error:', error);
      }
      return;
    }
  },
};

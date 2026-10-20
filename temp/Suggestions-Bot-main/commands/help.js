// ──────────────────────────────────────────────────────────────
// Suggestion Bot — /help Command
// Made by ayliee, Aerox Development
//
// Displays a minimal, sleek overview of all bot commands.
// Works as both /help (slash) and !help (prefix).
// ──────────────────────────────────────────────────────────────

import {
  SlashCommandBuilder,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { CV2_FLAGS } from '../utils/components.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands');

// Build the help container using the bot\'s avatar
const buildHelpContainer = (avatarURL) =>
  new ContainerBuilder()
    // ── Header ──────────────────────────────────────────────
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Suggestion Bot\nAll commands work as both slash \`/\` and prefix \`!\``,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(avatarURL),
        ),
    )
    // ── Separator ────────────────────────────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── General ──────────────────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# GENERAL\n` +
        `**/suggest** \`<text>\` · \`!suggest <text>\`\n` +
        `→ Submit a suggestion to the server`,
      ),
    )
    // ── Separator ────────────────────────────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── Admin ────────────────────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# ADMIN · Requires Manage Server\n` +
        `**/setsuggestions** \`#channel\` · \`!setsuggestions #channel\`\n` +
        `→ Set the channel where suggestions are posted\n\n` +
        `**/removesuggestions** · \`!removesuggestions\`\n` +
        `→ Remove the configured suggestion channel\n\n` +
        `**/setlogs** \`#channel\` · \`!setlogs #channel\`\n` +
        `→ Set the channel for high-vote suggestion logs\n\n` +
        `**/votethreshold** \`<n>\` · \`!votethreshold <n>\`\n` +
        `→ Upvotes needed to forward a suggestion to logs\n\n` +
        `**/threadconfig** \`<seconds>\` · \`!threadconfig <seconds>\`\n` +
        `→ Set slowmode on suggestion discussion threads`,
      ),
    )
    // ── Separator ────────────────────────────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── Moderation ───────────────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# MODERATION · Requires Manage Messages\n` +
        `**/moderate** \`<message_id>\` \`<status>\` · \`!moderate <id> <status>\`\n` +
        `→ Approve, deny, or consider a suggestion\n` +
        `Status: \`approved\` · \`denied\` · \`considered\``,
      ),
    )
    // ── Separator ────────────────────────────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── Help itself ──────────────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `-# HELP\n` +
        `**/help** · \`!help\`  — Show this menu`,
      ),
    );

// ── Slash command handler ──────────────────────────────────────
export const execute = async (interaction) => {
  try {
    const avatarURL = interaction.client.user.displayAvatarURL({ size: 128 });
    await interaction.reply({
      components: [buildHelpContainer(avatarURL)],
      flags: CV2_FLAGS | MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('[help] Error:', error);
    const content = 'An error occurred while showing the help menu.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => null);
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
};

// ── Prefix command handler ─────────────────────────────────────
export const prefixExecute = async (message) => {
  try {
    const avatarURL = message.client.user.displayAvatarURL({ size: 128 });
    await message.channel.send({
      components: [buildHelpContainer(avatarURL)],
      flags: CV2_FLAGS,
    });
  } catch (error) {
    console.error('[help prefix] Error:', error);
    await message.reply('An error occurred while showing the help menu.').catch(() => null);
  }
};

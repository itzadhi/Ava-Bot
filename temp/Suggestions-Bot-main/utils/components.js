// ──────────────────────────────────────────────────────────────
// Suggestion Bot — Components v2 Builders
// Made by ayliee, Aerox Development
//
// Card layout (all inside one ContainerBuilder):
//   [Section: "New Suggestion" + quoted text | avatar thumbnail]
//   [Text: Suggested by / Date (Discord timestamp) / User ID]
//   [Separator]          ← before "Cast Your Vote"
//   [Text: "📊 Cast Your Vote"]
//   [Text: "What do you think... Vote below!"]
//   [Separator]          ← before vote buttons
//   [ActionRow: 👍 Yes (n) | 👎 No (n)]   ← inside the container
// ──────────────────────────────────────────────────────────────

import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';

// Convert a Date to a Discord timestamp string (<t:UNIX:F>)
// :F = full date + time, e.g. "Thursday, March 26, 2026 6:12 PM"
const discordTimestamp = (date = new Date()) =>
  `<t:${Math.floor(date.getTime() / 1000)}:F>`;

// ── Internal: build the vote ActionRow ────────────────────────
const voteRow = (guildId, messageId, upCount, downCount) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vote_up_${guildId}_${messageId}`)
      .setLabel(`👍 Yes (${upCount})`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`vote_down_${guildId}_${messageId}`)
      .setLabel(`👎 No (${downCount})`)
      .setStyle(ButtonStyle.Danger),
  );

// ── Main suggestion card ───────────────────────────────────────
// Vote buttons live INSIDE the container.
// Pass guildId + messageId so the buttons carry the right customId.
export const buildSuggestionContainer = ({
  authorUsername,
  authorId,
  authorAvatarURL,
  text,
  upCount = 0,
  downCount = 0,
  createdAt = new Date(),
  guildId,
  messageId,
}) =>
  new ContainerBuilder()
    // ── Header: title + quoted suggestion + avatar thumbnail ──
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## New Suggestion\n\n**"${text}"**`),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(authorAvatarURL),
        ),
    )
    // ── Author info with Discord timestamp ───────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Suggested by:** ${authorUsername}\n**Date:** ${discordTimestamp(createdAt)}\n**User ID:** ${authorId}`,
      ),
    )
    // ── Separator before "Cast Your Vote" ────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── Cast Your Vote header ────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`📊 **Cast Your Vote**`),
    )
    // ── Sub-prompt ───────────────────────────────────────────
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`What do you think about this suggestion? Vote below!`),
    )
    // ── Separator before vote buttons ────────────────────────
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    // ── Vote buttons inside the container ────────────────────
    .addActionRowComponents(
      voteRow(guildId, messageId, upCount, downCount),
    );

// ── Thread opening message container ─────────────────────────
export const buildThreadWelcome = () =>
  new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`Discuss your suggestion here.`),
    );

// ── Status card (after approve / deny / consider) ─────────────
export const buildStatusContainer = ({
  authorUsername,
  authorId,
  authorAvatarURL,
  text,
  status,
  moderatorTag,
  upCount = 0,
  downCount = 0,
  createdAt = new Date(),
}) => {
  const statusMap = {
    approved:   `✅ **Approved** by ${moderatorTag}`,
    denied:     `❌ **Denied** by ${moderatorTag}`,
    considered: `🤔 **Under Consideration** — reviewed by ${moderatorTag}`,
  };

  return new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## New Suggestion\n\n**"${text}"**`),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(authorAvatarURL),
        ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Suggested by:** ${authorUsername}\n**Date:** ${discordTimestamp(createdAt)}\n**User ID:** ${authorId}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Status:** ${statusMap[status] ?? '⏳ Pending'}\n📊 Upvotes: **${upCount}**  •  Downvotes: **${downCount}**`,
      ),
    );
};

// ── Logs channel entry (sent when threshold is crossed) ────────
export const buildLogEntry = ({
  authorUsername,
  authorId,
  authorAvatarURL,
  text,
  upCount = 0,
  downCount = 0,
  threshold,
  createdAt = new Date(),
}) =>
  new ContainerBuilder()
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `## Potential Content Idea\n\n**"${text}"**`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(authorAvatarURL),
        ),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Suggested by:** ${authorUsername}\n**Date:** ${discordTimestamp(createdAt)}\n**User ID:** ${authorId}`,
      ),
    )
    .addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `📊 **${upCount} upvotes** — threshold of **${threshold}** reached\nDownvotes: **${downCount}**`,
      ),
    );

// Discord requires IsComponentsV2 flag for container messages
export const CV2_FLAGS = MessageFlags.IsComponentsV2;

export { MessageFlags };

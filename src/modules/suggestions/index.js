import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import {
  getSuggestionById,
  createSuggestion,
  updateSuggestion,
  deleteSuggestion,
  castVote
} from '../../db/suggestions.js';
import { getGuildSettings } from '../../db/guilds.js';
import { ttsEngine } from '../voice/tts/engine.js';
import { logger } from '../../utils/logger.js';

/**
 * Maps suggestion status to human-readable badges and accent colors
 */
export const STATUS_CONFIG = {
  pending: {
    label: '⏳ Pending Review',
    color: 0x5865F2, // Blurple
    icon: '⏳'
  },
  approved: {
    label: '✅ Approved',
    color: 0x57F287, // Green
    icon: '✅'
  },
  denied: {
    label: '❌ Denied',
    color: 0xED4245, // Red
    icon: '❌'
  },
  implemented: {
    label: '🚀 Implemented',
    color: 0xEB459E, // Fuchsia
    icon: '🚀'
  }
};

/**
 * Builds the Components V2 suggestion container card
 * @param {object} params
 * @param {object} params.suggestion
 * @param {number} [params.upCount]
 * @param {number} [params.downCount]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildSuggestionCard({
  suggestion,
  upCount = suggestion.upvotes_count || 0,
  downCount = suggestion.downvotes_count || 0
}) {
  const cfg = STATUS_CONFIG[suggestion.status] || STATUS_CONFIG.pending;
  // Neutral container without embed accent color
  const container = new ContainerBuilder();
  const suggestionId = suggestion.id;

  const authorName = suggestion.author_username || 'Anonymous';
  const authorAvatar = suggestion.author_avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const thumbnailUrl = suggestion.image_url || authorAvatar;

  const isPending = suggestion.status === 'pending';
  const statusPrompt = isPending ? 'Cast Your Vote Below!' : `Status: ${cfg.label}`;

  const cleanText = (suggestion.text || '').trim();
  const quoted = cleanText.split('\n').map(l => `> ${l}`).join('\n');

  // Exact format matching the screenshot reference:
  // **Suggested by sloth.xx**
  // > build ai free
  // Cast Your Vote Below!
  const content = `**Suggested by ${authorName}**\n\n${quoted}\n\n${statusPrompt}`;

  const section = new SectionBuilder();
  section.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  if (thumbnailUrl) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
  }

  container.addSectionComponents(section);

  // Voting Buttons: Support (0) | Oppose (0)
  const voteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:sug:up:${suggestionId}`)
      .setLabel(`Support (${upCount})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPending),
    new ButtonBuilder()
      .setCustomId(`fb:sug:down:${suggestionId}`)
      .setLabel(`Oppose (${downCount})`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!isPending)
  );

  container.addActionRowComponents(voteRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Handles member casting, switching, or removing a vote on a suggestion
 */
export async function handleSuggestionVote(interaction, suggestionId, voteType) {
  // Acknowledge immediately within 3s window
  await interaction.deferUpdate().catch(() => {});

  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) {
    return interaction.followUp({
      content: '❌ Suggestion not found or has been deleted.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (suggestion.status !== 'pending') {
    return interaction.followUp({
      content: '⚠️ Voting is closed on this suggestion as it has already been moderated.',
      flags: MessageFlags.Ephemeral
    });
  }

  const { action, upvotes, downvotes, currentVote } = await castVote(
    suggestionId,
    interaction.guildId,
    interaction.user.id,
    voteType
  );

  const updatedSug = { ...suggestion, upvotes_count: upvotes, downvotes_count: downvotes };
  const cardPayload = buildSuggestionCard({
    suggestion: updatedSug,
    upCount: upvotes,
    downCount: downvotes
  });

  // Edit original message in-place
  await interaction.message.edit(cardPayload).catch(() => {});

  let feedbackMsg = '';
  if (action === 'added') feedbackMsg = `👍 You voted **${voteType === 'up' ? 'Yes' : 'No'}** on this suggestion.`;
  else if (action === 'switched') feedbackMsg = `🔄 Switched your vote to **${voteType === 'up' ? 'Yes' : 'No'}**.`;
  else if (action === 'removed') feedbackMsg = `↩️ Removed your vote from this suggestion.`;

  return interaction.followUp({
    content: feedbackMsg,
    flags: MessageFlags.Ephemeral
  });
}

/**
 * Handles staff moderation of a suggestion (Approve, Deny, Implemented, Delete)
 */
export async function handleSuggestionModeration(interaction, suggestionId, action) {
  // Check staff authorization
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need the configured Staff role or Manage Server permission to moderate suggestions.',
      flags: MessageFlags.Ephemeral
    });
  }

  const suggestion = await getSuggestionById(suggestionId);
  if (!suggestion) {
    return interaction.reply({
      content: '❌ Suggestion not found or has already been deleted.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'del') {
    await interaction.deferUpdate().catch(() => {});
    await deleteSuggestion(suggestionId);
    await interaction.message.delete().catch(() => {});
    return interaction.followUp({
      content: `🗑️ Suggestion \`${suggestionId}\` has been deleted by <@${interaction.user.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate().catch(() => {});

  const statusMap = {
    approve: 'approved',
    deny: 'denied',
    implement: 'implemented'
  };

  const newStatus = statusMap[action];
  if (!newStatus) return;

  const updated = await updateSuggestion(suggestionId, {
    status: newStatus,
    moderator_id: interaction.user.id,
    moderator_tag: interaction.user.tag
  });

  const cardPayload = buildSuggestionCard({
    suggestion: updated,
    upCount: updated.upvotes_count,
    downCount: updated.downvotes_count
  });

  await interaction.message.edit(cardPayload).catch(() => {});

  // Trigger TTS announcement if approved or implemented
  if (newStatus === 'approved' || newStatus === 'implemented') {
    const speechText = newStatus === 'approved'
      ? 'Your suggestion was approved.'
      : 'Your suggestion was marked as implemented.';

    await ttsEngine.queueAnnouncement(interaction.guild, suggestion.author_id, speechText);
  }

  return interaction.followUp({
    content: `✅ Suggestion marked as **${STATUS_CONFIG[newStatus].label}** by <@${interaction.user.id}>.`,
    flags: MessageFlags.Ephemeral
  });
}

/**
 * Verifies if an interacting user is considered staff
 */
export async function checkStaffPermission(interaction) {
  if (!interaction.member) return false;
  if (interaction.member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;

  const guildSettings = await getGuildSettings(interaction.guildId);
  if (guildSettings?.staff_role_id) {
    return interaction.member.roles?.cache?.has(guildSettings.staff_role_id) ?? false;
  }
  return false;
}

// Cooldown map: `${guildId}:${userId}` -> timestamp
const suggestionCooldowns = new Map();

export function checkSuggestionCooldown(guildId, userId, cooldownSec = 60) {
  if (cooldownSec <= 0) return { onCooldown: false, remaining: 0 };
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const last = suggestionCooldowns.get(key) || 0;
  if (now - last < cooldownSec * 1000) {
    const remaining = Math.ceil((last + cooldownSec * 1000 - now) / 1000);
    return { onCooldown: true, remaining };
  }
  return { onCooldown: false, remaining: 0 };
}

export function setSuggestionCooldown(guildId, userId) {
  const key = `${guildId}:${userId}`;
  suggestionCooldowns.set(key, Date.now());
}

/**
 * Creates suggestion record, posts V2 container card, and starts a public discussion thread
 */
export async function postSuggestionMessage({
  guild,
  channel,
  author,
  text,
  imageUrl = null
}) {
  const guildSettings = await getGuildSettings(guild.id);
  const avatarURL = typeof author.displayAvatarURL === 'function'
    ? author.displayAvatarURL({ size: 128 })
    : (author.displayAvatarURL || author.defaultAvatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png');

  // Detect image URL from text if not explicitly supplied
  let resolvedImageUrl = imageUrl;
  let suggestionText = typeof text === 'string' ? text.trim() : '';
  if (!resolvedImageUrl && suggestionText) {
    const urlMatch = suggestionText.match(/https?:\/\/\S+\.(?:png|jpe?g|webp|gif)(\?\S*)?/i);
    if (urlMatch) {
      resolvedImageUrl = urlMatch[0];
      suggestionText = suggestionText.replace(urlMatch[0], '').trim();
    }
  }
  if (!suggestionText && resolvedImageUrl) {
    suggestionText = 'Attached image suggestion';
  }

  // 1. Persist suggestion
  const suggestion = await createSuggestion({
    guildId: guild.id,
    channelId: channel.id,
    authorId: author.id,
    authorUsername: author.tag || author.username,
    authorAvatar: avatarURL,
    imageUrl: resolvedImageUrl,
    text: suggestionText
  });

  // 2. Post V2 card
  const cardPayload = buildSuggestionCard({ suggestion });
  const post = await channel.send(cardPayload);

  // 3. Update DB record with message ID
  await updateSuggestion(suggestion.id, { message_id: post.id });

  // 4. Start Discussion Thread (matches reference naming: {author} - Suggestion)
  let thread = null;
  const threadEnabled = guildSettings?.suggestion_thread_enabled !== false;
  const me = guild.members.me || guild.client.user;
  if (threadEnabled && channel.permissionsFor?.(me)?.has(PermissionFlagsBits.CreatePublicThreads)) {
    try {
      const authorBase = author.username || author.tag || 'Member';
      const threadName = `${authorBase} - Suggestion`;

      thread = await post.startThread({
        name: threadName,
        autoArchiveDuration: 1440,
        rateLimitPerUser: guildSettings?.suggestion_thread_slowmode || 0,
        reason: `Discussion thread for suggestion #${suggestion.id}`
      }).catch(err => {
        logger.warn({ err }, 'Could not start suggestion thread');
        return null;
      });

      if (thread) {
        const welcomeContainer = new ContainerBuilder();
        welcomeContainer.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `### 💬 Suggestion Discussion\n` +
            `Discuss this suggestion by <@${author.id}> below! Keep comments constructive.\n` +
            `- Cast your vote on the original suggestion card above using the **👍** or **👎** buttons.`
          )
        );
        await thread.send({
          components: [welcomeContainer],
          flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, suggestionId: suggestion.id }, 'Could not create suggestion discussion thread');
    }
  }

  setSuggestionCooldown(guild.id, author.id);

  return { suggestion, post, thread };
}

/**
 * Handles raw messages sent into the configured suggestions channel
 */
export async function handleAutoSuggest(message) {
  if (message.author?.bot || !message.guild) return false;

  const guildSettings = await getGuildSettings(message.guild.id);
  if (guildSettings?.suggestions_enabled === false) return false;

  // Channel Matching:
  // 1. Explicitly configured suggestion_channel_id
  // 2. Auto-detect if not yet set and channel name contains 'suggest' (e.g. #suggestions, #suggestion)
  let isSuggestionChannel = false;
  if (guildSettings?.suggestion_channel_id) {
    isSuggestionChannel = guildSettings.suggestion_channel_id === message.channel.id;
  } else if (message.channel?.name && /suggest/i.test(message.channel.name)) {
    isSuggestionChannel = true;
    await updateGuildSettings(message.guild.id, { suggestion_channel_id: message.channel.id }).catch(() => {});
  }

  if (!isSuggestionChannel) {
    return false;
  }

  // If message begins with a bot command prefix or slash, do not intercept as auto-suggestion
  const content = message.content?.trim();
  const guildPrefix = guildSettings?.prefix || 'a!';
  if (content && (content.startsWith(guildPrefix) || content.startsWith('ao!') || content.startsWith('/'))) {
    return false;
  }

  // Extract text and attachments
  let text = content || '';
  let attachedImageUrl = null;
  if (message.attachments?.size > 0) {
    const firstImg = message.attachments.find(att =>
      att.contentType?.startsWith('image/') || /\.(?:png|jpe?g|webp|gif)(\?\S*)?$/i.test(att.url)
    );
    if (firstImg) {
      attachedImageUrl = firstImg.url;
    }
    const nonImgUrls = message.attachments
      .filter(att => att.url !== attachedImageUrl)
      .map(att => att.url)
      .join('\n');
    if (nonImgUrls) {
      text = text ? `${text}\n${nonImgUrls}` : nonImgUrls;
    }
  }

  if (!text && !attachedImageUrl) {
    return false;
  }

  // Delete user's raw message immediately
  await message.delete().catch(() => {});

  // Cooldown check: staff/admins bypass cooldown completely
  const isStaff = await checkStaffPermission({ member: message.member, guildId: message.guild.id }).catch(() => false);
  const cooldownSec = guildSettings?.suggestion_cooldown ?? 0;
  if (!isStaff && cooldownSec > 0) {
    const { onCooldown, remaining } = checkSuggestionCooldown(message.guild.id, message.author.id, cooldownSec);
    if (onCooldown) {
      const notice = await message.channel.send(
        `⏱️ <@${message.author.id}>, please wait **${remaining}s** before submitting another suggestion.`
      ).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 5000);
      return true;
    }
  }

  // Truncate to safe Discord message length if excessive
  if (text.length > 2000) {
    text = text.slice(0, 1997) + '...';
  }

  // Post styled card and create thread
  try {
    await postSuggestionMessage({
      guild: message.guild,
      channel: message.channel,
      author: message.author,
      text,
      imageUrl: attachedImageUrl
    });
  } catch (err) {
    logger.error({ err }, 'Error auto-posting suggestion from channel message');
  }

  return true;
}


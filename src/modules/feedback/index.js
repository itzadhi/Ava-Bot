import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import {
  getFeedbackById,
  createFeedback,
  updateFeedback,
  deleteFeedback
} from '../../db/feedback.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { checkStaffPermission } from '../suggestions/index.js';
import * as format from '../../utils/ui/format.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { logger } from '../../utils/logger.js';

// Map storing pending screenshot uploads: userId -> { guildId, targetChannelId, ratingNum, review, suggestion, timeout, editFn }
export const pendingFeedbackImages = new Map();

/**
 * Builds star rating string exactly like in temp (⭐ and ☆)
 */
export function buildStars(rating) {
  if (rating === null || rating === undefined || rating === '') return 'Not Rated';
  const n = Math.min(Math.max(parseInt(rating, 10) || 0, 0), 5);
  const filled = '⭐';
  const empty = '☆';
  return filled.repeat(n) + (n < 5 ? empty.repeat(5 - n) : '');
}

/**
 * Returns human-readable sentiment label for star ratings
 */
export function getRatingSentiment(rating) {
  const n = parseInt(rating, 10);
  switch (n) {
    case 5: return 'Exceptional';
    case 4: return 'Very Good';
    case 3: return 'Average / Fair';
    case 2: return 'Needs Improvement';
    case 1: return 'Critical / Poor';
    default: return 'Community Review';
  }
}

/**
 * Builds the Feedback Submission Modal with rating, review, and optional screenshot URL
 */
export function buildFeedbackModal(contextStr = '0') {
  const modal = new ModalBuilder()
    .setCustomId(`fb:fbk:modal:${contextStr}`)
    .setTitle('Submit a Review');

  const ratingInput = new TextInputBuilder()
    .setCustomId('rating')
    .setLabel('Rate our service / server (1–5) *')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('5')
    .setValue('5')
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(1);

  const reviewInput = new TextInputBuilder()
    .setCustomId('review')
    .setLabel('Your feedback & experience *')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Tell us about your experience, what went well, or what needs work...')
    .setRequired(true)
    .setMinLength(2)
    .setMaxLength(2000);

  const imageInput = new TextInputBuilder()
    .setCustomId('image_url')
    .setLabel('Screenshot / Image URL (optional)')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('https://... (or leave blank)')
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(ratingInput),
    new ActionRowBuilder().addComponents(reviewInput),
    new ActionRowBuilder().addComponents(imageInput)
  );

  return modal;
}

/**
 * Builds the Feedback Reply Modal for staff members
 */
export function buildFeedbackReplyModal(feedbackId) {
  const modal = new ModalBuilder()
    .setCustomId(`fb:fbk:reply_mod:${feedbackId}`)
    .setTitle('Reply to User Feedback');

  const replyInput = new TextInputBuilder()
    .setCustomId('reply_text')
    .setLabel('Staff Response (Direct Messaged to User)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Write your reply to the user here...')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(replyInput));
  return modal;
}

/**
 * Builds the Components V2 Feedback container card matching the reference feedback layout
 * @param {object} params
 */
export function buildFeedbackCard(params) {
  const rating = params.rating !== undefined && params.rating !== null ? parseInt(params.rating, 10) : 5;
  const review = params.review || params.message || '';
  const reply = params.reply || null;
  const repliedBy = params.replied_by || null;
  const imageUrl = params.imageUrl || params.image_url || null;

  let username = 'User';
  let avatarURL = 'https://cdn.discordapp.com/embed/avatars/0.png';

  if (params.user) {
    username = params.user.username || params.user.tag || 'User';
    avatarURL = typeof params.user.displayAvatarURL === 'function'
      ? params.user.displayAvatarURL({ size: 256, extension: 'png' })
      : (params.user.avatarURL || avatarURL);
  } else {
    username = params.author_username || 'User';
    avatarURL = params.author_avatar || avatarURL;
  }

  const stars = buildStars(rating);

  // Clean container matching reference screenshot (NO accent/sidebar color)
  const c = new ContainerBuilder();

  // Header & Content Section with Thumbnail
  const activeThumbnail = imageUrl || avatarURL;
  const bodyText = `### Feedback by ${format.escapeMarkdown(username)}\n\n> ${format.escapeMarkdown(review).replace(/\n/g, '\n> ')}\n\n**Rating**\n${stars}`;

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText));

  if (activeThumbnail) {
    try {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(activeThumbnail));
    } catch (_) {}
  }

  c.addSectionComponents(section);

  // Staff Reply Section (if any)
  if (reply) {
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 💬 Staff Response\n> ${format.escapeMarkdown(reply).replace(/\n/g, '\n> ')}\n-# Responded by **${repliedBy || 'Staff'}**`
      )
    );
  }

  // Action Row: Submit a Review (100% grey button)
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      greyButton({
        id: 'open_feedback_modal',
        label: 'Submit a Review'
      })
    )
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Builds the public Feedback Panel matching the clean review hub layout
 */
export function buildFeedbackPanel(botAvatarURL) {
  const c = new ContainerBuilder();

  c.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# 💬 Feedback & Reviews Hub\n` +
          `Your feedback helps us continuously improve the server and our community! Share your thoughts and rate your experience.`
        )
      )
      .setThumbnailAccessory(
        new ThumbnailBuilder().setURL(botAvatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png')
      )
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      greyButton({
        id: 'open_feedback_modal',
        label: 'Submit a Review'
      })
    )
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Builds the Screenshot Prompt with step-by-step instructions
 */
export function buildImagePrompt() {
  // Neutral Container with NO sidebar color
  const c = new ContainerBuilder();

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### 📸 Optional: Attach a Screenshot or Media\n` +
      `Your review details have been recorded! Would you like to attach an image or screenshot?\n\n` +
      `• **To attach an image:** Drop or paste an image file directly in this channel right now.\n` +
      `• **To finish now:** Click **Skip — Post Now** below to publish without an image.\n\n` +
      `⏱️ *Waiting for upload... You have **60 seconds** before this prompt expires.*`
    )
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('fb:fbk:skip_img:0')
        .setLabel('Skip — Post Now')
        .setEmoji('⏩')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Handles modal submission for feedback
 */
export async function handleFeedbackModalSubmit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ratingStr = interaction.fields.getTextInputValue('rating');
  const review = interaction.fields.getTextInputValue('review');
  const imageUrl = (interaction.fields.fields?.has('image_url') ? interaction.fields.getTextInputValue('image_url') : '')?.trim() || null;

  const ratingNum = parseInt(ratingStr, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`⚠️ Rating must be a number between **1** and **5** (5 being the best).`)
    );
    return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
  }

  const guild = interaction.guild;
  if (!guild) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`⚠️ Feedback can only be submitted inside a Discord server — run \`/feedback\` inside the server.`)
    );
    return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
  }

  const guildSettings = await getGuildSettings(guild.id);
  let feedbackChannelId = guildSettings?.feedback_channel_id;
  let targetChannel = feedbackChannelId ? guild.channels.cache.get(feedbackChannelId) : null;

  // Auto-discover channel named feedback/reviews if not yet explicitly set
  if (!targetChannel) {
    const autoChan = guild.channels.cache.find(c => c.isTextBased?.() && /(feedback|review)/i.test(c.name));
    if (autoChan) {
      targetChannel = autoChan;
      feedbackChannelId = autoChan.id;
      await updateGuildSettings(guild.id, { feedback_channel_id: autoChan.id }).catch(() => {});
    }
  }

  if (!targetChannel) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `⚠️ **Feedback Channel Not Configured**\n` +
        `The feedback channel is not set up yet. An admin can configure it via \`/setting\` or create a channel named \`#feedback\`.`
      )
    );
    return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
  }

  return publishFeedbackSubmission({
    interaction,
    guild,
    targetChannel,
    ratingNum,
    review,
    imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : null
  });
}

/**
 * Handles Skip Image button click
 */
export async function handleFeedbackSkipImage(interaction) {
  const pending = pendingFeedbackImages.get(interaction.user.id);
  if (!pending) {
    return interaction.reply({
      content: '⚠️ No pending review found. Please start over with `/feedback`.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferUpdate().catch(() => {});
  clearTimeout(pending.timeout);
  pendingFeedbackImages.delete(interaction.user.id);

  const guild = interaction.guild || interaction.client.guilds.cache.get(pending.guildId);
  const targetChannel = guild?.channels.cache.get(pending.targetChannelId);

  return publishFeedbackSubmission({
    interaction,
    guild,
    targetChannel,
    ratingNum: pending.ratingNum,
    review: pending.review,
    suggestion: pending.suggestion,
    imageUrl: null
  });
}

/**
 * Intercepts dropped image attachments for pending feedback reviews
 */
export async function handleFeedbackImageUpload(message) {
  if (message.author.bot) return false;

  const pending = pendingFeedbackImages.get(message.author.id);
  if (!pending) return false;
  if (pending.channelId && message.channel.id !== pending.channelId) return false;

  const attachment = message.attachments?.find(a =>
    a.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.name || '')
  );

  if (!attachment) return false;

  clearTimeout(pending.timeout);
  pendingFeedbackImages.delete(message.author.id);
  await message.react('✅').catch(() => {});

  const guild = message.guild || message.client.guilds.cache.get(pending.guildId);
  const targetChannel = guild?.channels.cache.get(pending.targetChannelId);

  if (!targetChannel) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`⚠️ Feedback channel not found. Ask an admin to configure it in \`/setting\`.`)
    );
    await pending.editFn({ components: [err], flags: MessageFlags.IsComponentsV2 });
    return true;
  }

  // Persist and post with image
  await postFeedbackMessage({
    guild,
    channel: targetChannel,
    author: message.author,
    message: pending.review,
    suggestion: pending.suggestion,
    rating: pending.ratingNum,
    imageUrl: attachment.url
  });

  const stars = buildStars(pending.ratingNum);
  const sentiment = getRatingSentiment(pending.ratingNum);

  const success = new ContainerBuilder();
  let successText =
    `### ✅ Review & Screenshot Live!\n` +
    `Your feedback has been published in <#${targetChannel.id}> with your attached image.\n\n` +
    `⭐ **Rating:** ${stars} (**${pending.ratingNum}/5** · *${sentiment}*)\n` +
    `📝 **Review:** *" ${pending.review.length > 80 ? pending.review.slice(0, 77) + '...' : pending.review} "*\n`;

  if (pending.suggestion) {
    successText += `💡 **Suggestion:** *" ${pending.suggestion.length > 80 ? pending.suggestion.slice(0, 77) + '...' : pending.suggestion} "*\n`;
  }
  successText += `📸 **Attachment:** Image attached successfully\n\n` +
    `❤️ *Thank you for your review — it genuinely helps us improve!*`;

  success.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(successText)
  );

  await pending.editFn({ components: [success], flags: MessageFlags.IsComponentsV2 });
  return true;
}

/**
 * Publishes the feedback card to the channel and replies with the success confirmation
 */
async function publishFeedbackSubmission({
  interaction,
  guild,
  targetChannel,
  ratingNum,
  review,
  imageUrl
}) {
  if (!targetChannel) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`⚠️ Feedback channel not found. Ask an admin to configure it in \`/setting\`.`)
    );
    return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
  }

  await postFeedbackMessage({
    guild,
    channel: targetChannel,
    author: interaction.user,
    message: review,
    rating: ratingNum,
    imageUrl: imageUrl || null
  });

  const stars = buildStars(ratingNum);

  const success = new ContainerBuilder();
  let successText =
    `### ✅ Review Published!\n` +
    `Your feedback has been published in <#${targetChannel.id}>.\n\n` +
    `**Rating:** ${stars} (${ratingNum}/5)\n` +
    `> ${format.escapeMarkdown(review)}\n`;

  if (imageUrl) {
    successText += `\n📸 **Attachment:** Screenshot included\n`;
  }

  success.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(successText)
  );

  return interaction.editReply({ components: [success], flags: MessageFlags.IsComponentsV2 });
}

/**
 * Persists feedback record and sends V2 card
 */
export async function postFeedbackMessage({
  guild,
  channel,
  author,
  category = 'General',
  message,
  suggestion = null,
  rating = null,
  imageUrl = null,
  context = {}
}) {
  const avatarURL = typeof author.displayAvatarURL === 'function'
    ? author.displayAvatarURL({ size: 256, extension: 'png' })
    : (author.displayAvatarURL || author.defaultAvatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png');

  const mergedContext = {
    ...context,
    ...(suggestion ? { suggestion } : {})
  };

  const fbRecord = await createFeedback({
    guildId: guild.id,
    channelId: channel.id,
    authorId: author.id,
    authorUsername: author.tag || author.username,
    authorAvatar: avatarURL,
    category,
    message,
    rating,
    imageUrl: imageUrl || null,
    context: mergedContext
  });

  const card = buildFeedbackCard({
    id: fbRecord.id,
    rating: rating ?? 5,
    review: message,
    suggestion: suggestion || null,
    category,
    status: fbRecord.status || 'unread',
    imageUrl: imageUrl || null,
    user: author,
    created_at: fbRecord.created_at
  });

  const post = await channel.send(card);
  await updateFeedback(fbRecord.id, { message_id: post.id });

  return { feedback: fbRecord, post };
}

/**
 * Handles raw messages sent into the configured feedback channel
 */
export async function handleAutoFeedback(message) {
  if (message.author?.bot || !message.guild) return false;

  const guildSettings = await getGuildSettings(message.guild.id);
  if (guildSettings?.feedback_enabled === false) return false;

  // Channel Matching: Must be explicitly configured feedback_channel_id
  if (!guildSettings?.feedback_channel_id || guildSettings.feedback_channel_id !== message.channel.id) {
    return false;
  }

  const content = message.content?.trim();
  const guildPrefix = guildSettings?.prefix || 'a!';
  if (content && (content.startsWith(guildPrefix) || content.startsWith('ao!') || content.startsWith('/'))) {
    return false;
  }

  let text = content || '';
  let imageUrl = null;
  if (message.attachments?.size > 0) {
    const imgAtt = message.attachments.find(a =>
      a.contentType?.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(a.name || '')
    );
    if (imgAtt) imageUrl = imgAtt.url;
  }

  if (!text && !imageUrl) return false;

  // Delete raw user message
  await message.delete().catch(() => {});

  try {
    await postFeedbackMessage({
      guild: message.guild,
      channel: message.channel,
      author: message.author,
      message: text || 'Member submitted review.',
      rating: 5,
      imageUrl
    });
  } catch (err) {
    logger.error({ err }, 'Error auto-posting feedback from channel message');
  }

  return true;
}

/**
 * Dispatches staff actions from the Staff Operations Panel
 */
export async function handleFeedbackAction(interaction, feedbackId, action) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need the configured Staff role or Manage Server permission to manage feedback.',
      flags: MessageFlags.Ephemeral
    });
  }

  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) {
    return interaction.reply({
      content: '❌ Feedback not found or has already been deleted.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'del') {
    await interaction.deferUpdate().catch(() => {});
    await deleteFeedback(feedbackId);
    return interaction.followUp({
      content: `🗑️ Feedback \`${feedbackId}\` has been deleted by <@${interaction.user.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'reply') {
    const modal = buildFeedbackReplyModal(feedbackId);
    return interaction.showModal(modal);
  }

  await interaction.deferUpdate().catch(() => {});
  const newStatus = action === 'resolve' ? 'resolved' : 'read';
  await updateFeedback(feedbackId, { status: newStatus });

  return interaction.followUp({
    content: `✅ Feedback marked as **${newStatus.toUpperCase()}** by <@${interaction.user.id}>.`,
    flags: MessageFlags.Ephemeral
  });
}

/**
 * Handles submission of staff reply to user feedback
 */
export async function handleFeedbackReplySubmit(interaction, feedbackId) {
  const replyText = interaction.fields.getTextInputValue('reply_text');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const feedback = await getFeedbackById(feedbackId);
  if (!feedback) {
    return interaction.editReply({ content: '❌ Feedback record not found.' });
  }

  let dmSent = false;
  try {
    const user = await interaction.client.users.fetch(feedback.author_id);
    if (user) {
      const dmContainer = new ContainerBuilder(); // No sidebar color
      let originalMsg = `> *" ${feedback.message.replace(/\n/g, '\n> ')} "*`;
      if (feedback.context?.suggestion) {
        originalMsg += `\n\n**Your Suggestion:**\n> *" ${feedback.context.suggestion.replace(/\n/g, '\n> ')} "*`;
      }

      dmContainer.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## ✉️ Response to Your Feedback in ${interaction.guild.name}\n` +
          `The staff team has reviewed your submission:\n\n` +
          `${originalMsg}\n\n` +
          `### 💬 Staff Reply from ${interaction.user.tag}:\n` +
          `> ${replyText.replace(/\n/g, '\n> ')}\n\n` +
          `-# Thank you for helping improve our community!`
        )
      );
      await user.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 });
      dmSent = true;
    }
  } catch (err) {
    logger.warn({ err, userId: feedback.author_id }, 'Failed to DM user with feedback response');
  }

  await updateFeedback(feedbackId, {
    reply: replyText,
    replied_by: interaction.user.tag,
    status: 'read'
  });

  if (dmSent) {
    return interaction.editReply({ content: `✅ Reply successfully delivered to <@${feedback.author_id}> via Direct Message.` });
  } else {
    return interaction.editReply({
      content: `⚠️ Reply recorded, but could **not DM <@${feedback.author_id}>** because their direct messages are closed.`
    });
  }
}

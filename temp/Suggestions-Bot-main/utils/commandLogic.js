// ──────────────────────────────────────────────────────────────
// Suggestion Bot — Command Logic
// Made by ayliee, Aerox Development
//
// Vote buttons are embedded inside the suggestion container.
// Messages are sent/edited as a single component ([container]).
// Votes are one-time — no undo, no switching.
// Suggestions crossing the threshold are forwarded to logs.
// ──────────────────────────────────────────────────────────────

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { readDb, getGuild, saveGuild } from './db.js';
import {
  buildSuggestionContainer,
  buildStatusContainer,
  buildLogEntry,
  buildThreadWelcome,
  CV2_FLAGS,
} from './components.js';

// ── Core: post a suggestion to the channel ─────────────────────
export const handleSuggest = async (guildId, author, text, client) => {
  const db = readDb();
  const guildData = getGuild(db, guildId);

  if (!guildData.suggestionChannelId) {
    return { error: 'No suggestion channel has been configured. An admin must run `/setsuggestions` first.' };
  }

  const channel = await client.channels.fetch(guildData.suggestionChannelId).catch(() => null);
  if (!channel) {
    return { error: 'The configured suggestion channel no longer exists. Ask an admin to run `/setsuggestions` again.' };
  }

  const avatarURL = author.displayAvatarURL?.({ size: 128 }) ?? author.defaultAvatarURL;
  const createdAt = new Date();

  // Step 1: send with placeholder message ID so we get a real message back
  const placeholder = buildSuggestionContainer({
    authorUsername: author.username ?? author.tag,
    authorId: author.id,
    authorAvatarURL: avatarURL,
    text,
    upCount: 0,
    downCount: 0,
    createdAt,
    guildId,
    messageId: 'TEMP',
  });

  const message = await channel.send({ components: [placeholder], flags: CV2_FLAGS });

  // Step 2: edit with the real message ID so vote button customIds are correct
  const finalContainer = buildSuggestionContainer({
    authorUsername: author.username ?? author.tag,
    authorId: author.id,
    authorAvatarURL: avatarURL,
    text,
    upCount: 0,
    downCount: 0,
    createdAt,
    guildId,
    messageId: message.id,
  });

  await message.edit({ components: [finalContainer], flags: CV2_FLAGS });

  // Step 3: create discussion thread and post welcome message
  if (channel.permissionsFor(client.user)?.has(PermissionFlagsBits.CreatePublicThreads)) {
    const thread = await message.startThread({
      name: 'Suggestion Discussion',
      autoArchiveDuration: 1440,
      reason: 'New suggestion submitted',
      rateLimitPerUser: guildData.threadConfig?.slowmode ?? 0,
    }).catch(() => null);

    if (thread) {
      await thread.send({
        components: [buildThreadWelcome()],
        flags: CV2_FLAGS,
      }).catch(() => null);
    }
  }

  // Persist
  guildData.suggestions[message.id] = {
    authorId: author.id,
    authorUsername: author.username ?? author.tag,
    authorAvatarURL: avatarURL,
    text,
    status: 'pending',
    upvotes: [],
    downvotes: [],
    logged: false,
    createdAt: createdAt.toISOString(),
  };
  saveGuild(db, guildId, guildData);

  return { success: 'Your suggestion has been submitted!' };
};

// ── Handle a vote — one vote per user, permanent ───────────────
export const handleVote = async (guildId, messageId, userId, isUpvote, client) => {
  const db = readDb();
  const guildData = getGuild(db, guildId);
  const suggestion = guildData.suggestions?.[messageId];

  if (!suggestion) {
    return { error: 'Suggestion data not found — it may have been deleted.' };
  }

  // Block if user already voted on either side
  const alreadyVoted =
    suggestion.upvotes.includes(userId) || suggestion.downvotes.includes(userId);

  if (alreadyVoted) return { alreadyVoted: true };

  // Cast vote permanently
  if (isUpvote) {
    suggestion.upvotes.push(userId);
  } else {
    suggestion.downvotes.push(userId);
  }

  saveGuild(db, guildId, guildData);

  // Check threshold → forward to logs channel if reached (once only)
  const threshold = guildData.voteThreshold;
  const logsChannelId = guildData.logsChannelId;

  if (
    threshold !== null &&
    logsChannelId &&
    !suggestion.logged &&
    suggestion.upvotes.length >= threshold
  ) {
    const logsChannel = await client.channels.fetch(logsChannelId).catch(() => null);
    if (logsChannel) {
      await logsChannel.send({
        components: [buildLogEntry({
          authorUsername: suggestion.authorUsername,
          authorId: suggestion.authorId,
          authorAvatarURL: suggestion.authorAvatarURL,
          text: suggestion.text,
          upCount: suggestion.upvotes.length,
          downCount: suggestion.downvotes.length,
          threshold,
          createdAt: new Date(suggestion.createdAt),
        })],
        flags: CV2_FLAGS,
      }).catch(() => null);

      suggestion.logged = true;
      saveGuild(db, guildId, guildData);
    }
  }

  // Return rebuilt container (buttons inside, counts updated)
  return {
    container: buildSuggestionContainer({
      authorUsername: suggestion.authorUsername,
      authorId: suggestion.authorId,
      authorAvatarURL: suggestion.authorAvatarURL,
      text: suggestion.text,
      upCount: suggestion.upvotes.length,
      downCount: suggestion.downvotes.length,
      createdAt: new Date(suggestion.createdAt),
      guildId,
      messageId,
    }),
  };
};

// ── Moderate a suggestion ──────────────────────────────────────
export const handleModerate = async (guildId, messageId, moderatorTag, status) => {
  const db = readDb();
  const guildData = getGuild(db, guildId);
  const suggestion = guildData.suggestions?.[messageId];

  if (!suggestion) return { error: 'Suggestion data not found.' };

  const validStatuses = ['approved', 'denied', 'considered'];
  if (!validStatuses.includes(status)) {
    return { error: `Invalid status. Use one of: ${validStatuses.join(', ')}.` };
  }

  suggestion.status = status;
  suggestion.moderatedBy = moderatorTag;
  saveGuild(db, guildId, guildData);

  return {
    container: buildStatusContainer({
      authorUsername: suggestion.authorUsername,
      authorId: suggestion.authorId,
      authorAvatarURL: suggestion.authorAvatarURL,
      text: suggestion.text,
      status,
      moderatorTag,
      upCount: suggestion.upvotes.length,
      downCount: suggestion.downvotes.length,
      createdAt: new Date(suggestion.createdAt),
    }),
  };
};

// ── Admin: set suggestion channel ─────────────────────────────
export const handleSetSuggestions = async (guildId, channelId, client) => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return { error: 'Please provide a valid text channel.' };
  }

  const db = readDb();
  const guildData = getGuild(db, guildId);
  guildData.suggestionChannelId = channelId;
  saveGuild(db, guildId, guildData);

  return { success: `Suggestion channel set to <#${channelId}>.` };
};

// ── Admin: remove suggestion channel ──────────────────────────
export const handleRemoveSuggestions = async (guildId) => {
  const db = readDb();
  const guildData = getGuild(db, guildId);

  if (!guildData.suggestionChannelId) {
    return { error: 'No suggestion channel is currently configured.' };
  }

  guildData.suggestionChannelId = null;
  saveGuild(db, guildId, guildData);

  return { success: 'Suggestion channel removed.' };
};

// ── Admin: set logs channel ────────────────────────────────────
export const handleSetLogs = async (guildId, channelId, client) => {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return { error: 'Please provide a valid text channel.' };
  }

  const db = readDb();
  const guildData = getGuild(db, guildId);
  guildData.logsChannelId = channelId;
  saveGuild(db, guildId, guildData);

  return { success: `Logs channel set to <#${channelId}>.` };
};

// ── Admin: set vote threshold ──────────────────────────────────
export const handleSetThreshold = async (guildId, threshold) => {
  if (threshold < 1) return { error: 'Threshold must be at least 1.' };

  const db = readDb();
  const guildData = getGuild(db, guildId);
  guildData.voteThreshold = threshold;
  saveGuild(db, guildId, guildData);

  return {
    success: `Vote threshold set to **${threshold}**. Suggestions reaching ${threshold} upvotes will be forwarded to the logs channel.`,
  };
};

// ── Admin: configure thread slowmode ──────────────────────────
export const handleThreadConfig = async (guildId, slowmode) => {
  const db = readDb();
  const guildData = getGuild(db, guildId);

  if (slowmode === undefined) {
    return {
      info: `Current thread slowmode: **${guildData.threadConfig?.slowmode ?? 0}** seconds.`,
    };
  }

  if (slowmode < 0 || slowmode > 21600) {
    return { error: 'Slowmode must be between 0 and 21600 seconds.' };
  }

  if (!guildData.threadConfig) guildData.threadConfig = { slowmode: 0 };
  guildData.threadConfig.slowmode = slowmode;
  saveGuild(db, guildId, guildData);

  return { success: `Thread slowmode updated to **${slowmode}** seconds.` };
};

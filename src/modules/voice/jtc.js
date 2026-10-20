import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField
} from 'discord.js';
import {
  createTempChannel,
  getTempChannel,
  updateTempChannel,
  deleteTempChannel,
  getAllTempChannels,
  getUserVoicePrefs,
  saveUserVoicePrefs
} from '../../db/voice.js';
import { getGuildSettings } from '../../db/guilds.js';
import { buildControlCard, refreshControlMessage } from './control.js';
import { ttsEngine } from './tts/engine.js';
import { logger } from '../../utils/logger.js';

// In-flight join-creation lock to prevent race conditions from join-spamming
const creatingMembers = new Set();

// Channel deletion debounce timers: channelId -> NodeJS.Timeout
const emptyDebounceTimers = new Map();

// Member join timestamp tracker: channelId -> Map<userId, joinTimestamp>
export const voiceMembersTime = new Map();

// Channel rename history for rate limit protection: channelId -> Array<timestamp>
export const channelRenameHistory = new Map();

/**
 * Checks if a channel rename is rate limited by Discord (max 2 per 10 minutes)
 * @param {string} channelId
 * @returns {{ allowed: boolean, waitSeconds: number }}
 */
export function checkRenameRateLimit(channelId) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  let history = channelRenameHistory.get(channelId) || [];
  history = history.filter(ts => now - ts < windowMs);
  channelRenameHistory.set(channelId, history);

  if (history.length >= 2) {
    const oldest = history[0];
    const waitSeconds = Math.ceil((oldest + windowMs - now) / 1000);
    return { allowed: false, waitSeconds };
  }

  history.push(now);
  channelRenameHistory.set(channelId, history);
  return { allowed: true, waitSeconds: 0 };
}

/**
 * Handles voice state changes for Join-to-Create triggers and temp channel lifecycle
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
export async function handleVoiceStateUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildSettings = await getGuildSettings(guild.id);
  const triggerChannelId = guildSettings?.jtc_trigger_channel_id;

  // 1. MEMBER JOINED A TRIGGER CHANNEL
  if (newState.channelId && newState.channelId === triggerChannelId) {
    await handleTriggerJoin(member, guild, guildSettings);
  }

  // 2. MEMBER LEFT A CHANNEL (CHECK IF TEMPORARY CHANNEL)
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    await handleTempChannelLeave(oldState.channelId, member, guild);
  }

  // 3. MEMBER JOINED A TEMPORARY CHANNEL
  if (newState.channelId && oldState.channelId !== newState.channelId) {
    await handleTempChannelJoin(newState.channelId, member);
  }
}

/**
 * Creates and sets up a new temporary voice channel when a member enters the trigger
 */
async function handleTriggerJoin(member, guild, guildSettings) {
  if (creatingMembers.has(member.id)) return;
  creatingMembers.add(member.id);

  try {
    // Check if category is full (Discord limit: 50 channels per category)
    let parentCategory = null;
    if (guildSettings?.jtc_category_id) {
      const category = guild.channels.cache.get(guildSettings.jtc_category_id);
      if (category && category.type === ChannelType.GuildCategory) {
        const channelCount = guild.channels.cache.filter(c => c.parentId === category.id).size;
        if (channelCount < 50) {
          parentCategory = category.id;
        } else {
          logger.warn({ guildId: guild.id, categoryId: category.id }, 'JTC target category has reached 50 channels limit');
        }
      }
    }

    // Per-user defaults
    const userPrefs = await getUserVoicePrefs(member.id, guild.id);
    const template = guildSettings?.jtc_name_template || "{username}'s room";
    const username = member.displayName || member.user.username;
    const channelName = userPrefs?.preferred_name || template.replace(/\{username\}/gi, username);
    const userLimit = userPrefs?.preferred_limit !== null && userPrefs?.preferred_limit !== undefined
      ? userPrefs.preferred_limit
      : (guildSettings?.jtc_default_limit || 0);

    const maxBitrate = guild.maximumBitrate || 96000;
    const bitrate = Math.min(userPrefs?.preferred_bitrate || 64000, maxBitrate);

    // Permission overwrites: limited perms for owner, not administrator
    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.Stream,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
          PermissionFlagsBits.PrioritySpeaker,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ];

    const me = guild.members.me;
    if (me) {
      permissionOverwrites.push({
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    // Create the temporary voice channel
    const newChannel = await guild.channels.create({
      name: channelName.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: parentCategory,
      userLimit: Math.min(Math.max(userLimit, 0), 99),
      bitrate,
      permissionOverwrites,
      reason: `Argoni JTC Voice Room for ${member.user.tag}`
    });

    // Move member into the new channel
    await member.voice.setChannel(newChannel).catch(err => {
      logger.warn({ err, userId: member.id }, 'Could not automatically move member into created voice channel');
    });

    // Post control interface into the voice channel's built-in text chat
    const controlPayload = buildControlCard({
      channel: newChannel,
      ownerId: member.id,
      isLocked: false,
      isHidden: false,
      ttsEnabled: true
    });

    let controlMsg = null;
    try {
      controlMsg = await newChannel.send(controlPayload);
    } catch (err) {
      logger.warn({ err, channelId: newChannel.id }, 'Failed to post control card to voice channel chat');
    }

    // Persist to database
    await createTempChannel({
      channelId: newChannel.id,
      guildId: guild.id,
      ownerId: member.id,
      controlMessageId: controlMsg?.id || null,
      controlChannelId: newChannel.id,
      name: newChannel.name,
      userLimit: newChannel.userLimit,
      bitrate: newChannel.bitrate,
      isLocked: false,
      isHidden: false,
      ttsEnabled: true
    });

    // Initialize member join time tracking
    voiceMembersTime.set(newChannel.id, new Map([[member.id, Date.now()]]));

    logger.info({ guildId: guild.id, channelId: newChannel.id, ownerId: member.id }, 'Created temporary JTC voice channel');
  } catch (err) {
    logger.error({ err, guildId: guild.id, userId: member.id }, 'Failed to create JTC temporary voice channel');
  } finally {
    creatingMembers.delete(member.id);
  }
}

/**
 * Handles tracking and timer cancellation when a member joins a temporary channel
 */
async function handleTempChannelJoin(channelId, member) {
  const record = await getTempChannel(channelId);
  if (!record) return;

  // Cancel empty deletion debounce timer if someone joins
  if (emptyDebounceTimers.has(channelId)) {
    clearTimeout(emptyDebounceTimers.get(channelId));
    emptyDebounceTimers.delete(channelId);
  }

  // Record presence timestamp
  if (!voiceMembersTime.has(channelId)) {
    voiceMembersTime.set(channelId, new Map());
  }
  const times = voiceMembersTime.get(channelId);
  if (!times.has(member.id)) {
    times.set(member.id, Date.now());
  }

  // Update control card
  const channel = member.guild.channels.cache.get(channelId);
  if (channel) {
    await refreshControlMessage(channel);
  }
}

/**
 * Handles member leaving a temporary channel: empty debounce cleanup & ownership transfer
 */
async function handleTempChannelLeave(channelId, member, guild) {
  const record = await getTempChannel(channelId);
  if (!record) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel) {
    // Channel was already removed
    await deleteTempChannel(channelId);
    voiceMembersTime.delete(channelId);
    return;
  }

  // Remove member from presence tracking
  if (voiceMembersTime.has(channelId)) {
    voiceMembersTime.get(channelId).delete(member.id);
  }

  // Count remaining non-bot members
  const nonBotMembers = channel.members.filter(m => !m.user.bot);

  // CASE A: ROOM IS COMPLETELY EMPTY -> START 3S DEBOUNCE TIMER
  if (nonBotMembers.size === 0) {
    if (emptyDebounceTimers.has(channelId)) {
      clearTimeout(emptyDebounceTimers.get(channelId));
    }

    const timer = setTimeout(async () => {
      emptyDebounceTimers.delete(channelId);
      const live = guild.channels.cache.get(channelId);
      if (!live) {
        await deleteTempChannel(channelId);
        voiceMembersTime.delete(channelId);
        return;
      }

      // Re-verify it is still empty
      if (live.members.filter(m => !m.user.bot).size === 0) {
        logger.info({ channelId, guildId: guild.id }, 'Deleting empty temporary voice channel');
        ttsEngine.handleEmptyChannel(guild.id);
        await live.delete('Argoni temporary channel empty').catch(() => {});
        await deleteTempChannel(channelId);
        voiceMembersTime.delete(channelId);
        channelRenameHistory.delete(channelId);
      }
    }, 3000);

    emptyDebounceTimers.set(channelId, timer);
    return;
  }

  // CASE B: ROOM OWNER LEFT BUT OTHER MEMBERS REMAIN -> AUTOMATIC OWNERSHIP TRANSFER
  if (member.id === record.owner_id && nonBotMembers.size > 0) {
    // Find longest-present member
    const times = voiceMembersTime.get(channelId) || new Map();
    let oldestMember = null;
    let oldestJoin = Infinity;

    for (const [mid, m] of nonBotMembers) {
      const joinTs = times.get(mid) || Date.now();
      if (joinTs < oldestJoin) {
        oldestJoin = joinTs;
        oldestMember = m;
      }
    }

    if (oldestMember) {
      await transferRoomOwnership(channel, record, oldestMember.id, 'Automatic transfer: previous owner left');
    }
  } else {
    // Refresh control card with new member count
    await refreshControlMessage(channel);
  }
}

/**
 * Transfers ownership of a temporary voice channel
 */
export async function transferRoomOwnership(channel, record, newOwnerId, reason = 'Ownership transfer') {
  try {
    // Revoke special permissions from previous owner
    await channel.permissionOverwrites.delete(record.owner_id).catch(() => {});

    // Grant owner permissions to new owner
    await channel.permissionOverwrites.edit(newOwnerId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      Stream: true,
      MoveMembers: true,
      MuteMembers: true,
      DeafenMembers: true,
      PrioritySpeaker: true,
      SendMessages: true,
      ReadMessageHistory: true
    }, { reason });

    // Update database record
    await updateTempChannel(channel.id, { owner_id: newOwnerId });

    // Refresh control message in place
    await refreshControlMessage(channel);

    // Announce ownership transfer in channel chat
    await channel.send({
      content: `👑 **Room Ownership Transferred:** <@${newOwnerId}> is now the room owner.`
    }).catch(() => {});

    logger.info({ channelId: channel.id, newOwnerId, reason }, 'Transferred room ownership');
    return true;
  } catch (err) {
    logger.error({ err, channelId: channel.id, newOwnerId }, 'Failed to transfer room ownership');
    return false;
  }
}

/**
 * Reconciles active temporary channels on bot ready / restart
 * Deletes orphaned channels, removes empty leftovers, and synchronizes DB
 */
export async function reconcileTempChannels(client) {
  logger.info('Starting startup reconciliation for temporary voice channels...');
  const records = await getAllTempChannels();
  let deletedCount = 0;
  let activeCount = 0;

  for (const rec of records) {
    const guild = client.guilds.cache.get(rec.guild_id);
    if (!guild) {
      await deleteTempChannel(rec.channel_id);
      deletedCount++;
      continue;
    }

    const channel = guild.channels.cache.get(rec.channel_id);
    if (!channel) {
      // Channel was deleted while bot was offline
      await deleteTempChannel(rec.channel_id);
      deletedCount++;
      continue;
    }

    // Check if channel has active non-bot members
    const nonBots = channel.members.filter(m => !m.user.bot);
    if (nonBots.size === 0) {
      // Abandoned empty channel: clean it up
      await channel.delete('Reconciliation: empty channel on bot startup').catch(() => {});
      await deleteTempChannel(rec.channel_id);
      deletedCount++;
    } else {
      activeCount++;
      // Rebuild member presence tracking
      const presence = new Map();
      for (const [mId] of nonBots) {
        presence.set(mId, Date.now());
      }
      voiceMembersTime.set(rec.channel_id, presence);

      // Verify or refresh control card
      await refreshControlMessage(channel).catch(() => {});
    }
  }

  logger.info(`Reconciliation complete: ${activeCount} active temp room(s) maintained, ${deletedCount} stale room(s) pruned`);
}

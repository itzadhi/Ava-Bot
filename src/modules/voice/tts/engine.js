import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType
} from '@discordjs/voice';
import { defaultTTSProvider } from './provider.js';
import { getUserTTSPrefs, getTempChannel } from '../../../db/voice.js';
import { getGuildSettings } from '../../../db/guilds.js';
import { logger } from '../../../utils/logger.js';

/**
 * Sanitizes message content before feeding to speech synthesis
 * @param {string} raw
 * @param {number} [maxLen=200]
 * @returns {string}
 */
export function sanitizeTTSText(raw, maxLen = 200) {
  if (!raw || typeof raw !== 'string') return '';

  let text = raw
    // Strip multi-line code blocks
    .replace(/```[\s\S]*?```/g, ' ')
    // Strip inline code blocks
    .replace(/`[^`]*`/g, ' ')
    // Strip links (http / https)
    .replace(/https?:\/\/\S+/gi, ' ')
    // Strip custom discord emojis <a:name:id> or <:name:id>
    .replace(/<a?:\w+:\d+>/g, ' ')
    // Strip user mentions <@123> or <@!123>
    .replace(/<@!?\d+>/g, ' ')
    // Strip role mentions <@&123>
    .replace(/<@&\d+>/g, ' ')
    // Strip channel mentions <#123>
    .replace(/<#\d+>/g, ' ')
    // Strip spoilers ||text||
    .replace(/\|\|.*?\|\|/g, ' ')
    // Strip markdown formatting characters (*, _, ~, #, >)
    .replace(/[*_~#>]/g, '')
    // Normalize multiple spaces into single space
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > maxLen) {
    text = text.slice(0, maxLen).trim();
  }
  return text;
}

/**
 * Guild voice state manager for speech queue and voice connections
 */
class GuildVoiceState {
  constructor(guildId) {
    this.guildId = guildId;
    this.connection = null;
    this.player = null;
    this.channelId = null;
    this.boundTextChannelId = null; // Text chat channel where /tts was invoked
    this.boundVoiceChannelId = null; // Voice channel the bot joined
    this.boundByUserId = null; // User who invoked /tts
    this.active = false;
    this.queue = [];
    this.isPlaying = false;
    this.disconnectTimeout = null;
    this.userLastSpoke = new Map(); // userId -> timestamp
  }

  reset() {
    this.queue = [];
    this.isPlaying = false;
    this.boundTextChannelId = null;
    this.boundVoiceChannelId = null;
    this.boundByUserId = null;
    this.active = false;
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
    }
  }

  destroy() {
    this.reset();
    if (this.player) {
      try { this.player.stop(); } catch (_) {}
      this.player = null;
    }
    if (this.connection) {
      try { this.connection.destroy(); } catch (_) {}
      this.connection = null;
    }
    this.channelId = null;
  }
}

export class TTSEngine {
  constructor(provider = defaultTTSProvider) {
    this.provider = provider;
    this.guilds = new Map(); // guildId -> GuildVoiceState
    this.maxQueueSize = 20;
    this.userCooldownMs = 2500;
  }

  /**
   * Gets or initializes the voice state for a guild
   * @param {string} guildId
   * @returns {GuildVoiceState}
   */
  getGuildState(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, new GuildVoiceState(guildId));
    }
    return this.guilds.get(guildId);
  }

  /**
   * Joins a voice channel and binds to the text channel where /tts was executed
   * @param {object} params
   * @param {import('discord.js').Guild} params.guild
   * @param {import('discord.js').VoiceChannel} params.voiceChannel
   * @param {import('discord.js').TextChannel} params.textChannel
   * @param {string} params.userId
   */
  async joinAndBind({ guild, voiceChannel, textChannel, userId }) {
    const state = this.getGuildState(guild.id);
    await this.ensureConnection(voiceChannel);

    state.boundTextChannelId = textChannel.id;
    state.boundVoiceChannelId = voiceChannel.id;
    state.boundByUserId = userId;
    state.active = true;

    logger.info(
      { guildId: guild.id, voiceChannelId: voiceChannel.id, textChannelId: textChannel.id, userId },
      'TTS reader joined voice channel and bound to text chat'
    );

    return state;
  }

  /**
   * Stops TTS and leaves the voice channel
   * @param {string} guildId
   * @returns {boolean}
   */
  stop(guildId) {
    const state = this.guilds.get(guildId);
    if (!state) return false;
    state.destroy();
    this.guilds.delete(guildId);
    return true;
  }

  /**
   * Returns current active TTS session status in a guild
   * @param {string} guildId
   */
  getSession(guildId) {
    const state = this.guilds.get(guildId);
    if (!state || !state.active) return null;
    return {
      voiceChannelId: state.boundVoiceChannelId || state.channelId,
      textChannelId: state.boundTextChannelId,
      boundByUserId: state.boundByUserId,
      active: state.active
    };
  }

  /**
   * Sets custom TTS provider
   */
  setProvider(provider) {
    this.provider = provider;
  }

  /**
   * Connects to a voice channel or reuses existing connection
   */
  async ensureConnection(voiceChannel) {
    const state = this.getGuildState(voiceChannel.guild.id);

    // Cancel pending auto-leave timer if members are active
    if (state.disconnectTimeout) {
      clearTimeout(state.disconnectTimeout);
      state.disconnectTimeout = null;
    }

    if (state.connection && state.channelId === voiceChannel.id) {
      if (state.connection.state.status === VoiceConnectionStatus.Ready) {
        return state.connection;
      }
    }

    // Clean up previous connection if channel changed
    if (state.connection && state.channelId !== voiceChannel.id) {
      try {
        state.connection.destroy();
      } catch (_) {}
      state.connection = null;
    }

    state.channelId = voiceChannel.id;
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    state.connection = connection;

    if (!state.player) {
      state.player = createAudioPlayer();
      state.player.on(AudioPlayerStatus.Idle, () => {
        state.isPlaying = false;
        this._processNext(voiceChannel.guild.id);
      });

      state.player.on('error', (err) => {
        logger.error({ err, guildId: voiceChannel.guild.id }, 'TTS AudioPlayer error');
        state.isPlaying = false;
        this._processNext(voiceChannel.guild.id);
      });
    }

    connection.subscribe(state.player);

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch {
        logger.debug({ guildId: voiceChannel.guild.id }, 'Voice connection disconnected permanently');
        state.destroy();
        this.guilds.delete(voiceChannel.guild.id);
      }
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 10000);
      return connection;
    } catch (err) {
      logger.error({ err, channelId: voiceChannel.id }, 'Failed to establish ready voice connection');
      state.destroy();
      throw err;
    }
  }

  /**
   * Handles user chat message in a bound text chat or temporary voice channel
   */
  async handleMessage(message) {
    if (!message.guild || message.author.bot) return;

    const guildId = message.guild.id;
    const channelId = message.channel.id;
    const state = this.guilds.get(guildId);

    // 1. Determine if this message is in a monitored channel:
    // Case A: The text channel where /tts was summoned
    const isBoundTextChat = Boolean(state && state.active && state.boundTextChannelId === channelId);

    // Case B: Legacy / direct voice text chat for a temporary channel
    let tempChannel = null;
    if (!isBoundTextChat) {
      tempChannel = await getTempChannel(channelId);
    }
    const isTempVoiceChat = Boolean(tempChannel && tempChannel.tts_enabled);

    if (!isBoundTextChat && !isTempVoiceChat) return;

    // 2. Check guild-wide TTS toggle
    const guildSettings = await getGuildSettings(guildId);
    if (guildSettings && guildSettings.tts_enabled === false) return;

    // 3. Check author opt-out preference
    const userPrefs = await getUserTTSPrefs(message.author.id, guildId);
    if (userPrefs && userPrefs.opt_out) return;

    // 4. Check user cooldown/rate limit (1 message / 2.5s per user)
    const currentState = state || this.getGuildState(guildId);
    const lastSpoke = currentState.userLastSpoke.get(message.author.id) || 0;
    if (Date.now() - lastSpoke < this.userCooldownMs) {
      return; // Rate limited, ignore quietly
    }
    currentState.userLastSpoke.set(message.author.id, Date.now());

    // 5. Sanitize message content
    const sanitized = sanitizeTTSText(message.content);
    if (!sanitized) return;

    // 6. Resolve target voice channel
    const targetVoiceId = isBoundTextChat
      ? (currentState.boundVoiceChannelId || currentState.channelId)
      : channelId;

    const voiceChannel = message.guild.channels.cache.get(targetVoiceId);
    if (!voiceChannel || !voiceChannel.isVoiceBased()) return;

    // 7. Verify there is at least one non-bot listener in the voice channel
    const membersList = voiceChannel.members?.values ? Array.from(voiceChannel.members.values()) : [];
    const hasListeners = membersList.some(m => !m.user?.bot);
    if (!hasListeners) {
      this.handleEmptyChannel(guildId);
      return;
    }

    // 8. Format speech: read the message that upcoming user says with their display name
    const rawName = message.member?.displayName || message.author.displayName || message.author.globalName || message.author.username;
    const displayName = sanitizeTTSText(rawName, 32) || 'User';
    const speechText = `${displayName} says, ${sanitized}`;

    // 9. Queue speech in the voice channel
    await this.queueSpeech({
      guild: message.guild,
      voiceChannel,
      text: speechText,
      authorId: message.author.id,
      voice: userPrefs?.language || 'en-us',
      language: userPrefs?.language || 'en'
    });
  }

  /**
   * Queues a speech line to be played in a voice channel
   */
  async queueSpeech({ guild, voiceChannel, text, authorId = null, language = 'en', voice = null }) {
    const state = this.getGuildState(guild.id);

    if (state.queue.length >= this.maxQueueSize) {
      logger.warn({ guildId: guild.id }, 'TTS queue reached maximum limit, dropping speech request');
      return false;
    }

    state.queue.push({
      voiceChannel,
      text,
      authorId,
      language,
      voice: voice || language || 'en-us'
    });

    if (!state.isPlaying) {
      this._processNext(guild.id);
    }
    return true;
  }

  /**
   * Processes the next item in the guild speech queue
   * @private
   */
  async _processNext(guildId) {
    const state = this.guilds.get(guildId);
    if (!state || state.queue.length === 0) {
      if (state) state.isPlaying = false;
      return;
    }

    const item = state.queue.shift();
    const { voiceChannel, text, authorId, language, voice } = item;

    // Validate voice channel still exists
    const liveChannel = voiceChannel.guild.channels.cache.get(voiceChannel.id);
    if (!liveChannel) {
      return this._processNext(guildId);
    }

    // Check if voice channel is completely empty of non-bot members
    const membersList = liveChannel.members?.values ? Array.from(liveChannel.members.values()) : [];
    const hasListeners = membersList.some(m => !m.user?.bot);
    if (!hasListeners) {
      this.handleEmptyChannel(voiceChannel.guild.id);
      return;
    }

    try {
      state.isPlaying = true;
      await this.ensureConnection(liveChannel);

      const { stream, format } = await this.provider.synthesize(text, { language, voice: voice || language });
      const resource = createAudioResource(stream, {
        inputType: format === 'opus' ? StreamType.Opus : StreamType.Arbitrary,
        inlineVolume: true
      });

      if (resource.volume) {
        resource.volume.setVolume(1.0);
      }

      state.player.play(resource);
    } catch (err) {
      logger.error({ err, guildId, text }, 'Failed to play synthesized speech resource');
      state.isPlaying = false;
      this._processNext(guildId);
    }
  }

  /**
   * Queues a status announcement (e.g. for approved/implemented suggestions)
   */
  async queueAnnouncement(guild, authorId, announcementText) {
    const guildSettings = await getGuildSettings(guild.id);
    if (!guildSettings?.tts_announce) return;

    // Find if author is in any active temp voice channel
    const member = await guild.members.fetch(authorId).catch(() => null);
    if (!member || !member.voice.channelId) return;

    const tempChannel = await getTempChannel(member.voice.channelId);
    if (!tempChannel || !tempChannel.tts_enabled) return;

    const voiceChannel = guild.channels.cache.get(member.voice.channelId);
    if (!voiceChannel) return;

    await this.queueSpeech({
      guild,
      voiceChannel,
      text: announcementText,
      authorId: null, // system announcement doesn't skip if author momentarily drops
      language: 'en'
    });
  }

  /**
   * Auto-leaves voice channel when room is empty
   */
  handleEmptyChannel(guildId) {
    const state = this.guilds.get(guildId);
    if (!state) return;

    if (!state.disconnectTimeout) {
      state.disconnectTimeout = setTimeout(() => {
        logger.debug({ guildId }, 'Auto-leaving empty voice channel after debounce timeout');
        state.destroy();
        this.guilds.delete(guildId);
      }, 3000);
    }
  }

  /**
   * Leaves voice immediately
   */
  leave(guildId) {
    const state = this.guilds.get(guildId);
    if (state) {
      state.destroy();
      this.guilds.delete(guildId);
    }
  }
}

export const ttsEngine = new TTSEngine(defaultTTSProvider);
export default ttsEngine;

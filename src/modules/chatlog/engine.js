import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getActiveTier } from '../../config/tiers.js';
import { createChatlogRecord, getChatlogById } from '../../db/chatlogs.js';
import { uploadSnapshot, downloadSnapshot } from '../../db/storage.js';
import { generateShortId } from '../../utils/id.js';
import { progressCard } from '../../ui/cards.js';
import { addJob } from '../../services/queue.js';
import { logAudit } from '../../db/audit.js';
import { logger } from '../../utils/logger.js';
import { sanitizeEmbeds, componentsToEmbed, sanitizeEmbedForSend } from '../../utils/embed.js';

// Continuous real-time ring buffer per channel (Channel ID -> Array<MessagePayload>)
const channelVaultBuffer = new Map();
// Debounce timers for background storage sync (Channel ID -> NodeJS.Timeout)
const flushTimers = new Map();
// Maximum messages to retain per channel in the live memory ring buffer
const MAX_RING_BUFFER = 300;

/**
 * Normalizes a Discord message into a structured payload for archiving
 * @param {import('discord.js').Message} m
 */
export function extractMessagePayload(m) {
  if (!m) return null;
  const attachments = Array.from(m.attachments?.values?.() || []).map(a => ({
    id: a.id,
    name: a.name,
    url: a.url,
    size: a.size,
    contentType: a.contentType
  }));

  return {
    id: m.id,
    authorId: m.author?.id || '0',
    authorName: m.author?.username || 'User',
    authorAvatar: typeof m.author?.displayAvatarURL === 'function' ? m.author.displayAvatarURL() : null,
    content: m.content || '',
    createdAt: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
    attachments,
    components: Array.from(m.components || []).map(c => typeof c?.toJSON === 'function' ? c.toJSON() : c),
    referenceMessageId: m.reference?.messageId || null
  };
}

/**
 * Automatically records a live message into the real-time channel vault.
 * Called automatically on every messageCreate in the server.
 * @param {import('discord.js').Message} message
 */
export async function recordLiveMessage(message) {
  try {
    // Ignore webhooks created by our own replay engine to prevent infinite loops
    if (message.webhookId && message.author?.username?.startsWith('Argoni')) return;
    if (!message.guild || !message.channel || typeof message.channel.isTextBased !== 'function' || !message.channel.isTextBased()) return;

    // Check if chatlog / vault protection is enabled for this server
    const settings = await getGuildSettings(message.guild.id);
    if (!settings.chatlog_enabled) return;

    const payload = extractMessagePayload(message);
    if (!payload) return;

    // Skip empty / phantom messages
    const hasContent = payload.content && payload.content.trim().length > 0;
    const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0;
    const hasAttachments = Array.isArray(payload.attachments) && payload.attachments.length > 0;
    if (!hasContent && !hasEmbeds && !hasAttachments) return;

    const channelId = message.channel.id;
    const guildId = message.guild.id;

    let buffer = channelVaultBuffer.get(channelId);
    if (!buffer) {
      buffer = [];
      channelVaultBuffer.set(channelId, buffer);
    }

    // Append to ring buffer, keeping only the latest MAX_RING_BUFFER messages
    buffer.push(payload);
    if (buffer.length > MAX_RING_BUFFER) {
      buffer.shift();
    }

    // Schedule debounced background flush to Supabase storage (every 5 seconds)
    if (!flushTimers.has(channelId)) {
      const timer = setTimeout(() => {
        flushTimers.delete(channelId);
        flushChannelVault(guildId, channelId).catch(err => {
          logger.warn(`Failed background vault flush for #${message.channel.name}: ${err.message}`);
        });
      }, 5000);
      flushTimers.set(channelId, timer);
    }
  } catch (err) {
    logger.warn(`recordLiveMessage error: ${err.message}`);
  }
}

/**
 * Persists the in-memory channel vault buffer to encrypted Supabase storage
 * @param {string} guildId
 * @param {string} channelId
 */
export async function flushChannelVault(guildId, channelId) {
  const buffer = channelVaultBuffer.get(channelId);
  if (!buffer || buffer.length === 0) return;

  const storagePath = `guild_${guildId}/vaults/${channelId}.enc.gz`;
  const payload = {
    guildId,
    channelId,
    updatedAt: new Date().toISOString(),
    messageCount: buffer.length,
    messages: buffer
  };

  await uploadSnapshot(storagePath, payload, true);
}

/**
 * Retrieves the messages available for automatic restoration in a channel.
 * Seamlessly merges in-memory buffer, persistent vault snapshot, and live Discord history.
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} params.channel
 * @param {number} [params.limit=100]
 * @returns {Promise<Array<object>>}
 */
export async function getChannelVaultMessages({ guild, channel, limit = 100 }) {
  // 1. Check in-memory ring buffer
  const cached = channelVaultBuffer.get(channel.id);
  if (cached && cached.length >= 10) {
    return cached.slice(-limit);
  }

  // 2. Try loading from Supabase vault storage
  const storagePath = `guild_${guild.id}/vaults/${channel.id}.enc.gz`;
  try {
    const snapshot = await downloadSnapshot(storagePath, true);
    if (snapshot && Array.isArray(snapshot.messages) && snapshot.messages.length > 0) {
      channelVaultBuffer.set(channel.id, snapshot.messages);
      return snapshot.messages.slice(-limit);
    }
  } catch (_) {}

  // 3. Fallback: Automatically capture recent messages directly from channel history
  try {
    if (typeof channel.messages?.fetch === 'function') {
      const fetched = await channel.messages.fetch({ limit: Math.min(limit, 100) });
      const extracted = Array.from(fetched.values())
        .reverse()
        .map(m => extractMessagePayload(m))
        .filter(Boolean);

      if (extracted.length > 0) {
        channelVaultBuffer.set(channel.id, extracted);
        return extracted;
      }
    }
  } catch (_) {}

  return cached || [];
}

/**
 * Performs full automatic chat restoration for a channel via Discord Webhooks.
 * No manual archiving, no codes, no zip files. 1-click automatic restoration.
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} params.channel
 * @param {import('discord.js').User} params.user
 * @param {Function} [params.onProgress]
 * @returns {Promise<{ count: number }>}
 */
export async function autoRestoreChannel({ guild, channel, user, onProgress = null }) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
    throw new Error('Bot lacks Manage Webhooks permission in this server.');
  }

  const messages = await getChannelVaultMessages({ guild, channel, limit: 100 });
  if (!messages || messages.length === 0) {
    throw new Error(`No messages available in #${channel.name} to restore.`);
  }

  // Retrieve or create replay webhook
  const hooks = await channel.fetchWebhooks().catch(() => new Map());
  let webhook = hooks.find(h => h.owner?.id === guild.client.user.id);
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: 'Argoni Auto-Recovery',
      reason: 'Automatic Chat Restoration Engine'
    });
  }

  let sent = 0;
  const total = messages.length;
  let lastProgress = 0;

  for (const msg of messages) {
    await addJob(async () => {
      try {
        let sanitizedEmbeds = sanitizeEmbeds(msg.embeds);

        // Convert Components V2 cards to rich embeds if needed
        if (sanitizedEmbeds.length === 0 && Array.isArray(msg.components) && msg.components.length > 0) {
          const compEmbed = componentsToEmbed(msg.components);
          if (compEmbed) {
            const s = sanitizeEmbedForSend(compEmbed);
            if (s) sanitizedEmbeds.push(s);
          }
        }

        let content = typeof msg.content === 'string' ? msg.content : '';
        if (!content.replace(/[\s\u200b\u200c\u200d\ufeff]/gu, '')) {
          content = '';
        } else {
          content = content.trim();
        }

        if (!content && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
          content = msg.attachments.map(a => a.url).filter(Boolean).join('\n');
        }

        // Strictly omit blank space / phantom messages
        if (!content && sanitizedEmbeds.length === 0) {
          return;
        }

        const webhookPayload = {
          username: (msg.authorName || 'User').slice(0, 80),
          avatarURL: msg.authorAvatar || undefined
        };
        if (content) webhookPayload.content = content.slice(0, 2000);
        if (sanitizedEmbeds.length > 0) {
          webhookPayload.embeds = sanitizedEmbeds;
        }

        await webhook.send(webhookPayload);
        sent++;

        const now = Date.now();
        if (onProgress && (now - lastProgress > 1500 || sent === total)) {
          lastProgress = now;
          await onProgress(progressCard({
            title: `Auto-Restoring #${channel.name}`,
            step: `Restoring message ${sent} of ${total}`,
            done: sent,
            total
          }));
        }
      } catch (err) {
        logger.warn(`Auto-recovery message send note: ${err.message}`);
      }
    });
  }

  await logAudit({
    guildId: guild.id,
    userId: user.id,
    action: 'CHATLOG_AUTO_RESTORED',
    details: { channelId: channel.id, messageCount: sent }
  });

  return { count: sent };
}

/**
 * Automatically restores chat across all server channels
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').User} params.user
 * @param {Function} [params.onProgress]
 * @returns {Promise<{ totalChannels: number, totalMessages: number }>}
 */
export async function autoRestoreAllChannels({ guild, user, onProgress = null }) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
    throw new Error('Bot lacks Manage Webhooks permission in this server.');
  }

  const textChannels = Array.from(guild.channels.cache.values())
    .filter(c => typeof c.isTextBased === 'function' && c.isTextBased() && !c.isVoiceBased?.());

  let totalMessages = 0;
  let totalChannels = 0;

  for (const ch of textChannels.slice(0, 25)) {
    try {
      const res = await autoRestoreChannel({
        guild,
        channel: ch,
        user,
        onProgress
      });
      if (res.count > 0) {
        totalChannels++;
        totalMessages += res.count;
      }
    } catch (_) {}
  }

  return { totalChannels, totalMessages };
}

/**
 * Returns current vault statistics for a guild
 * @param {string} guildId
 * @returns {object}
 */
export function getGuildVaultStats(guildId) {
  let trackedChannels = 0;
  let bufferedMessages = 0;

  for (const [chId, msgs] of channelVaultBuffer.entries()) {
    if (msgs.length > 0) {
      trackedChannels++;
      bufferedMessages += msgs.length;
    }
  }

  return { trackedChannels, bufferedMessages };
}

/**
 * Exports channel messages into an encrypted, gzipped chatlog snapshot (Backwards Compatible)
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} params.channel
 * @param {import('discord.js').User} params.user
 * @param {number} [params.maxMessages]
 * @returns {Promise<{ id: string, record: object, count: number }>}
 */
export async function exportChannelChatlog({ guild, channel, user, maxMessages = null }) {
  const settings = await getGuildSettings(guild.id);
  if (!settings.chatlog_enabled) {
    throw new Error('OPT_IN_REQUIRED: Chatlog recording is not enabled on this server. The server owner must enable it first via `/settings set-chatlog enabled:true`.');
  }

  const tier = getActiveTier(settings);
  const limit = Math.min(maxMessages || tier.chatlogMaxMessages, tier.chatlogMaxMessages);

  // Fetch messages from channel
  const fetched = await channel.messages.fetch({ limit: Math.min(limit, 100) });
  const messages = Array.from(fetched.values())
    .reverse()
    .map(m => extractMessagePayload(m))
    .filter(Boolean);

  const chatlogId = `LOG-${generateShortId(4, 1)}`;
  const storagePath = `guild_${guild.id}/chatlogs/${chatlogId}.enc.gz`;

  const payload = {
    chatlogId,
    guildId: guild.id,
    channelId: channel.id,
    channelName: channel.name,
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages
  };

  await uploadSnapshot(storagePath, payload, true);

  const record = await createChatlogRecord({
    id: chatlogId,
    guild_id: guild.id,
    channel_id: channel.id,
    message_count: messages.length,
    storage_path: storagePath,
    ttlDays: 90
  });

  await logAudit({
    guildId: guild.id,
    userId: user.id,
    action: 'CHATLOG_CREATED',
    details: { chatlogId, channelId: channel.id, messageCount: messages.length }
  });

  return { id: chatlogId, record, count: messages.length };
}

/**
 * Replays an encrypted chatlog into a channel using webhooks (Backwards Compatible)
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').TextChannel} params.channel
 * @param {import('discord.js').User} params.user
 * @param {object} params.chatlogRecord
 * @param {Function} [params.onProgress]
 */
export async function restoreChannelChatlog({ guild, channel, user, chatlogRecord, onProgress = null }) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageWebhooks)) {
    throw new Error('Bot lacks Manage Webhooks permission in this server.');
  }

  const snapshot = await downloadSnapshot(chatlogRecord.storage_path, true);
  const messages = snapshot.messages || [];

  const hooks = await channel.fetchWebhooks().catch(() => new Map());
  let webhook = hooks.find(h => h.owner?.id === guild.client.user.id);
  if (!webhook) {
    webhook = await channel.createWebhook({
      name: 'Argoni Auto-Recovery',
      reason: 'Automatic Chat Restoration Engine'
    });
  }

  let sent = 0;
  const total = messages.length;
  let lastProgress = 0;

  for (const msg of messages) {
    await addJob(async () => {
      try {
        let sanitizedEmbeds = sanitizeEmbeds(msg.embeds);

        if (sanitizedEmbeds.length === 0 && Array.isArray(msg.components) && msg.components.length > 0) {
          const compEmbed = componentsToEmbed(msg.components);
          if (compEmbed) {
            const s = sanitizeEmbedForSend(compEmbed);
            if (s) sanitizedEmbeds.push(s);
          }
        }

        let content = typeof msg.content === 'string' ? msg.content : '';
        if (!content.replace(/[\s\u200b\u200c\u200d\ufeff]/gu, '')) {
          content = '';
        } else {
          content = content.trim();
        }

        if (!content && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
          content = msg.attachments.map(a => a.url).filter(Boolean).join('\n');
        }

        if (!content && sanitizedEmbeds.length === 0) {
          return;
        }

        const webhookPayload = {
          username: (msg.authorName || 'User').slice(0, 80),
          avatarURL: msg.authorAvatar || undefined
        };
        if (content) webhookPayload.content = content.slice(0, 2000);
        if (sanitizedEmbeds.length > 0) {
          webhookPayload.embeds = sanitizedEmbeds;
        }

        await webhook.send(webhookPayload);
        sent++;

        const now = Date.now();
        if (onProgress && (now - lastProgress > 2000 || sent === total)) {
          lastProgress = now;
          await onProgress(progressCard({
            title: `Restoring #${channel.name}`,
            step: `Restoring message ${sent} of ${total}`,
            done: sent,
            total
          }));
        }
      } catch (err) {
        logger.error({ err }, 'Error replaying webhook message');
      }
    });
  }

  await logAudit({
    guildId: guild.id,
    userId: user.id,
    action: 'CHATLOG_RESTORED',
    details: { chatlogId: chatlogRecord.id, targetChannelId: channel.id, totalSent: sent }
  });

  return { totalRestored: sent };
}

export default {
  recordLiveMessage,
  flushChannelVault,
  getChannelVaultMessages,
  autoRestoreChannel,
  autoRestoreAllChannels,
  getGuildVaultStats,
  exportChannelChatlog,
  restoreChannelChatlog
};

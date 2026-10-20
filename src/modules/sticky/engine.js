import {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import { getStickyNote, updateStickyLastMessage } from '../../db/sticky.js';
import { logger } from '../../utils/logger.js';

// Concurrency lock per channel to prevent overlapping sticky reposts during rapid chat
const stickyLocks = new Set();

/**
 * Builds the Components V2 card for the sticky message
 * @param {string} content
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildStickyNoteCard(content) {
  const container = new ContainerBuilder();

  const formattedContent =
    `# 📌 Sticky Note\n` +
    `> ${(content || '').split('\n').join('\n> ')}`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(formattedContent));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Handles incoming chat messages to repost sticky note at the bottom of the channel
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} True if sticky note was updated
 */
export async function handleStickyMessage(message) {
  if (!message.guild || !message.channel || message.author.bot) {
    return false;
  }

  const channelId = message.channel.id;
  const sticky = await getStickyNote(channelId);
  if (!sticky || sticky.is_enabled === false) {
    return false;
  }

  // Prevent race conditions during high-volume message bursts
  if (stickyLocks.has(channelId)) {
    return false;
  }
  stickyLocks.add(channelId);

  try {
    // 1. Delete previous sticky message if present
    if (sticky.last_message_id) {
      const oldMsg = await message.channel.messages.fetch(sticky.last_message_id).catch(() => null);
      if (oldMsg) {
        await oldMsg.delete().catch(() => {});
      }
    }

    // 2. Send fresh sticky note message at the bottom
    const card = buildStickyNoteCard(sticky.content);
    const newStickyMsg = await message.channel.send(card);

    // 3. Update sticky last message id
    await updateStickyLastMessage(channelId, newStickyMsg.id);
    return true;
  } catch (err) {
    logger.debug({ err, channelId }, 'Could not repost sticky note');
    return false;
  } finally {
    stickyLocks.delete(channelId);
  }
}

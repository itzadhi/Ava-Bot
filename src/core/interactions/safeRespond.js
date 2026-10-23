import { MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { errorCard } from '../../ui/cards.js';
import { isAcknowledged, markAcknowledged } from './tracker.js';
import { metrics } from '../metrics.js';

/**
 * Normalizes and sanitizes a payload to conform strictly to Components V2 standards.
 * Ensures flags include MessageFlags.IsComponentsV2, removes conflicting `content`,
 * and validates that embeds are not present.
 * @param {object|string} rawPayload
 * @param {boolean} [ephemeral=false]
 * @returns {object}
 */
export function sanitizePayload(rawPayload, ephemeral = false) {
  let payload = rawPayload;
  if (typeof payload === 'string') {
    payload = errorCard({
      title: 'Notice',
      reason: payload,
      ephemeral
    });
  } else if (!payload || typeof payload !== 'object') {
    payload = errorCard({
      title: 'Notice',
      reason: 'No response data provided.',
      ephemeral
    });
  }

  // Clone payload to avoid mutating caller object
  const clean = { ...payload };

  // Calculate flags
  let currentFlags = clean.flags || 0;

  // Add Components V2 flag if components are present
  if (Array.isArray(clean.components) && clean.components.length > 0) {
    currentFlags |= MessageFlags.IsComponentsV2;
  }

  // Handle ephemeral flag
  if (ephemeral || clean.ephemeral) {
    currentFlags |= MessageFlags.Ephemeral;
  }
  delete clean.ephemeral;

  clean.flags = currentFlags;

  // Components V2 strictly prohibits top-level `content` and `embeds`
  if ((currentFlags & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2) {
    if ('content' in clean) {
      delete clean.content;
    }
    if ('embeds' in clean) {
      delete clean.embeds;
    }
  }

  return clean;
}

/**
 * Safe response helper that intelligently routes the response through the correct
 * Discord.js interaction method and handles edge cases, expired tokens, and missing permissions.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object|string} payload
 * @param {object} [options={}]
 * @param {boolean} [options.ephemeral=false]
 * @param {boolean} [options.followUp=false]
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<any>}
 */
export async function safeRespond(interaction, payload, options = {}) {
  if (!interaction) return null;

  const {
    ephemeral = false,
    followUp = false,
    timeoutMs = 10000
  } = options;

  const cleanPayload = sanitizePayload(payload, ephemeral);
  const acked = isAcknowledged(interaction);

  const respondOperation = async () => {
    try {
      if (!acked) {
        // Not yet acknowledged: pick reply or update
        if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) {
          // If ephemeral requested on a component, use reply; otherwise update message
          if (ephemeral) {
            markAcknowledged(interaction, 'reply');
            return await interaction.reply(cleanPayload);
          } else {
            markAcknowledged(interaction, 'update');
            return await interaction.update(cleanPayload);
          }
        }

        if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
          markAcknowledged(interaction, 'reply');
          return await interaction.reply(cleanPayload);
        }

        if (typeof interaction.reply === 'function') {
          markAcknowledged(interaction, 'reply');
          return await interaction.reply(cleanPayload);
        }
      } else {
        // Already acknowledged (deferred or replied)
        const needsFollowUpForEphemeral = ephemeral && interaction.deferred && !interaction.ephemeral;
        if ((followUp || needsFollowUpForEphemeral) && typeof interaction.followUp === 'function') {
          return await interaction.followUp(cleanPayload);
        }

        if (typeof interaction.editReply === 'function') {
          return await interaction.editReply(cleanPayload);
        }

        if (typeof interaction.followUp === 'function') {
          return await interaction.followUp(cleanPayload);
        }
      }
    } catch (err) {
      return await handleDiscordError(err, interaction, cleanPayload);
    }
  };

  // Timeout guard: after timeoutMs, respond with a clean errorCard
  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RESPONSE_TIMEOUT: Handler took longer than ${timeoutMs}ms to respond`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    return await Promise.race([respondOperation(), timeoutPromise]);
  } catch (err) {
    if (err.message?.startsWith('RESPONSE_TIMEOUT')) {
      logger.warn({ timeoutMs }, 'Interaction response timed out, applying timeout card fallback');
      const timeoutPayload = sanitizePayload(errorCard({
        title: 'Action Timed Out',
        subtitle: 'The operation took too long to complete.',
        reason: 'The server took longer than expected to process your request.',
        fix: 'Please try clicking the action again.',
        ephemeral: true
      }), true);

      return await fallbackDirectSend(interaction, timeoutPayload);
    }
    return await handleDiscordError(err, interaction, cleanPayload);
  }
}

/**
 * Classifies and resolves Discord API errors gracefully.
 * @param {Error} err
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload
 */
async function handleDiscordError(err, interaction, payload) {
  const code = err.code || err.rawError?.code;
  metrics.recordError(code || 'other');

  // 10062: Unknown interaction (expired or failed acknowledgement)
  // 40060: Interaction has already been acknowledged
  if (code === 10062 || code === 40060 || err.message?.includes('already been acknowledged') || err.message?.includes('Unknown interaction')) {
    logger.debug({ code, msg: err.message }, 'Expected interaction timing error handled safely');
    return null;
  }

  // 50027: Invalid webhook token (token expired after 15 minutes)
  if (code === 50027 || err.message?.includes('Invalid Webhook Token')) {
    logger.debug('Webhook token expired (>15m), falling back to channel.send / message.edit');
    return await fallbackDirectSend(interaction, payload);
  }

  // 10008: Unknown message (message was deleted by user or mod)
  if (code === 10008 || err.message?.includes('Unknown Message')) {
    logger.debug('Message was deleted, attempting channel fallback');
    return await fallbackDirectSend(interaction, payload, { skipMessageEdit: true });
  }

  // 50001 / 50013: Missing Access / Missing Permissions
  if (code === 50001 || code === 50013 || err.message?.includes('Missing Permissions') || err.message?.includes('Missing Access')) {
    logger.warn({ code }, 'Bot missing permissions to complete interaction');
    const permCard = sanitizePayload(errorCard({
      title: 'Missing Permissions',
      subtitle: 'The bot cannot complete this action.',
      reason: 'I lack the required Discord permissions in this channel/server.',
      fix: 'Please ask a server administrator to grant the bot Manage Messages, Send Messages, and View Channel permissions.',
      ephemeral: true
    }), true);

    return await fallbackDirectSend(interaction, permCard);
  }

  // 429: Rate Limit
  if (code === 429 || err.status === 429) {
    logger.warn({ retryAfter: err.retry_after }, 'Interaction hit rate limit, waiting on built-in discord.js retry');
    return null;
  }

  // Components V2 form body validation error
  if (err.rawError?.errors || err.message?.includes('Invalid Form Body')) {
    logger.error({ errors: err.rawError?.errors, payload }, 'Components V2 payload validation error, falling back to minimal card');
    const safeFallback = sanitizePayload(errorCard({
      title: 'Display Error',
      reason: 'Unable to render component container layout.',
      fix: 'Please report this layout issue to the bot administrators.',
      ephemeral: true
    }), true);
    return await fallbackDirectSend(interaction, safeFallback);
  }

  // Generic unhandled error fallback
  logger.error({ err, code }, 'Unhandled interaction error in safeRespond, triggering final fallback');
  return await fallbackDirectSend(interaction, payload);
}

/**
 * Fallback mechanism: tries message.edit(), channel.send(), and user DM.
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload
 * @param {object} [options]
 */
async function fallbackDirectSend(interaction, payload, { skipMessageEdit = false } = {}) {
  try {
    if (!skipMessageEdit && interaction.message?.editable && typeof interaction.message.edit === 'function') {
      return await interaction.message.edit(payload);
    }
  } catch (_) {}

  try {
    if (interaction.channel && typeof interaction.channel.send === 'function') {
      return await interaction.channel.send(payload);
    }
  } catch (_) {}

  try {
    if (interaction.user && typeof interaction.user.send === 'function') {
      return await interaction.user.send(payload);
    }
  } catch (_) {}

  return null;
}

export default {
  safeRespond,
  sanitizePayload
};

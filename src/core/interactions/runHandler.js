import { MessageFlags } from 'discord.js';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { logger } from '../../utils/logger.js';
import { logError } from '../../db/errors.js';
import { errorCard } from '../../ui/cards.js';
import { safeRespond } from './safeRespond.js';
import { isAcknowledged, markAcknowledged } from './tracker.js';
import { parseCustomId } from './session.js';

/**
 * Generates an alphanumeric error correlation ID (e.g. ERR-K8F2-9X4A)
 * @returns {string}
 */
export function generateErrorId() {
  const p1 = Date.now().toString(36).slice(-4).toUpperCase();
  const p2 = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `ERR-${p1}-${p2}`;
}

/**
 * Universal wrapper for all command and component handlers.
 * Guarantees sub-1s initial acknowledgement, cached checks, ownership validation,
 * error boundary isolation, and structured logging.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {Function} handler async (interaction, parsed) => any
 * @param {object} [meta={}]
 * @param {boolean} [meta.opensModal=false] True if handler responds with showModal()
 * @param {boolean} [meta.instant=false] True if response responds <500ms from cache without defer
 * @param {boolean} [meta.ephemeral=false] True if deferred reply should be ephemeral
 * @param {boolean} [meta.authorOnly=false] True if only original author can interact
 * @param {string} [meta.name='interaction'] Handler identifier name
 * @param {object} [meta.parsed=null] Pre-parsed customId payload
 * @returns {Promise<any>}
 */
export async function runHandler(interaction, handler, meta = {}) {
  const startTime = performance.now();
  const errorId = generateErrorId();
  const customId = interaction.customId || null;
  const commandName = interaction.commandName || null;
  const identifier = commandName ? `/${commandName}` : (customId || meta.name || 'interaction');

  // Parse customId if available
  const parsed = meta.parsed || (customId ? parseCustomId(customId) : {});

  // 1. Immediate Acknowledgement (Sub-1s, BEFORE DB / Heavy Logic)
  try {
    if (meta.opensModal) {
      // Modals CANNOT be shown after deferring: do not defer, handler must showModal immediately
    } else if (interaction.isChatInputCommand?.()) {
      if (!meta.instant && !isAcknowledged(interaction)) {
        await interaction.deferReply({
          flags: meta.ephemeral ? MessageFlags.Ephemeral : 0
        }).catch((err) => {
          logger.debug({ err: err.message }, 'deferReply skipped or already acknowledged');
        });
        markAcknowledged(interaction, 'deferReply');
      }
    } else if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) {
      if (!isAcknowledged(interaction)) {
        await interaction.deferUpdate().catch((err) => {
          logger.debug({ err: err.message }, 'deferUpdate skipped or already acknowledged');
        });
        markAcknowledged(interaction, 'deferUpdate');
      }
    } else if (interaction.isModalSubmit?.()) {
      if (!isAcknowledged(interaction)) {
        if (meta.ephemeral) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
          markAcknowledged(interaction, 'deferReply');
        } else {
          await interaction.deferUpdate().catch(() => {});
          markAcknowledged(interaction, 'deferUpdate');
        }
      }
    }
  } catch (ackErr) {
    logger.debug({ ackErr: ackErr.message, identifier }, 'Non-fatal acknowledgement error');
  }

  // 2. Ownership Verification
  // If authorOnly is declared, or if userId is encoded in customId (module:action:guildId:userId)
  const targetUserId = parsed.userId || interaction.message?.interaction?.user?.id;
  if ((meta.authorOnly || parsed.userId) && targetUserId && targetUserId !== interaction.user.id) {
    logger.debug({ targetUserId, clicker: interaction.user.id }, 'Blocked unowned component click');
    return await safeRespond(interaction, errorCard({
      title: 'Action Restricted',
      subtitle: 'This panel belongs to another user.',
      reason: 'You cannot click controls on another user\'s interactive session.',
      fix: 'Run the command yourself to open your own control panel.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // 3. Safe Execution with 10s Timeout Guard
  const handlerPromise = Promise.resolve().then(() => handler(interaction, parsed));

  const timeoutPromise = new Promise((_, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`HANDLER_TIMEOUT: Execution exceeded 10000ms limit`));
    }, 10000);
    if (timer.unref) timer.unref();
  });

  try {
    const result = await Promise.race([handlerPromise, timeoutPromise]);
    const duration = performance.now() - startTime;

    if (duration > 1000) {
      logger.warn({ identifier, durationMs: Math.round(duration) }, `⚠️ Handler took longer than 1.0s to complete`);
    }

    return result;
  } catch (err) {
    const duration = performance.now() - startTime;

    if (err.message?.startsWith('HANDLER_TIMEOUT')) {
      logger.error({ identifier, errorId, durationMs: Math.round(duration) }, 'Handler execution timed out at 10s');
      return await safeRespond(interaction, errorCard({
        title: 'Operation Timed Out',
        subtitle: `Reference: \`${errorId}\``,
        reason: 'The action took longer than 10 seconds to execute.',
        fix: 'Please try again in a few moments.',
        ephemeral: true
      }), { ephemeral: true });
    }

    // Log structured error
    logger.error({
      err: err.message,
      stack: err.stack,
      errorId,
      identifier,
      guildId: interaction.guildId,
      userId: interaction.user?.id,
      durationMs: Math.round(duration)
    }, `Handler failure in ${identifier}`);

    // Persist to error log database in background
    logError({
      scope: `handler:${identifier}`,
      message: `[${errorId}] ${err.message}`,
      stack: err.stack
    }).catch(() => {});

    // Always provide safe user feedback with the quoteable error ID
    return await safeRespond(interaction, errorCard({
      title: 'Execution Error',
      subtitle: `Error Reference: \`${errorId}\``,
      reason: 'An unexpected internal error occurred while processing this action.',
      fix: `Please try again or quote \`${errorId}\` to the support team.`,
      ephemeral: true
    }), { ephemeral: true });
  }
}

export default runHandler;

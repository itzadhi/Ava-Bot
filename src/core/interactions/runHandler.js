import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { logError } from '../../db/errors.js';
import { errorCard, infoCard } from '../../ui/cards.js';
import { safeRespond, wrapInteraction } from './safeRespond.js';
import { isAcknowledged, markAcknowledged } from './tracker.js';
import { checkPanelAccess, parseId } from './ownership.js';
import { metrics } from '../metrics.js';
import { runWithTrace, setAckDuration, summarizeTrace } from './trace.js';
import { getRunningJob } from '../jobs/jobManager.js';

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
 * @param {string} [meta.access] 'owner' | 'staff' | 'public' | 'participant'
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

  return runWithTrace({ id: interaction.id, identifier, customId, commandName }, async () => {
    let ackDurationMs = 0;

    // Parse customId using standardized parseId
    const parsed = meta.parsed || (customId ? parseId(customId) : {});

    // 1. Central Ownership & Access Verification (<0.01ms before deferring)
    const isComponent = interaction.isButton?.() || interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.();
    if (isComponent && (meta.access || meta.authorOnly || parsed.ownerId)) {
      const accessResult = await checkPanelAccess(interaction, {
        ...meta,
        parsed
      });

      if (!accessResult.allowed) {
        if (accessResult.reason === 'NOT_OWNER') {
          const ownerMention = accessResult.ownerId ? `<@${accessResult.ownerId}>` : 'the original user';
          return await safeRespond(interaction, errorCard({
            title: 'Not your panel',
            reason: `Only ${ownerMention} can use this panel. Run the command yourself to open your own.`,
            ephemeral: true
          }), { ephemeral: true });
        } else if (accessResult.reason === 'STAFF_ONLY') {
          return await safeRespond(interaction, errorCard({
            title: 'Staff only',
            reason: 'This action is restricted to server staff.',
            ephemeral: true
          }), { ephemeral: true });
        } else if (accessResult.reason === 'PARTICIPANT_ONLY') {
          return await safeRespond(interaction, errorCard({
            title: 'Access restricted',
            reason: 'Only the customer or server staff can use these controls.',
            ephemeral: true
          }), { ephemeral: true });
        } else {
          return await safeRespond(interaction, errorCard({
            title: 'Access restricted',
            reason: 'You do not have permission to use this panel.',
            ephemeral: true
          }), { ephemeral: true });
        }
      }
    }

    // 2. Immediate Acknowledgement (Sub-1s, BEFORE DB / Heavy Logic)
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
          ackDurationMs = performance.now() - startTime;
          metrics.recordAck(ackDurationMs);
          setAckDuration(ackDurationMs);
        }
      } else if (interaction.isButton?.() || interaction.isAnySelectMenu?.()) {
        if (!isAcknowledged(interaction)) {
          await interaction.deferUpdate().catch((err) => {
            logger.debug({ err: err.message }, 'deferUpdate skipped or already acknowledged');
          });
          markAcknowledged(interaction, 'deferUpdate');
          ackDurationMs = performance.now() - startTime;
          metrics.recordAck(ackDurationMs);
          setAckDuration(ackDurationMs);
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
          ackDurationMs = performance.now() - startTime;
          metrics.recordAck(ackDurationMs);
          setAckDuration(ackDurationMs);
        }
      }
    } catch (ackErr) {
      logger.debug({ ackErr: ackErr.message, identifier }, 'Non-fatal acknowledgement error');
    }

    // 3. Wrap interaction in protective proxy for legacy and modern handlers
    const safeInteraction = wrapInteraction(interaction);

    // 4. Safe Execution with Uniform 8s Hard Cap & AbortSignal
    const abortController = new AbortController();
    const timeoutMs = meta.timeoutMs || 8000;

    const handlerPromise = Promise.resolve().then(() => handler(safeInteraction, parsed, abortController.signal));

    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        abortController.abort();
        reject(new Error(`HANDLER_TIMEOUT: Execution exceeded ${timeoutMs}ms limit`));
      }, timeoutMs);
      if (timer.unref) timer.unref();
    });

    try {
      const result = await Promise.race([handlerPromise, timeoutPromise]);
      const duration = performance.now() - startTime;
      metrics.recordHandler(duration);

      const { summaryLine, topSlowSpans, totalMs, metrics: traceMetrics } = summarizeTrace();
      logger.info({
        interactionId: interaction.id,
        trace: traceMetrics,
        durationMs: Math.round(duration)
      }, `[TRACE] ${summaryLine}`);

      if (totalMs > 1000 && topSlowSpans.length > 0) {
        logger.warn({ identifier, totalMs, topSlowSpans }, `⚠️ Slow interaction (>1s): ${summaryLine}`);
      }

      return result;
    } catch (err) {
      const duration = performance.now() - startTime;
      metrics.recordHandler(duration);
      const code = err.code || err.rawError?.code || null;
      if (code) metrics.recordError(code);

      const { summaryLine, topSlowSpans, totalMs, metrics: traceMetrics } = summarizeTrace();
      logger.error({
        interactionId: interaction.id,
        trace: traceMetrics,
        errorId,
        err: err.message,
        durationMs: Math.round(duration)
      }, `[TRACE FAILED] ${summaryLine} - ${err.message}`);

      if (err.message?.startsWith('HANDLER_TIMEOUT')) {
        const hasJob = meta.hasJob || Boolean(getRunningJob(interaction.guildId, meta.jobType || parsed.action || commandName));
        if (hasJob) {
          return await safeRespond(safeInteraction, infoCard({
            title: 'Processing in Background',
            body: 'This operation is taking longer than usual and will finish in the background.\nYou can check its progress anytime.',
            ephemeral: true
          }), { ephemeral: true });
        }

        return await safeRespond(safeInteraction, errorCard({
          title: 'Operation Timed Out',
          subtitle: `Reference: \`${errorId}\``,
          reason: 'The action took longer than expected to execute.',
          fix: 'Please try again in a few moments.',
          ephemeral: true
        }), { ephemeral: true });
      }

      // Graceful expiration card for pre-reset or missing database records
      if (err.code === 'PGRST116' || err.message?.includes('expired') || err.message?.includes('not found')) {
        return await safeRespond(safeInteraction, errorCard({
          title: 'Panel Expired',
          reason: 'This panel expired, run the command again.',
          ephemeral: true
        }), { ephemeral: true });
      }

      // Persist to error log database in background
      logError({
        scope: `handler:${identifier}`,
        message: `[${errorId}] ${err.message}`,
        stack: err.stack
      }).catch(() => {});

      // Always provide safe user feedback with the quoteable error ID
      return await safeRespond(safeInteraction, errorCard({
        title: 'Execution Error',
        subtitle: `Error Reference: \`${errorId}\``,
        reason: 'An unexpected internal error occurred while processing this action.',
        fix: `Please try again or quote \`${errorId}\` to the support team.`,
        ephemeral: true
      }), { ephemeral: true });
    }
  });
}

export default runHandler;

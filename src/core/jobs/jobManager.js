import crypto from 'node:crypto';
import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  MessageFlags
} from 'discord.js';
import { db } from '../../db/index.js';
import { logger } from '../../utils/logger.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import PQueue from 'p-queue';

/**
 * Global background job queue:
 * Enforces a strict budget (~20-25 requests/sec) and concurrency of 6 workers
 * to ensure background tasks NEVER starve user-facing interactions.
 */
export const backgroundQueue = new PQueue({
  concurrency: 6,
  intervalCap: 25,
  interval: 1000
});

// In-memory registry of active job abort controllers and per-guild locks
// Map<jobId, { abortController: AbortController, lastProgressEdit: number, timer: any }>
const activeJobs = new Map();

// Per-guild mutex per operation type: `${guildId}:${type}` -> jobId
const guildOperationLocks = new Map();

// Throttle interval for message edits: 2500ms (at most one edit per 2.5s)
const PROGRESS_EDIT_THROTTLE_MS = 2500;

/**
 * Builds standard Components V2 progress card
 *
 * @param {object} params
 * @param {string} params.title
 * @param {object} params.progress { total: number, done: number, failed: number, percentage: number }
 * @param {number} [params.elapsedSeconds=0]
 * @param {string} [params.statusText='Processing...']
 * @param {Array} [params.buttons=[]]
 * @returns {object} Components V2 message payload
 */
export function buildProgressCard({
  title,
  progress = { total: 0, done: 0, failed: 0, percentage: 0 },
  elapsedSeconds = 0,
  statusText = 'In progress...',
  buttons = []
}) {
  const container = new ContainerBuilder();
  const pct = Math.min(100, Math.max(0, Math.round(progress.percentage || 0)));
  const filledBlocks = Math.round(pct / 10);
  const emptyBlocks = 10 - filledBlocks;
  const bar = `${'▰'.repeat(filledBlocks)}${'▱'.repeat(emptyBlocks)} ${pct}%`;

  const lines = [
    `## ⚙️ ${title}`,
    `\`${bar}\` • **${progress.done || 0} / ${progress.total || 0}** complete`,
    ``,
    `- **Status:** ${statusText}`,
    `- **Elapsed Time:** \`${elapsedSeconds}s\``,
    progress.failed > 0 ? `- **Failed Items:** \`${progress.failed}\`` : null
  ].filter(Boolean).join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  if (buttons.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const row = new ActionRowBuilder().addComponents(buttons.slice(0, 5));
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Acquires a per-guild mutex for an operation type
 * @param {string} guildId
 * @param {string} type
 * @param {string} jobId
 * @returns {boolean} True if lock acquired, false if already busy
 */
export function acquireGuildLock(guildId, type, jobId) {
  const lockKey = `${guildId}:${type}`;
  if (guildOperationLocks.has(lockKey)) {
    return false;
  }
  guildOperationLocks.set(lockKey, jobId);
  return true;
}

/**
 * Releases a per-guild mutex
 * @param {string} guildId
 * @param {string} type
 */
export function releaseGuildLock(guildId, type) {
  const lockKey = `${guildId}:${type}`;
  guildOperationLocks.delete(lockKey);
}

/**
 * Checks whether a job of this type is already running for this guild
 * @param {string} guildId
 * @param {string} type
 * @returns {string|null} jobId if running, null if idle
 */
export function getRunningJob(guildId, type) {
  const lockKey = `${guildId}:${type}`;
  return guildOperationLocks.get(lockKey) || null;
}

/**
 * Creates and persists a new background job
 *
 * @param {object} params
 * @param {string} params.guildId
 * @param {string} params.type
 * @param {object} [params.payload={}]
 * @param {string} [params.messageId]
 * @param {string} [params.channelId]
 * @returns {Promise<object>}
 */
export async function createJob({ guildId, type, payload = {}, messageId = null, channelId = null }) {
  const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();

  // Enforce per-guild operation mutex
  if (!acquireGuildLock(guildId, type, jobId)) {
    const existingId = getRunningJob(guildId, type);
    throw new Error(`JOB_LOCK_BUSY: An operation of type "${type}" is already in progress for guild ${guildId} (Job: ${existingId})`);
  }

  const jobRecord = {
    id: jobId,
    guild_id: guildId,
    type,
    state: 'queued',
    payload: {
      ...payload,
      messageId,
      channelId
    },
    progress: { total: 0, done: 0, failed: 0, percentage: 0 },
    attempts: 0,
    last_error: null,
    locked_by: process.pid.toString(),
    heartbeat_at: now,
    created_at: now,
    finished_at: null
  };

  const { error } = await db.from('ava_jobs').insert(jobRecord);
  if (error) {
    releaseGuildLock(guildId, type);
    logger.warn({ error: error.message, jobId }, 'Error persisting job in ava_jobs table, proceeding with memory tracking');
  }

  const abortController = new AbortController();
  activeJobs.set(jobId, {
    record: jobRecord,
    abortController,
    lastProgressEdit: 0,
    startTime: Date.now()
  });

  return jobRecord;
}

/**
 * Starts execution of a persisted job with automatic heartbeat and error handling
 *
 * @param {string} jobId
 * @param {import('discord.js').Client} client
 * @param {Function} workerFn async ({ job, signal, updateProgress, client }) => any
 */
export function enqueueJobExecution(jobId, client, workerFn) {
  const active = activeJobs.get(jobId);
  if (!active) return;

  backgroundQueue.add(async () => {
    const { record, abortController } = active;
    record.state = 'running';
    record.attempts++;

    // Heartbeat ticker running every 30 seconds
    const heartbeatTimer = setInterval(async () => {
      try {
        await db.from('ava_jobs').update({
          heartbeat_at: new Date().toISOString()
        }).eq('id', jobId);
      } catch (_) {}
    }, 30000);
    if (heartbeatTimer.unref) heartbeatTimer.unref();

    try {
      await db.from('ava_jobs').update({
        state: 'running',
        attempts: record.attempts,
        heartbeat_at: new Date().toISOString()
      }).eq('id', jobId);

      logger.info({ jobId, type: record.type, guildId: record.guild_id }, `Starting background job ${jobId}`);

      const result = await workerFn({
        job: record,
        signal: abortController.signal,
        client,
        updateProgress: async (progressUpdates, statusText, editButtons) => {
          return await updateJobProgress(jobId, client, progressUpdates, statusText, editButtons);
        }
      });

      // Complete Job
      clearInterval(heartbeatTimer);
      await finishJob(jobId, client, 'completed', null, result);
    } catch (err) {
      clearInterval(heartbeatTimer);
      if (abortController.signal.aborted || err.name === 'AbortError') {
        logger.info({ jobId }, `Job ${jobId} was cancelled cleanly`);
        await finishJob(jobId, client, 'cancelled', 'Cancelled by user or system');
      } else {
        logger.error({ jobId, err: err.message, stack: err.stack }, `Job ${jobId} failed with error`);
        await finishJob(jobId, client, 'failed', err.message);
      }
    }
  });
}

/**
 * Updates job progress in database and throttles message edits (2.5s) via message ID
 *
 * @param {string} jobId
 * @param {import('discord.js').Client} client
 * @param {object} progress
 * @param {string} [statusText]
 * @param {Array} [buttons]
 */
export async function updateJobProgress(jobId, client, progress = {}, statusText = 'Processing...', buttons = []) {
  const active = activeJobs.get(jobId);
  if (!active) return;

  const now = Date.now();
  const record = active.record;
  const mergedProgress = {
    ...record.progress,
    ...progress
  };
  if (mergedProgress.total > 0) {
    mergedProgress.percentage = Math.round((mergedProgress.done / mergedProgress.total) * 100);
  }
  record.progress = mergedProgress;

  // 1. Update database periodically
  db.from('ava_jobs').update({
    progress: mergedProgress,
    heartbeat_at: new Date().toISOString()
  }).eq('id', jobId).catch(() => {});

  // 2. Throttle Discord message edit (at most once every 2.5s)
  if (now - active.lastProgressEdit < PROGRESS_EDIT_THROTTLE_MS) {
    return;
  }
  active.lastProgressEdit = now;

  const messageId = record.payload?.messageId;
  const channelId = record.payload?.channelId;
  if (!messageId || !channelId || !client) return;

  try {
    const channel = client.channels.cache.get(channelId) || await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') return;

    const elapsedSeconds = Math.round((now - active.startTime) / 1000);
    const title = record.type.replace(/_/g, ' ').toUpperCase();
    const payload = buildProgressCard({
      title,
      progress: mergedProgress,
      elapsedSeconds,
      statusText,
      buttons
    });

    // Edit message strictly by message ID via REST, never interaction token!
    await channel.messages.edit(messageId, payload).catch((editErr) => {
      logger.debug({ editErr: editErr.message, jobId, messageId }, 'Throttled progress message edit skipped');
    });
  } catch (err) {
    logger.debug({ err: err.message, jobId }, 'Non-fatal error in job progress card edit');
  }
}

/**
 * Finalizes job status and performs final message update
 */
async function finishJob(jobId, client, state, error = null, result = null) {
  const active = activeJobs.get(jobId);
  const now = new Date().toISOString();

  if (active) {
    const record = active.record;
    record.state = state;
    record.finished_at = now;
    record.last_error = error;

    releaseGuildLock(record.guild_id, record.type);

    // Final message edit
    const messageId = record.payload?.messageId;
    const channelId = record.payload?.channelId;
    if (messageId && channelId && client) {
      try {
        const channel = client.channels.cache.get(channelId);
        if (channel && channel.isTextBased?.()) {
          const title = record.type.replace(/_/g, ' ').toUpperCase();
          const finalStatus = state === 'completed' ? '🟢 **Completed successfully**' : state === 'cancelled' ? '⚪ **Cancelled**' : `🔴 **Failed:** ${error || 'Unknown error'}`;
          const finalPayload = buildProgressCard({
            title: `${title} - ${state.toUpperCase()}`,
            progress: record.progress,
            elapsedSeconds: Math.round((Date.now() - active.startTime) / 1000),
            statusText: finalStatus,
            buttons: []
          });
          await channel.messages.edit(messageId, finalPayload).catch(() => {});
        }
      } catch (_) {}
    }

    activeJobs.delete(jobId);
  }

  await db.from('ava_jobs').update({
    state,
    last_error: error,
    finished_at: now
  }).eq('id', jobId).catch(() => {});
}

/**
 * Resumes unfinished jobs on startup and starts watchdog
 * @param {import('discord.js').Client} client
 */
export async function resumeUnfinishedJobs(client) {
  try {
    const { data: stalledJobs } = await db.from('ava_jobs')
      .select('*')
      .in('state', ['queued', 'running']);

    if (!stalledJobs || stalledJobs.length === 0) return;

    logger.info({ count: stalledJobs.length }, 'Scanning unfinished background jobs for recovery');

    for (const job of stalledJobs) {
      // If heartbeat is older than 5 minutes, mark as stalled/failed with recovery option
      const heartbeat = job.heartbeat_at ? new Date(job.heartbeat_at).getTime() : 0;
      const isDead = (Date.now() - heartbeat) > 5 * 60 * 1000;

      if (isDead) {
        logger.warn({ jobId: job.id, type: job.type }, 'Found stalled job older than 5m, marking failed');
        await db.from('ava_jobs').update({
          state: 'failed',
          last_error: 'Server restarted or process terminated during execution',
          finished_at: new Date().toISOString()
        }).eq('id', job.id);
      }
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Error resuming unfinished jobs');
  }
}

/**
 * Watchdog running every 60s to detect crashed background jobs
 */
export function startJobWatchdog(client) {
  const interval = setInterval(async () => {
    try {
      const now = Date.now();
      for (const [jobId, active] of activeJobs.entries()) {
        const lastEdit = active.lastProgressEdit;
        // If an active job in memory hasn't reported progress or heartbeat in 3 minutes
        if (now - active.startTime > 300000 && (now - lastEdit > 180000)) {
          logger.warn({ jobId, type: active.record.type }, 'Watchdog detected non-responsive background job');
        }
      }
    } catch (_) {}
  }, 60000);

  if (interval.unref) interval.unref();
  return interval;
}

export default {
  createJob,
  enqueueJobExecution,
  updateJobProgress,
  acquireGuildLock,
  releaseGuildLock,
  getRunningJob,
  buildProgressCard,
  resumeUnfinishedJobs,
  startJobWatchdog
};

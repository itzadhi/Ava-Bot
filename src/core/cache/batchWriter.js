import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Batched and debounced asynchronous writer for high-frequency database writes
 * (channel snapshots, activity counters, audit logs, error logs).
 */
class BatchWriter {
  constructor() {
    /** @type {Map<string, Map<string, object>>} table -> (key -> row) */
    this.buffer = new Map();
    this.flushIntervalMs = 3000; // 3 seconds debounce

    this.timer = setInterval(() => {
      this.flushAll().catch(err => {
        logger.error({ err }, 'Error during scheduled batch flush');
      });
    }, this.flushIntervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Enqueues an upsert operation into the batch buffer.
   * If a record with the same unique key is already queued, merges updates.
   *
   * @param {string} table
   * @param {string} primaryKeyField e.g. 'id' or 'guild_id'
   * @param {object} row
   */
  enqueueUpsert(table, primaryKeyField, row) {
    if (!this.buffer.has(table)) {
      this.buffer.set(table, new Map());
    }

    const tableBuffer = this.buffer.get(table);
    const key = row[primaryKeyField] || `${row.guild_id || ''}:${row.channel_id || ''}:${row.user_id || ''}:${Date.now()}`;

    const existing = tableBuffer.get(key) || {};
    tableBuffer.set(key, { ...existing, ...row });
  }

  /**
   * Flushes all buffered writes to the database in bulk upserts.
   */
  async flushAll() {
    if (this.buffer.size === 0) return;

    const tablesToFlush = Array.from(this.buffer.entries());
    this.buffer.clear();

    for (const [table, recordsMap] of tablesToFlush) {
      const records = Array.from(recordsMap.values());
      if (records.length === 0) continue;

      try {
        const { error } = await queryWithTimeout(async () => {
          return await db.from(table).upsert(records);
        }, 5000);

        if (error) {
          logger.warn({ error, table, count: records.length }, 'Failed to bulk upsert batched writes, retrying once');
          // Retry once on failure
          await db.from(table).upsert(records).catch(retryErr => {
            logger.error({ retryErr, table }, 'Retry failed for batched writes');
          });
        } else {
          logger.debug({ table, count: records.length }, 'Successfully flushed batched writes');
        }
      } catch (err) {
        logger.error({ err, table }, 'Exception flushing batch buffer');
      }
    }
  }

  /**
   * Destroys the interval timer on shutdown and flushes all remaining items.
   */
  async destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flushAll();
  }
}

/**
 * Wraps a database query function with a timeout (default 5000ms)
 * @param {Function} queryFn
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<any>}
 */
export async function queryWithTimeout(queryFn, timeoutMs = 5000) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`DB_QUERY_TIMEOUT: Query exceeded ${timeoutMs}ms limit`));
    }, timeoutMs);
    if (timer.unref) timer.unref();
  });

  try {
    const result = await Promise.race([queryFn(), timeoutPromise]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Executes a query with a 5s timeout and 1 automatic retry on transient error.
 * @param {Function} queryFn
 * @param {number} [timeoutMs=5000]
 * @returns {Promise<any>}
 */
export async function queryWithRetry(queryFn, timeoutMs = 5000) {
  try {
    return await queryWithTimeout(queryFn, timeoutMs);
  } catch (err) {
    logger.debug({ err: err.message }, 'Transient query error, attempting single retry');
    return await queryWithTimeout(queryFn, timeoutMs);
  }
}

export const batchWriter = new BatchWriter();
export default batchWriter;

import PQueue from 'p-queue';
import { logger } from '../utils/logger.js';

/**
 * Global rate-limit-safe queue for restore, sync, broadcast, and chatlog operations
 * Respects Discord rate limits with automatic exponential backoff
 */
export const queue = new PQueue({
  concurrency: 5,
  intervalCap: 50,
  interval: 1000
});

if (typeof queue.onRateLimit === 'function') {
  queue.onRateLimit(() => {
    logger.warn('Rate limit hit on job queue, throttling...');
  });
}

/**
 * Adds an async job to the queue with automatic exponential backoff on 429
 * @param {Function} task 
 * @param {object} options 
 * @returns {Promise<any>}
 */
export async function addJob(task, { retries = 3, priority = 0 } = {}) {
  return queue.add(async () => {
    let attempt = 0;
    while (attempt <= retries) {
      try {
        return await task();
      } catch (err) {
        attempt++;
        const isRateLimit = err.status === 429 || err.code === 429 || err.message?.includes('rate limit');
        if (isRateLimit && attempt <= retries) {
          const retryAfter = (err.retryAfter ? err.retryAfter * 1000 : Math.pow(2, attempt) * 1000) + Math.random() * 500;
          logger.warn(`Rate limit encountered, backing off for ${Math.round(retryAfter)}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, retryAfter));
        } else {
          throw err;
        }
      }
    }
  }, { priority });
}

export default queue;

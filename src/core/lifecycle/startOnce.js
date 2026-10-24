import { logger } from '../../utils/logger.js';

const startedRegistry = new Map();
let duplicateStartsCount = 0;

/**
 * Idempotent execution wrapper for bot lifecycle hooks, schedulers, and loaders.
 * Guarantees that a function registered under `key` only executes once across the process lifecycle.
 *
 * @param {string} key - Unique identifier for the task/scheduler (e.g. 'scheduler', 'tickets:scheduler', 'cache:antinuke')
 * @param {Function} fn - Async or sync initialization function
 * @returns {Promise<any>} Result of the initialization function
 */
export async function startOnce(key, fn) {
  if (!key || typeof key !== 'string') {
    throw new Error('[startOnce] A non-empty string key is required');
  }

  if (startedRegistry.has(key)) {
    duplicateStartsCount++;
    logger.debug({ key }, `[STARTUP   ] Prevented duplicate execution for "${key}" (duplicate count: ${duplicateStartsCount})`);
    return startedRegistry.get(key);
  }

  if (typeof fn !== 'function') {
    throw new Error(`[startOnce] An executable function is required for key "${key}"`);
  }

  try {
    const promiseOrValue = fn();
    // Save reference (handles both sync and async)
    const result = promiseOrValue instanceof Promise ? await promiseOrValue : promiseOrValue;
    startedRegistry.set(key, result ?? true);
    return result;
  } catch (err) {
    logger.error({ key, err }, `[STARTUP   ] Failed during initial execution of "${key}"`);
    throw err;
  }
}

/**
 * Checks whether a given key has already been executed
 * @param {string} key
 * @returns {boolean}
 */
export function hasStarted(key) {
  return startedRegistry.has(key);
}

/**
 * Returns the total count of prevented duplicate start attempts
 * @returns {number}
 */
export function getDuplicateStartsCount() {
  return duplicateStartsCount;
}

/**
 * Returns all keys that have successfully run through startOnce
 * @returns {string[]}
 */
export function getStartedKeys() {
  return Array.from(startedRegistry.keys());
}

/**
 * Resets the startup registry and duplicate count (primarily for test harnesses)
 */
export function resetStartRegistry() {
  startedRegistry.clear();
  duplicateStartsCount = 0;
}

/**
 * Prints the required startup completion line
 * Example: "Duplicate starts: 0"
 */
export function printStartupCheck() {
  const count = getDuplicateStartsCount();
  const level = count === 0 ? 'info' : 'warn';
  logger[level](`Duplicate starts: ${count}`);
  return count;
}

export default {
  startOnce,
  hasStarted,
  getDuplicateStartsCount,
  getStartedKeys,
  resetStartRegistry,
  printStartupCheck
};

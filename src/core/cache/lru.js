/**
 * High-performance Least-Recently-Used (LRU) Cache with Time-To-Live (TTL).
 * Ensures memory cannot grow unboundedly while providing O(1) reads and writes.
 */
export class LRUCache {
  /**
   * @param {object} options
   * @param {number} [options.maxSize=1000] Maximum number of keys to retain
   * @param {number} [options.ttlMs=300000] Expiry in milliseconds (default 5 minutes)
   */
  constructor({ maxSize = 1000, ttlMs = 5 * 60 * 1000 } = {}) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.cache = new Map();
  }

  /**
   * Retrieves an item from the cache. Updates recency.
   * @param {string} key
   * @returns {any|null}
   */
  get(key) {
    if (!key) return null;
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh recency by re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  /**
   * Sets or updates an item in the cache. Evicts oldest when exceeding maxSize.
   * @param {string} key
   * @param {any} value
   * @param {number} [customTtlMs]
   */
  set(key, value, customTtlMs = null) {
    if (!key) return;
    const ttl = customTtlMs || this.ttlMs;
    const expiresAt = Date.now() + ttl;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Evict oldest (first item in Map iteration order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { value, expiresAt });
  }

  /**
   * Checks if an unexpired key exists in cache
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Deletes a key from the cache
   * @param {string} key
   * @returns {boolean}
   */
  delete(key) {
    return this.cache.delete(key);
  }

  /**
   * Clears the entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Current number of active entries
   * @returns {number}
   */
  get size() {
    return this.cache.size;
  }
}

export default LRUCache;

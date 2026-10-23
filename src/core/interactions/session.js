import crypto from 'node:crypto';
import { logger } from '../../utils/logger.js';

/**
 * Session entry schema
 * @typedef {Object} SessionEntry
 * @property {string} id
 * @property {string} module
 * @property {string} guildId
 * @property {string} userId
 * @property {any} data
 * @property {number} createdAt
 * @property {number} expiresAt
 */

class SessionStore {
  constructor() {
    /** @type {Map<string, SessionEntry>} */
    this.sessions = new Map();
    this.defaultTTL = 30 * 60 * 1000; // 30 minutes

    // Background sweeper running every 2 minutes
    this.sweepInterval = setInterval(() => {
      this.sweep();
    }, 2 * 60 * 1000);

    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  /**
   * Generates a short, collision-resistant session key (8 chars)
   * @returns {string}
   */
  generateKey() {
    return crypto.randomBytes(4).toString('hex');
  }

  /**
   * Creates or registers a session
   * @param {object} params
   * @param {string} params.module
   * @param {string} params.guildId
   * @param {string} params.userId
   * @param {any} params.data
   * @param {string} [params.key] Optional custom key
   * @param {number} [params.ttlMs]
   * @returns {SessionEntry}
   */
  createSession({ module, guildId, userId, data, key = null, ttlMs = null }) {
    const sessionId = key || this.generateKey();
    const ttl = ttlMs || this.defaultTTL;
    const now = Date.now();

    const entry = {
      id: sessionId,
      module,
      guildId,
      userId,
      data: data || {},
      createdAt: now,
      expiresAt: now + ttl
    };

    this.sessions.set(sessionId, entry);
    return entry;
  }

  /**
   * Retrieves a session by key, returning null if expired or missing
   * @param {string} sessionId
   * @returns {SessionEntry|null}
   */
  getSession(sessionId) {
    if (!sessionId) return null;
    const entry = this.sessions.get(sessionId);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.sessions.delete(sessionId);
      return null;
    }

    return entry;
  }

  /**
   * Updates data or extends TTL for an existing session
   * @param {string} sessionId
   * @param {object|Function} updates
   * @param {number} [extendTtlMs]
   * @returns {SessionEntry|null}
   */
  updateSession(sessionId, updates, extendTtlMs = null) {
    const entry = this.getSession(sessionId);
    if (!entry) return null;

    if (typeof updates === 'function') {
      entry.data = updates(entry.data);
    } else if (typeof updates === 'object' && updates !== null) {
      entry.data = { ...entry.data, ...updates };
    }

    if (extendTtlMs) {
      entry.expiresAt = Date.now() + extendTtlMs;
    }

    return entry;
  }

  /**
   * Deletes a session explicitly (e.g. on panel close or completion)
   * @param {string} sessionId
   * @returns {boolean}
   */
  deleteSession(sessionId) {
    return this.sessions.delete(sessionId);
  }

  /**
   * Sweeps expired sessions from memory
   */
  sweep() {
    const now = Date.now();
    let swept = 0;
    for (const [key, entry] of this.sessions.entries()) {
      if (now > entry.expiresAt) {
        this.sessions.delete(key);
        swept++;
      }
    }
    if (swept > 0) {
      logger.debug({ swept, remaining: this.sessions.size }, 'Swept expired sessions');
    }
  }

  /**
   * Constructs a formatted customId adhering to the 100 character limit:
   * Format: `mod:action:guildId:userId:payload`
   * @param {object} params
   * @param {string} params.module Short module name (e.g. 'dash', 'tkt', 'an', 'am', 'help')
   * @param {string} params.action Action identifier (e.g. 'page', 'toggle', 'open')
   * @param {string} [params.guildId=''] Discord Guild Snowflake
   * @param {string} [params.userId=''] Discord User Snowflake
   * @param {string} [params.payload=''] Short payload or session key
   * @returns {string}
   */
  buildCustomId({ module, action, guildId = '', userId = '', payload = '' }) {
    const raw = `${module}:${action}:${guildId}:${userId}:${payload}`;
    if (raw.length > 100) {
      // If length exceeds 100 characters, compress guild/user/payload
      const shortKey = this.generateKey();
      this.createSession({
        module,
        guildId,
        userId,
        data: { fullPayload: payload },
        key: shortKey,
        ttlMs: 60 * 60 * 1000
      });
      const fallbackId = `${module}:${action}:::${shortKey}`;
      if (fallbackId.length > 100) {
        return fallbackId.slice(0, 100);
      }
      return fallbackId;
    }
    return raw;
  }

  /**
   * Parses a customId into its constituent components
   * @param {string} customId
   * @returns {{ module: string, action: string, guildId: string, userId: string, payload: string, raw: string }}
   */
  parseCustomId(customId) {
    if (!customId || typeof customId !== 'string') {
      return { module: '', action: '', guildId: '', userId: '', ownerId: '', payload: '', key: '', raw: '' };
    }

    const parts = customId.split(':');
    const owner = parts[3] || '';
    const key = parts.slice(4).join(':') || '';
    return {
      module: parts[0] || '',
      action: parts[1] || '',
      guildId: parts[2] || '',
      userId: owner,
      ownerId: owner,
      payload: key,
      key,
      raw: customId
    };
  }

  /**
   * Destroys the sweeper timer for testing or shutdown
   */
  destroy() {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    this.sessions.clear();
  }
}

export const sessionStore = new SessionStore();

export function parseCustomId(customId) {
  return sessionStore.parseCustomId(customId);
}

export function buildCustomId(params) {
  return sessionStore.buildCustomId(params);
}

export default sessionStore;


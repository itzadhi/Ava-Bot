import { logger } from '../../utils/logger.js';

/**
 * Session storage and concurrency lock for Permify permission wizards.
 * Enforces one active wizard per guild, 15-minute inactivity timeouts, and caller authorization.
 */

const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

/** @type {Map<string, object>} guildId -> session */
const sessions = new Map();

/**
 * Creates and initializes a new permify session with guild lock
 *
 * @param {object} params
 * @param {string} params.guildId
 * @param {string} params.userId
 * @param {string} params.channelId
 * @param {string} [params.messageId]
 * @returns {object} Session state object
 */
export function createSession({ guildId, userId, channelId, messageId = null }) {
  // Clear any pre-existing session for this guild
  if (sessions.has(guildId)) {
    endSession(guildId);
  }

  const session = {
    guildId,
    userId,
    channelId,
    messageId,
    step: 1,
    status: 'active', // 'active' | 'applying' | 'completed' | 'cancelled'
    includeCustomOverwrites: true,
    staffCategoryIds: [],
    staffChannelIds: [],
    staffRoleIds: [],
    memberRoleIds: [],
    ownerRoleIds: [],
    hideEveryone: true,
    connectAutorole: true,
    backfillMembers: false,
    categoryPage: 1,
    channelPage: 1,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    timer: null
  };

  armInactivityTimer(session);
  sessions.set(guildId, session);
  return session;
}

/**
 * Retrieves the active session for a guild
 * @param {string} guildId
 * @returns {object|null}
 */
export function getSession(guildId) {
  if (!guildId) return null;
  return sessions.get(guildId) || null;
}

/**
 * Checks whether a guild currently has an active or applying wizard session
 * @param {string} guildId
 * @returns {boolean}
 */
export function isGuildLocked(guildId) {
  const session = getSession(guildId);
  if (!session) return false;
  return session.status === 'active' || session.status === 'applying';
}

/**
 * Checks if the interacting user is the session creator
 * @param {string} guildId
 * @param {string} userId
 * @returns {boolean}
 */
export function isUserSessionOwner(guildId, userId) {
  const session = getSession(guildId);
  if (!session) return false;
  return session.userId === userId;
}

/**
 * Updates session fields and refreshes the inactivity timer
 * @param {string} guildId
 * @param {object} updates
 * @returns {object|null}
 */
export function updateSession(guildId, updates = {}) {
  const session = getSession(guildId);
  if (!session) return null;

  Object.assign(session, updates, { lastActiveAt: Date.now() });
  armInactivityTimer(session);
  return session;
}

/**
 * Arms or resets the 15-minute inactivity timer
 * @param {object} session
 */
function armInactivityTimer(session) {
  if (session.timer) {
    clearTimeout(session.timer);
  }

  session.timer = setTimeout(() => {
    logger.info({ guildId: session.guildId, userId: session.userId }, 'Permify session expired due to inactivity');
    endSession(session.guildId);
  }, INACTIVITY_TIMEOUT_MS);

  // Unref timer so it does not block Node process exit if running tests
  if (session.timer?.unref) {
    session.timer.unref();
  }
}

/**
 * Ends and cleans up a session
 * @param {string} guildId
 */
export function endSession(guildId) {
  const session = sessions.get(guildId);
  if (session) {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    session.status = 'completed';
    sessions.delete(guildId);
  }
}

/**
 * Clears all active sessions (used during shutdowns and test isolation)
 */
export function clearAllSessions() {
  for (const [guildId, session] of sessions.entries()) {
    if (session.timer) clearTimeout(session.timer);
  }
  sessions.clear();
}

export default {
  createSession,
  getSession,
  isGuildLocked,
  isUserSessionOwner,
  updateSession,
  endSession,
  clearAllSessions
};

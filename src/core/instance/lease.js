import os from 'node:os';
import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { detectEnvironment } from '../logger/style.js';

let isLeaderFlag = false;
let currentGeneration = 0;
let renewTimer = null;
const LEASE_KEY = 'ava:leader';
const LEASE_TTL_SECONDS = 30;
const RENEW_INTERVAL_MS = 10000;

export const holderId = `inst_${os.hostname()}_${process.pid}_${Date.now().toString(36)}`;

export function getInstanceRole() {
  return (process.env.INSTANCE_ROLE || (detectEnvironment() === 'Pterodactyl' ? 'prod' : 'dev')).toLowerCase();
}

/**
 * Validates local token safety:
 * Refuses production tokens in local environment unless explicitly overridden.
 *
 * @param {string} token
 * @returns {{ allowed: boolean, reason?: string, effectiveToken: string }}
 */
export function validateTokenSafety(token) {
  const env = detectEnvironment();
  const devToken = process.env.DEV_DISCORD_TOKEN;
  const allowProdLocal = process.env.ALLOW_PROD_TOKEN_LOCAL === 'true';
  const role = getInstanceRole();

  // If running on Pterodactyl, always allow
  if (env === 'Pterodactyl') {
    return { allowed: true, effectiveToken: token };
  }

  // If running locally with dev token available, use it
  if (devToken && devToken.trim().length > 0) {
    logger.info('[STARTUP   ] Local environment detected: Using DEV_DISCORD_TOKEN for safe execution.');
    return { allowed: true, effectiveToken: devToken };
  }

  // If running locally with production role or default token
  if (!allowProdLocal && role !== 'dev') {
    const msg = 'Local run detected with production role/token. Refusing login to prevent dual-instance conflict with panel. Set ALLOW_PROD_TOKEN_LOCAL=true or provide DEV_DISCORD_TOKEN.';
    logger.error(`[STARTUP   ] ${msg}`);
    return { allowed: false, reason: msg, effectiveToken: token };
  }

  return { allowed: true, effectiveToken: token };
}

/**
 * Attempts to acquire the single-instance leadership lease via Supabase RPC ava_acquire_lease.
 * Fenced with monotonically incrementing generation number.
 *
 * @returns {Promise<{ isLeader: boolean, generation: number, conflictingInstance?: object }>}
 */
export async function acquireInstanceLease() {
  const hostInfo = `${os.hostname()} (${os.platform()})`;
  const pid = process.pid;
  const role = getInstanceRole();

  try {
    const { data, error } = await db.rpc('ava_acquire_lease', {
      p_lease_key: LEASE_KEY,
      p_holder_id: holderId,
      p_role: role,
      p_host_info: hostInfo,
      p_pid: pid,
      p_ttl_seconds: LEASE_TTL_SECONDS
    });

    if (error) {
      logger.warn({ error: error.message }, '[STARTUP   ] Lease acquisition RPC error; falling back to leader mode (offline/dev)');
      isLeaderFlag = true;
      currentGeneration = 1;
      return { isLeader: true, generation: 1 };
    }

    if (data?.acquired) {
      isLeaderFlag = true;
      currentGeneration = Number(data.generation);
      logger.info(`[STARTUP   ] Leadership lease acquired (generation ${currentGeneration}, role: ${role})`);
      startRenewTimer();
      return { isLeader: true, generation: currentGeneration };
    }

    // Another instance holds the lease
    isLeaderFlag = false;
    currentGeneration = Number(data?.generation || 0);

    const otherHost = data?.host || 'unknown';
    const otherPid = data?.pid || 0;
    const otherRole = data?.role || 'prod';
    const otherSeen = data?.last_seen ? new Date(data.last_seen).toLocaleTimeString() : 'recently';

    logger.warn(`[STARTUP   ] Another live instance exists: host=${otherHost}, pid=${otherPid}, role=${otherRole}, last seen=${otherSeen}`);
    return {
      isLeader: false,
      generation: currentGeneration,
      conflictingInstance: data
    };
  } catch (err) {
    logger.warn({ err: err.message }, '[STARTUP   ] Exception during lease acquisition; assuming leader for single run');
    isLeaderFlag = true;
    currentGeneration = 1;
    return { isLeader: true, generation: 1 };
  }
}

/**
 * Starts periodic lease renewal heartbeat
 */
function startRenewTimer() {
  if (renewTimer) clearInterval(renewTimer);

  renewTimer = setInterval(async () => {
    if (!isLeaderFlag) return;
    try {
      const { data: renewed } = await db.rpc('ava_renew_lease', {
        p_lease_key: LEASE_KEY,
        p_holder_id: holderId,
        p_generation: currentGeneration,
        p_ttl_seconds: LEASE_TTL_SECONDS
      });

      if (!renewed) {
        logger.error('[STARTUP   ] Leadership lease renewal failed: generation fencing mismatch or lease superseded by another instance.');
        isLeaderFlag = false;
        clearInterval(renewTimer);
      }
    } catch (_) {}
  }, RENEW_INTERVAL_MS);

  if (renewTimer.unref) renewTimer.unref();
}

/**
 * Gracefully releases leadership lease upon process shutdown
 */
export async function releaseInstanceLease() {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }

  if (!isLeaderFlag) return false;

  try {
    const { data: released, error } = await db.rpc('ava_release_lease', {
      p_lease_key: LEASE_KEY,
      p_holder_id: holderId,
      p_generation: currentGeneration
    });
    isLeaderFlag = false;
    logger.info('[STARTUP   ] Leadership lease released gracefully');
    if (error) return true; // clean local release on fallback mode
    return Boolean(released);
  } catch (_) {
    isLeaderFlag = false;
    return true;
  }
}

// Attach clean release to process termination signals
process.once('SIGINT', () => releaseInstanceLease());
process.once('SIGTERM', () => releaseInstanceLease());

export function isLeader() {
  return isLeaderFlag;
}

export function getFencingGeneration() {
  return currentGeneration;
}

export default {
  holderId,
  validateTokenSafety,
  acquireInstanceLease,
  releaseInstanceLease,
  isLeader,
  getFencingGeneration,
  getInstanceRole
};

import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

// Local in-memory caches
const rolesCache = new Map();
const ROLES_CACHE_TTL = 60 * 1000; // 60 seconds

function getMemTable(tableName) {
  if (!memoryDb.tables) memoryDb.tables = {};
  if (!memoryDb.tables[tableName]) {
    memoryDb.tables[tableName] = new Map();
  }
  return memoryDb.tables[tableName];
}

/**
 * Saves a snapshot of current channel & category overwrites before rebuilding
 * Automatically enforces a maximum history of 3 snapshots per guild.
 *
 * @param {string} guildId
 * @param {string} userId
 * @param {object} snapshotData
 * @returns {Promise<object>} Saved snapshot record
 */
export async function saveSnapshot(guildId, userId, snapshotData) {
  const timestamp = new Date().toISOString();
  const record = {
    guild_id: guildId,
    created_by: userId,
    created_at: timestamp,
    data: snapshotData
  };

  // 1. In-memory storage with 3-snapshot cap
  const memTable = getMemTable('permify_snapshots');
  const guildSnaps = memTable.get(guildId) || [];
  guildSnaps.unshift({ ...record, id: Date.now() });
  if (guildSnaps.length > 3) guildSnaps.length = 3;
  memTable.set(guildId, guildSnaps);

  // 2. Supabase persistence
  try {
    const { data, error } = await db
      .from('permify_snapshots')
      .insert(record)
      .select()
      .single();

    if (!error && data) {
      // Clean up older snapshots beyond the latest 3 in Supabase
      const { data: allSnaps } = await db
        .from('permify_snapshots')
        .select('id')
        .eq('guild_id', guildId)
        .order('created_at', { ascending: false });

      if (Array.isArray(allSnaps) && allSnaps.length > 3) {
        const toDeleteIds = allSnaps.slice(3).map(s => s.id);
        await db.from('permify_snapshots').delete().in('id', toDeleteIds).catch(() => {});
      }

      return data;
    }
  } catch (err) {
    logger.debug({ err, guildId }, 'Supabase permify_snapshots insert deferred to local memory');
  }

  return guildSnaps[0];
}

/**
 * Retrieves the latest snapshot for a guild (for undo or crash recovery)
 *
 * @param {string} guildId
 * @returns {Promise<object|null>}
 */
export async function getLatestSnapshot(guildId) {
  try {
    const { data, error } = await db
      .from('permify_snapshots')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data;
    }
  } catch (err) {
    logger.debug({ err, guildId }, 'Note fetching latest permify snapshot');
  }

  const memTable = getMemTable('permify_snapshots');
  const snaps = memTable.get(guildId) || [];
  return snaps[0] || null;
}

/**
 * Retrieves the last N snapshots for a guild
 *
 * @param {string} guildId
 * @param {number} [limit=3]
 * @returns {Promise<Array<object>>}
 */
export async function getSnapshots(guildId, limit = 3) {
  try {
    const { data, error } = await db
      .from('permify_snapshots')
      .select('*')
      .eq('guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (_) {}

  const memTable = getMemTable('permify_snapshots');
  const snaps = memTable.get(guildId) || [];
  return snaps.slice(0, limit);
}

/**
 * Saves staff, member, and owner role groupings for a guild
 *
 * @param {string} guildId
 * @param {object} roles
 * @param {string[]} [roles.staff=[]]
 * @param {string[]} [roles.member=[]]
 * @param {string[]} [roles.owner=[]]
 * @returns {Promise<object>}
 */
export async function saveGuildRoles(guildId, { staff = [], member = [], owner = [] } = {}) {
  const payload = {
    guild_id: guildId,
    staff_role_ids: Array.from(new Set(staff)),
    member_role_ids: Array.from(new Set(member)),
    owner_role_ids: Array.from(new Set(owner)),
    updated_at: new Date().toISOString()
  };

  // Memory table
  getMemTable('guild_roles').set(guildId, payload);
  rolesCache.set(guildId, {
    data: {
      staff: payload.staff_role_ids,
      member: payload.member_role_ids,
      owner: payload.owner_role_ids
    },
    timestamp: Date.now()
  });

  try {
    await db.from('guild_roles').upsert(payload);
  } catch (err) {
    logger.debug({ err, guildId }, 'Supabase guild_roles upsert deferred to local memory');
  }

  return rolesCache.get(guildId).data;
}

/**
 * Core helper returning role classifications for other bot modules
 *
 * @param {string} guildId
 * @returns {Promise<{ staff: string[], member: string[], owner: string[] }>}
 */
export async function getGuildRoles(guildId) {
  if (!guildId) return { staff: [], member: [], owner: [] };

  const cached = rolesCache.get(guildId);
  if (cached && Date.now() - cached.timestamp < ROLES_CACHE_TTL) {
    return cached.data;
  }

  try {
    const { data, error } = await db
      .from('guild_roles')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (!error && data) {
      const res = {
        staff: Array.isArray(data.staff_role_ids) ? data.staff_role_ids : [],
        member: Array.isArray(data.member_role_ids) ? data.member_role_ids : [],
        owner: Array.isArray(data.owner_role_ids) ? data.owner_role_ids : []
      };
      rolesCache.set(guildId, { data: res, timestamp: Date.now() });
      return res;
    }
  } catch (_) {}

  // Fallback to memoryDb
  const mem = getMemTable('guild_roles').get(guildId);
  if (mem) {
    const res = {
      staff: Array.isArray(mem.staff_role_ids) ? mem.staff_role_ids : [],
      member: Array.isArray(mem.member_role_ids) ? mem.member_role_ids : [],
      owner: Array.isArray(mem.owner_role_ids) ? mem.owner_role_ids : []
    };
    rolesCache.set(guildId, { data: res, timestamp: Date.now() });
    return res;
  }

  return { staff: [], member: [], owner: [] };
}

export default {
  saveSnapshot,
  getLatestSnapshot,
  getSnapshots,
  saveGuildRoles,
  getGuildRoles
};

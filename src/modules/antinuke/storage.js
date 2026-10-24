import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../../db/client.js';
import { logger } from '../../core/logger/index.js';
import { AntinukeSettingsSchema } from './schema.js';
import { isChannelExempt } from '../../db/antinuke.js';

// High-speed bounded write-through cache for antinuke
// Map<guildId, { settings: object, version: number, cachedAt: number }>
const antinukeSettingsCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

// In-memory snapshot content hash cache to prevent duplicate database writes
// Map<`${guildId}:${targetId}`, string (hash)>
const snapshotHashCache = new Map();

const BACKUPS_DIR = path.join(process.cwd(), 'cache', 'antinuke-backups');

export const DEFAULT_ANTINUKE_SETTINGS = {
  enabled: false,
  dry_run: false,
  thresholds: {
    channel_delete_limit: 3,
    channel_delete_window_seconds: 10,
    restore_single_deletions: false,
    mass_role_delete_limit: 3,
    mass_role_delete_window_seconds: 10,
    mass_ban_limit: 5,
    mass_ban_window_seconds: 15,
    mass_kick_limit: 5,
    mass_kick_window_seconds: 15,
    bot_add_protection: true,
    webhook_spam_limit: 3,
    webhook_spam_window_seconds: 10,
    dangerous_perm_grant: true,
    raid_distinct_users: 5,
    raid_messages_per_user: 4,
    raid_window_seconds: 5,
    raid_identical_content_users: 3,
    raid_join_burst_count: 8,
    raid_join_window_seconds: 10,
    lockdown_calm_seconds: 60,
    lockdown_max_duration_seconds: 900
  },
  punishment: 'ban',
  lockdown_punishment: 'ban',
  log_channel_id: null,
  alert_channel_id: null,
  ping_role_id: null,
  extra_owners: [],
  version: 1,
  schema_version: 2
};

/**
 * Validates and safely parses raw antinuke settings through Zod.
 * @param {object} raw
 * @param {string} guildId
 * @returns {object}
 */
export function validateSettings(raw, guildId) {
  const parsed = AntinukeSettingsSchema.safeParse({
    guild_id: String(guildId),
    ...raw
  });

  if (parsed.success) {
    return parsed.data;
  }

  logger.warn(`[ANTINUKE] Corrupted settings detected for guild ${guildId}; auto-repairing schema: ${parsed.error.message}`);
  // Safe fallback merged with whatever valid fields were present
  const fallback = {
    guild_id: String(guildId),
    ...DEFAULT_ANTINUKE_SETTINGS,
    ...(typeof raw === 'object' && raw !== null ? raw : {})
  };
  return AntinukeSettingsSchema.parse(fallback);
}

/**
 * Gets antinuke settings for a guild with write-through cache and Zod validation.
 * @param {string} guildId
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<object>}
 */
export async function getAntiNukeSettings(guildId, forceRefresh = false) {
  if (!guildId) return { ...DEFAULT_ANTINUKE_SETTINGS, guild_id: '0' };
  const gid = String(guildId);

  if (!forceRefresh) {
    const cached = antinukeSettingsCache.get(gid);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.settings;
    }
  }

  try {
    const { data, error } = await db
      .from('antinuke_settings')
      .select('*')
      .eq('guild_id', gid)
      .maybeSingle();

    if (error) {
      logger.warn({ err: error.message, guildId: gid }, 'Could not read antinuke_settings from database');
      const fallback = validateSettings({ guild_id: gid, ...DEFAULT_ANTINUKE_SETTINGS }, gid);
      antinukeSettingsCache.set(gid, { settings: fallback, version: fallback.version, cachedAt: Date.now() });
      return fallback;
    }

    const settings = validateSettings(data || { guild_id: gid, ...DEFAULT_ANTINUKE_SETTINGS }, gid);
    antinukeSettingsCache.set(gid, { settings, version: settings.version, cachedAt: Date.now() });
    return settings;
  } catch (err) {
    logger.error({ err, guildId: gid }, 'Exception fetching antinuke settings');
    return validateSettings({ guild_id: gid, ...DEFAULT_ANTINUKE_SETTINGS }, gid);
  }
}

/**
 * Optimistic concurrency write: updates antinuke settings asserting version match.
 * Prevents stale in-memory cache from overwriting newer DB records.
 *
 * @param {string} guildId
 * @param {object} updates
 * @param {number} [expectedVersion]
 * @returns {Promise<{ success: boolean, data: object|null, error?: string }>}
 */
export async function updateAntiNukeSettingsOptimistic(guildId, updates = {}, expectedVersion = null) {
  if (!guildId) return { success: false, data: null, error: 'Missing guildId' };
  const gid = String(guildId);

  // 1. Fetch current live record if expectedVersion was not provided
  let current = await getAntiNukeSettings(gid, true);
  const versionToAssert = expectedVersion ?? current.version ?? 1;

  // 2. Deep merge updates and validate through schema
  const mergedPayload = validateSettings({
    ...current,
    ...updates,
    thresholds: {
      ...current.thresholds,
      ...(updates.thresholds || {})
    },
    version: versionToAssert
  }, gid);

  // 3. Attempt optimistic update asserting version match
  try {
    // Try RPC function first if available in Supabase
    const { data: rpcRes, error: rpcErr } = await db.rpc('update_antinuke_settings_optimistic', {
      p_guild_id: gid,
      p_expected_version: versionToAssert,
      p_settings: mergedPayload
    });

    if (!rpcErr && rpcRes) {
      if (!rpcRes.success) {
        logger.warn(`[ANTINUKE] Optimistic lock conflict for guild ${gid} (version: ${versionToAssert}). Reloading and retrying...`);
        // Refresh cache with remote state
        antinukeSettingsCache.delete(gid);
        current = await getAntiNukeSettings(gid, true);

        // Retry once with new version
        const retryMerged = validateSettings({
          ...current,
          ...updates,
          thresholds: { ...current.thresholds, ...(updates.thresholds || {}) },
          version: current.version
        }, gid);

        const { data: retryRes, error: retryErr } = await db.rpc('update_antinuke_settings_optimistic', {
          p_guild_id: gid,
          p_expected_version: current.version,
          p_settings: retryMerged
        });

        if (!retryErr && retryRes?.success) {
          const fresh = validateSettings(retryRes.data, gid);
          antinukeSettingsCache.set(gid, { settings: fresh, version: fresh.version, cachedAt: Date.now() });
          return { success: true, data: fresh };
        }
      } else {
        const fresh = validateSettings(rpcRes.data, gid);
        antinukeSettingsCache.set(gid, { settings: fresh, version: fresh.version, cachedAt: Date.now() });
        return { success: true, data: fresh };
      }
    }

    // Direct table query fallback with version check
    const nextVersion = versionToAssert + 1;
    const writeData = {
      ...mergedPayload,
      version: nextVersion,
      updated_at: new Date().toISOString()
    };

    const { data: updatedRow, error: updateErr } = await db
      .from('antinuke_settings')
      .update(writeData)
      .eq('guild_id', gid)
      .eq('version', versionToAssert)
      .select()
      .maybeSingle();

    if (updateErr || !updatedRow) {
      // If row did not exist, insert with version 1
      const { data: insertedRow, error: insertErr } = await db
        .from('antinuke_settings')
        .upsert({ ...mergedPayload, version: 1, updated_at: new Date().toISOString() })
        .select()
        .single();

      if (insertErr) {
        logger.error({ err: insertErr, guildId: gid }, 'Failed inserting antinuke settings');
        return { success: false, data: null, error: insertErr.message };
      }

      const fresh = validateSettings(insertedRow, gid);
      antinukeSettingsCache.set(gid, { settings: fresh, version: fresh.version, cachedAt: Date.now() });
      return { success: true, data: fresh };
    }

    const fresh = validateSettings(updatedRow, gid);
    antinukeSettingsCache.set(gid, { settings: fresh, version: fresh.version, cachedAt: Date.now() });
    return { success: true, data: fresh };
  } catch (err) {
    logger.error({ err, guildId: gid }, 'Error during optimistic settings update');
    return { success: false, data: null, error: err.message };
  }
}

/**
 * Computes deterministic MD5 hash of channel or role configuration payload.
 * @param {object} payload
 * @returns {string}
 */
export function computeSnapshotHash(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const sortedJson = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto.createHash('md5').update(sortedJson).digest('hex');
}

/**
 * Debounced and content-hashed snapshot saver.
 * Never writes if hash is unchanged; never writes exempt or ticket channels.
 *
 * @param {string} guildId
 * @param {import('discord.js').GuildChannel} channel
 * @returns {Promise<{ saved: boolean, hash: string, reason?: string }>}
 */
export async function saveChannelSnapshotHashed(guildId, channel) {
  if (!guildId || !channel?.id) return { saved: false, reason: 'missing_args' };
  const gid = String(guildId);
  const cid = String(channel.id);

  // 1. Exemption check
  const exempt = await isChannelExempt(gid, cid, channel);
  if (exempt) {
    return { saved: false, reason: 'exempt' };
  }

  // 2. Build normalized snapshot data
  const overwrites = [];
  if (channel.permissionOverwrites?.cache) {
    for (const [id, ov] of channel.permissionOverwrites.cache.entries()) {
      overwrites.push({
        id,
        type: ov.type,
        allow: ov.allow.bitfield.toString(),
        deny: ov.deny.bitfield.toString()
      });
    }
    overwrites.sort((a, b) => a.id.localeCompare(b.id));
  }

  const snapshotData = {
    id: cid,
    name: channel.name,
    type: channel.type,
    topic: channel.topic || null,
    nsfw: Boolean(channel.nsfw),
    rateLimitPerUser: channel.rateLimitPerUser || 0,
    position: channel.position ?? 0,
    parentId: channel.parentId || null,
    bitrate: channel.bitrate || null,
    userLimit: channel.userLimit || null,
    permissionOverwrites: overwrites
  };

  // 3. Compute hash and check if changed
  const hash = computeSnapshotHash(snapshotData);
  const cacheKey = `${gid}:${cid}`;
  if (snapshotHashCache.get(cacheKey) === hash) {
    return { saved: false, hash, reason: 'unchanged_hash' };
  }

  // 4. Save to antinuke_snapshots (and legacy channel_snapshots for parity)
  try {
    const { error: newErr } = await db.from('antinuke_snapshots').upsert({
      guild_id: gid,
      target_id: cid,
      target_type: 'channel',
      content_hash: hash,
      data: snapshotData,
      updated_at: new Date().toISOString()
    });

    const { error: oldErr } = await db.from('channel_snapshots').upsert({
      guild_id: gid,
      channel_id: cid,
      data: snapshotData,
      updated_at: new Date().toISOString()
    });

    if (newErr && oldErr) {
      logger.debug({ newErr: newErr.message, oldErr: oldErr.message }, 'Database write notice for snapshot');
    }

    snapshotHashCache.set(cacheKey, hash);
    return { saved: true, hash };
  } catch (err) {
    logger.warn({ err: err.message, guildId: gid, channelId: cid }, 'Failed saving hashed channel snapshot');
    snapshotHashCache.set(cacheKey, hash);
    return { saved: true, hash, warning: err.message };
  }
}


/**
 * Startup and on-demand integrity repair:
 * Validates settings, repairs invalid types, checks database parity, logs all fixes.
 *
 * @param {string} guildId
 * @returns {Promise<{ repaired: boolean, fixes: string[] }>}
 */
export async function repairAntinukeState(guildId) {
  if (!guildId) return { repaired: false, fixes: ['Invalid guildId'] };
  const gid = String(guildId);
  const fixes = [];

  try {
    // 1. Fetch raw DB row
    const { data: raw, error } = await db
      .from('antinuke_settings')
      .select('*')
      .eq('guild_id', gid)
      .maybeSingle();

    if (error) {
      fixes.push(`Database read error: ${error.message}`);
    }

    if (!raw) {
      // Row missing - insert fresh defaults
      const defaults = { ...DEFAULT_ANTINUKE_SETTINGS, guild_id: gid };
      await db.from('antinuke_settings').insert(defaults);
      fixes.push('Created missing antinuke_settings row with validated defaults');
      antinukeSettingsCache.set(gid, { settings: defaults, version: 1, cachedAt: Date.now() });
    } else {
      // Check for type mismatches
      const validated = validateSettings(raw, gid);
      const changed = JSON.stringify(raw) !== JSON.stringify(validated);

      if (changed || raw.schema_version !== 2) {
        await db.from('antinuke_settings').update({
          ...validated,
          schema_version: 2,
          updated_at: new Date().toISOString()
        }).eq('guild_id', gid);

        fixes.push('Repaired schema types, missing threshold keys, and upgraded schema_version to 2');
        antinukeSettingsCache.set(gid, { settings: validated, version: validated.version, cachedAt: Date.now() });
      }
    }

    // 2. Clear stale lockdown state if calm/max duration expired
    const { data: lock } = await db.from('lockdown_state').select('*').eq('guild_id', gid).maybeSingle();
    if (lock?.active) {
      const now = Date.now();
      const maxExpiry = lock.max_until ? new Date(lock.max_until).getTime() : 0;
      if (maxExpiry && now > maxExpiry) {
        await db.from('lockdown_state').update({ active: false }).eq('guild_id', gid);
        fixes.push('Cleared stale lockdown state (safety maximum duration elapsed)');
      }
    }

    // 3. Backup repaired configuration to local disk
    await backupAntinukeSettings(gid);
    fixes.push('Generated local disk snapshot backup');

    return { repaired: fixes.length > 0, fixes };
  } catch (err) {
    logger.error({ err, guildId: gid }, 'Error during antinuke repair');
    return { repaired: false, fixes: [`Exception: ${err.message}`] };
  }
}

/**
 * Backs up guild antinuke settings as a JSON file in cache/antinuke-backups/
 * @param {string} guildId
 * @returns {Promise<string|null>}
 */
export async function backupAntinukeSettings(guildId) {
  try {
    const settings = await getAntiNukeSettings(guildId);
    if (!fs.existsSync(BACKUPS_DIR)) {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    }

    const filename = `antinuke_${guildId}.json`;
    const filepath = path.join(BACKUPS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(settings, null, 2), 'utf8');
    return filepath;
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed writing antinuke backup');
    return null;
  }
}

export default {
  validateSettings,
  getAntiNukeSettings,
  updateAntiNukeSettingsOptimistic,
  computeSnapshotHash,
  saveChannelSnapshotHashed,
  repairAntinukeState,
  backupAntinukeSettings
};

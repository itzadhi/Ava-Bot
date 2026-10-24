import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';
import { getTicketSettings } from './tickets.js';
import { getGuildRoles } from './permify.js';

// Anti-Nuke Write-Through Cache
// Map<guildId, {
//   settings: object,
//   trusted: { users: string[], roles: string[], extraOwners: string[] },
//   exempt: { categories: string[], channels: string[] },
//   lastLoaded: number
// }>
const antinukeCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours write-through cache

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
  punishment: 'ban', // 'ban', 'kick', 'strip_roles', 'timeout'
  lockdown_punishment: 'ban',
  log_channel_id: null,
  alert_channel_id: null,
  ping_role_id: null,
  extra_owners: []
};

function getGuildCache(guildId) {
  if (!guildId) return null;
  return antinukeCache.get(String(guildId)) || null;
}

function setGuildCache(guildId, data) {
  if (!guildId) return;
  antinukeCache.set(String(guildId), {
    ...data,
    lastLoaded: Date.now()
  });
}

/**
 * Initializes and preloads Anti-Nuke cache for all guilds on startup
 * @param {import('discord.js').Client} [client]
 */
export async function initAntiNukeCache(client = null) {
  try {
    const [settingsRes, trustedRes, exemptRes] = await Promise.all([
      db.from('antinuke_settings').select('*'),
      db.from('antinuke_trusted').select('*'),
      db.from('antinuke_exempt').select('*')
    ]);

    const settingsRows = settingsRes.data || [];
    const trustedRows = trustedRes.data || [];
    const exemptRows = exemptRes.data || [];

    const guildsMap = new Map();

    for (const s of settingsRows) {
      guildsMap.set(s.guild_id, {
        settings: {
          enabled: Boolean(s.enabled),
          dry_run: Boolean(s.dry_run),
          thresholds: { ...DEFAULT_ANTINUKE_SETTINGS.thresholds, ...(s.thresholds || {}) },
          punishment: s.punishment || 'ban',
          lockdown_punishment: s.lockdown_punishment || 'ban',
          log_channel_id: s.log_channel_id || null,
          alert_channel_id: s.alert_channel_id || null,
          ping_role_id: s.ping_role_id || null,
          extra_owners: Array.isArray(s.extra_owners) ? s.extra_owners : []
        },
        trusted: { users: [], roles: [], extraOwners: [] },
        exempt: { categories: [], channels: [] }
      });
    }

    if (client?.guilds?.cache) {
      for (const gid of client.guilds.cache.keys()) {
        if (!guildsMap.has(gid)) {
          guildsMap.set(gid, {
            settings: { ...DEFAULT_ANTINUKE_SETTINGS },
            trusted: { users: [], roles: [], extraOwners: [] },
            exempt: { categories: [], channels: [] }
          });
        }
      }
    }

    for (const t of trustedRows) {
      if (!guildsMap.has(t.guild_id)) {
        guildsMap.set(t.guild_id, {
          settings: { ...DEFAULT_ANTINUKE_SETTINGS },
          trusted: { users: [], roles: [], extraOwners: [] },
          exempt: { categories: [], channels: [] }
        });
      }
      const tr = guildsMap.get(t.guild_id).trusted;
      if (t.target_type === 'role') tr.roles.push(t.target_id);
      else if (t.target_type === 'user') tr.users.push(t.target_id);
      else if (t.target_type === 'extra_owner') tr.extraOwners.push(t.target_id);
    }

    for (const e of exemptRows) {
      if (!guildsMap.has(e.guild_id)) {
        guildsMap.set(e.guild_id, {
          settings: { ...DEFAULT_ANTINUKE_SETTINGS },
          trusted: { users: [], roles: [], extraOwners: [] },
          exempt: { categories: [], channels: [] }
        });
      }
      const ex = guildsMap.get(e.guild_id).exempt;
      if (e.type === 'category') ex.categories.push(e.target_id);
      else if (e.type === 'channel') ex.channels.push(e.target_id);
    }

    for (const [gid, data] of guildsMap.entries()) {
      setGuildCache(gid, data);
    }

    logger.info(`Loaded antinuke config for ${guildsMap.size} guilds`);
    return guildsMap.size;
  } catch (err) {
    logger.error({ err }, 'Failed to initialize Anti-Nuke cache');
    return 0;
  }
}

/**
 * Refreshes Anti-Nuke data for a single guild
 * @param {string} guildId
 */
export async function refreshGuildAntiNukeCache(guildId) {
  if (!guildId) return null;
  const gid = String(guildId);

  try {
    const [sRes, tRes, eRes] = await Promise.all([
      db.from('antinuke_settings').select('*').eq('guild_id', gid).maybeSingle(),
      db.from('antinuke_trusted').select('*').eq('guild_id', gid),
      db.from('antinuke_exempt').select('*').eq('guild_id', gid)
    ]);

    const s = sRes.data;
    const settings = s ? {
      enabled: Boolean(s.enabled),
      dry_run: Boolean(s.dry_run),
      thresholds: { ...DEFAULT_ANTINUKE_SETTINGS.thresholds, ...(s.thresholds || {}) },
      punishment: s.punishment || 'ban',
      lockdown_punishment: s.lockdown_punishment || 'ban',
      log_channel_id: s.log_channel_id || null,
      alert_channel_id: s.alert_channel_id || null,
      ping_role_id: s.ping_role_id || null,
      extra_owners: Array.isArray(s.extra_owners) ? s.extra_owners : []
    } : { ...DEFAULT_ANTINUKE_SETTINGS };

    const trusted = { users: [], roles: [], extraOwners: [] };
    for (const t of (tRes.data || [])) {
      if (t.target_type === 'role') trusted.roles.push(t.target_id);
      else if (t.target_type === 'user') trusted.users.push(t.target_id);
      else if (t.target_type === 'extra_owner') trusted.extraOwners.push(t.target_id);
    }

    const exempt = { categories: [], channels: [] };
    for (const e of (eRes.data || [])) {
      if (e.type === 'category') exempt.categories.push(e.target_id);
      else if (e.type === 'channel') exempt.channels.push(e.target_id);
    }

    const data = { settings, trusted, exempt };
    setGuildCache(gid, data);
    return data;
  } catch (err) {
    logger.error({ err, guildId }, 'Error refreshing Anti-Nuke cache');
    return getGuildCache(gid);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAntiNukeSettings(guildId) {
  if (!guildId) return { ...DEFAULT_ANTINUKE_SETTINGS };
  const gid = String(guildId);

  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.settings;
  }

  const refreshed = await refreshGuildAntiNukeCache(gid);
  return refreshed?.settings || { ...DEFAULT_ANTINUKE_SETTINGS };
}

export async function updateAntiNukeSettings(guildId, updates = {}) {
  if (!guildId) return { data: null, error: new Error('Missing guildId') };
  const gid = String(guildId);

  const current = await getAntiNukeSettings(gid);
  const merged = {
    ...current,
    ...updates,
    thresholds: {
      ...current.thresholds,
      ...(updates.thresholds || {})
    }
  };

  const payload = {
    guild_id: gid,
    enabled: Boolean(merged.enabled),
    dry_run: Boolean(merged.dry_run),
    thresholds: merged.thresholds,
    punishment: merged.punishment || 'ban',
    lockdown_punishment: merged.lockdown_punishment || 'ban',
    log_channel_id: merged.log_channel_id || null,
    alert_channel_id: merged.alert_channel_id || null,
    ping_role_id: merged.ping_role_id || null,
    extra_owners: Array.isArray(merged.extra_owners) ? merged.extra_owners : [],
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('antinuke_settings')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid }, 'Supabase error updating antinuke_settings');
    return { data: null, error };
  }

  const cached = getGuildCache(gid) || {
    trusted: { users: [], roles: [], extraOwners: [] },
    exempt: { categories: [], channels: [] }
  };
  cached.settings = merged;
  setGuildCache(gid, cached);

  return { data: merged, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRUSTED USERS & ROLES
// ─────────────────────────────────────────────────────────────────────────────

export async function getAntiNukeTrusted(guildId) {
  if (!guildId) return { users: [], roles: [], extraOwners: [] };
  const gid = String(guildId);

  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.trusted;
  }

  const refreshed = await refreshGuildAntiNukeCache(gid);
  return refreshed?.trusted || { users: [], roles: [], extraOwners: [] };
}

export async function addAntiNukeTrusted(guildId, targetId, targetType) {
  if (!guildId || !targetId || !targetType) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const tid = String(targetId);
  const type = String(targetType).toLowerCase();

  const record = {
    guild_id: gid,
    target_id: tid,
    target_type: type,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('antinuke_trusted')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid, targetId: tid, type }, 'Supabase error adding antinuke_trusted');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const list = type === 'role' ? cached.trusted.roles : type === 'user' ? cached.trusted.users : cached.trusted.extraOwners;
    if (list && !list.includes(tid)) list.push(tid);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function removeAntiNukeTrusted(guildId, targetId, targetType) {
  if (!guildId || !targetId || !targetType) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const tid = String(targetId);
  const type = String(targetType).toLowerCase();

  const { data, error } = await db
    .from('antinuke_trusted')
    .delete()
    .eq('guild_id', gid)
    .eq('target_id', tid)
    .eq('target_type', type);

  if (error) {
    logger.error({ error, guildId: gid, targetId: tid, type }, 'Supabase error removing antinuke_trusted');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const key = type === 'role' ? 'roles' : type === 'user' ? 'users' : 'extraOwners';
    if (cached.trusted[key]) {
      cached.trusted[key] = cached.trusted[key].filter(id => id !== tid);
      setGuildCache(gid, cached);
    }
  }

  return { data, error: null };
}

export async function addTrustedUser(guildId, userId) {
  return addAntiNukeTrusted(guildId, userId, 'user');
}

export async function removeTrustedUser(guildId, userId) {
  return removeAntiNukeTrusted(guildId, userId, 'user');
}

export async function addTrustedRole(guildId, roleId) {
  return addAntiNukeTrusted(guildId, roleId, 'role');
}

export async function removeTrustedRole(guildId, roleId) {
  return removeAntiNukeTrusted(guildId, roleId, 'role');
}

/**
 * Checks if a user or role is immune/trusted against Anti-Nuke protections
 * Real server owner, bot itself, extra owners, trusted users/roles, and permify owner roles are immune.
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {import('discord.js').GuildMember} [member]
 * @returns {Promise<boolean>}
 */
export async function isTrusted(guild, userId, member = null) {
  if (!guild || !userId) return false;
  const gid = guild.id;
  const uid = String(userId);

  // 1. Real Server Owner is ALWAYS immune
  if (guild.ownerId === uid) return true;

  // 2. The bot itself is ALWAYS immune
  if (guild.client?.user?.id === uid) return true;

  // 3. Extra owners from settings or trusted
  const settings = await getAntiNukeSettings(gid);
  if (Array.isArray(settings.extra_owners) && settings.extra_owners.includes(uid)) {
    return true;
  }

  const trusted = await getAntiNukeTrusted(gid);
  if (trusted.extraOwners.includes(uid)) return true;
  if (trusted.users.includes(uid)) return true;

  // 4. Permify Owner Roles Immunity
  const permifyRoles = await getGuildRoles(gid).catch(() => ({ owner: [], staff: [] }));
  const immuneRoleSet = new Set([...trusted.roles, ...(permifyRoles.owner || [])]);

  if (immuneRoleSet.size > 0) {
    let resolvedMember = member;
    if (!resolvedMember && guild.members?.cache) {
      resolvedMember = guild.members.cache.get(uid);
    }
    if (!resolvedMember) {
      resolvedMember = await guild.members.fetch(uid).catch(() => null);
    }

    if (resolvedMember?.roles?.cache) {
      for (const roleId of immuneRoleSet) {
        if (resolvedMember.roles.cache.has(roleId)) return true;
      }
    }
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXEMPT CHANNELS & CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

export async function getAntiNukeExempt(guildId) {
  if (!guildId) return { categories: [], channels: [] };
  const gid = String(guildId);

  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.exempt;
  }

  const refreshed = await refreshGuildAntiNukeCache(gid);
  return refreshed?.exempt || { categories: [], channels: [] };
}

export async function addAntiNukeExempt(guildId, targetId, type) {
  if (!guildId || !targetId || !type) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const tid = String(targetId);
  const t = String(type).toLowerCase();

  const record = {
    guild_id: gid,
    target_id: tid,
    type: t,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('antinuke_exempt')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid, targetId: tid, type: t }, 'Supabase error adding antinuke_exempt');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const list = t === 'category' ? cached.exempt.categories : cached.exempt.channels;
    if (list && !list.includes(tid)) list.push(tid);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function removeAntiNukeExempt(guildId, targetId, type) {
  if (!guildId || !targetId || !type) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const tid = String(targetId);
  const t = String(type).toLowerCase();

  const { data, error } = await db
    .from('antinuke_exempt')
    .delete()
    .eq('guild_id', gid)
    .eq('target_id', tid)
    .eq('type', t);

  if (error) {
    logger.error({ error, guildId: gid, targetId: tid, type: t }, 'Supabase error removing antinuke_exempt');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const key = t === 'category' ? 'categories' : 'channels';
    if (cached.exempt[key]) {
      cached.exempt[key] = cached.exempt[key].filter(id => id !== tid);
      setGuildCache(gid, cached);
    }
  }

  return { data, error: null };
}

/**
 * Checks if a channel or its category is exempt from snapshots, restore, and lockdown
 * Ticket category and ticket channels are ALWAYS exempt automatically.
 *
 * @param {string} guildId
 * @param {string} channelId
 * @param {object} [channel]
 * @returns {Promise<boolean>}
 */
export async function isChannelExempt(guildId, channelId, channel = null) {
  if (!guildId || !channelId) return false;
  const gid = String(guildId);
  const cid = String(channelId);

  // 1. Check ticket category exemption
  const ticketSettings = await getTicketSettings(gid).catch(() => null);
  const ticketCategoryId = ticketSettings?.channel_category_id;
  if (ticketCategoryId) {
    if (cid === ticketCategoryId) return true;
    if (channel?.parentId === ticketCategoryId) return true;
  }

  // 2. Check ticket name format or active ticket channel
  if (channel?.name?.startsWith('ticket-') || channel?.name?.startsWith('tkt-')) {
    return true;
  }

  // 3. Configured Anti-Nuke Exemptions
  const exempt = await getAntiNukeExempt(gid);
  if (exempt.channels.includes(cid)) return true;
  if (channel?.parentId && exempt.categories.includes(channel.parentId)) return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL SNAPSHOTS
// ─────────────────────────────────────────────────────────────────────────────

export async function saveChannelSnapshot(guildId, channel) {
  if (!guildId || !channel?.id) return;
  const gid = String(guildId);
  const cid = String(channel.id);

  // Skip exempt channels and ticket category
  const isExempt = await isChannelExempt(gid, cid, channel);
  if (isExempt) return;

  const overwrites = [];
  if (channel.permissionOverwrites?.cache) {
    for (const [id, ov] of channel.permissionOverwrites.cache.entries()) {
      overwrites.push({
        id,
        type: ov.type, // 0 = role, 1 = member
        allow: ov.allow.bitfield.toString(),
        deny: ov.deny.bitfield.toString()
      });
    }
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
    rtcRegion: channel.rtcRegion || null,
    videoQualityMode: channel.videoQualityMode || null,
    defaultAutoArchiveDuration: channel.defaultAutoArchiveDuration || null,
    permissionOverwrites: overwrites
  };

  try {
    await db.from('channel_snapshots').upsert({
      guild_id: gid,
      channel_id: cid,
      data: snapshotData,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    logger.warn({ err, guildId: gid, channelId: cid }, 'Error saving channel snapshot');
  }
}

export async function saveAllChannelSnapshots(guild) {
  if (!guild?.channels?.cache) return 0;
  let count = 0;

  for (const channel of guild.channels.cache.values()) {
    try {
      await saveChannelSnapshot(guild.id, channel);
      count++;
    } catch (_) {}
  }

  logger.info({ guildId: guild.id, channelCount: count }, 'Refreshed all channel snapshots for guild');
  return count;
}

export async function getChannelSnapshot(guildId, channelId) {
  if (!guildId || !channelId) return null;
  const { data } = await db
    .from('channel_snapshots')
    .select('data')
    .eq('guild_id', String(guildId))
    .eq('channel_id', String(channelId))
    .maybeSingle();

  return data?.data || null;
}

export async function getChannelSnapshots(guildId) {
  if (!guildId) return [];
  const { data } = await db
    .from('channel_snapshots')
    .select('*')
    .eq('guild_id', String(guildId));

  return (data || []).map(r => r.data).filter(Boolean);
}

export async function takeChannelSnapshot(guildOrId, channel) {
  const guildId = typeof guildOrId === 'object' && guildOrId !== null ? guildOrId.id : guildOrId;
  return saveChannelSnapshot(guildId, channel);
}

export const getAllLiveChannelSnapshots = getChannelSnapshots;

export async function deleteChannelSnapshot(guildId, channelId) {
  if (!guildId || !channelId) return;
  try {
    await db.from('channel_snapshots')
      .delete()
      .eq('guild_id', String(guildId))
      .eq('channel_id', String(channelId));
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCKDOWN STATE
// ─────────────────────────────────────────────────────────────────────────────

const activeLockdownCache = new Map();

export function getCachedLockdownState(guildId) {
  return activeLockdownCache.get(String(guildId)) || null;
}

export async function getLockdownState(guildId) {
  if (!guildId) return null;
  const gid = String(guildId);
  const cached = activeLockdownCache.get(gid);
  if (cached) return cached;

  try {
    const { data, error } = await db
      .from('lockdown_state')
      .select('*')
      .eq('guild_id', gid)
      .maybeSingle();

    if (!error && data) {
      if (data.state !== 'idle') {
        activeLockdownCache.set(gid, data);
      }
      return data;
    }
  } catch (_) {}

  return null;
}

export async function saveLockdownState(guildId, state) {
  if (!guildId) return;
  const gid = String(guildId);
  const payload = {
    guild_id: gid,
    state: state.state || 'idle',
    started_by: state.started_by || null,
    reason: state.reason || null,
    plan: state.plan || {},
    item_statuses: state.item_statuses || {},
    counters: state.counters || { total: 0, locked: 0, unlocked: 0, failed: 0, skipped: 0 },
    version: (state.version || 0) + 1,
    unlock_at: state.unlock_at || null,
    updated_at: new Date().toISOString()
  };

  activeLockdownCache.set(gid, payload);

  try {
    await db.from('lockdown_state').upsert(payload);
  } catch (err) {
    logger.warn({ err: err.message, guildId: gid }, 'Error upserting lockdown_state');
  }
}

export async function clearLockdownState(guildId) {
  if (!guildId) return;
  const gid = String(guildId);
  activeLockdownCache.delete(gid);
  try {
    await db.from('lockdown_state').update({
      state: 'idle',
      unlock_at: null,
      updated_at: new Date().toISOString()
    }).eq('guild_id', gid);
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// INCIDENTS
// ─────────────────────────────────────────────────────────────────────────────

export async function recordAntiNukeIncident(guildId, type, executorId, details = {}) {
  if (!guildId) return null;
  const id = `inc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    guild_id: String(guildId),
    type: String(type),
    executor_id: String(executorId || 'unknown'),
    details,
    created_at: new Date().toISOString()
  };

  try {
    await db.from('antinuke_incidents').insert(record);
  } catch (err) {
    logger.error({ err, guildId, incidentId: id }, 'Error recording antinuke incident');
  }

  return record;
}

export default {
  initAntiNukeCache,
  refreshGuildAntiNukeCache,
  getAntiNukeSettings,
  updateAntiNukeSettings,
  getAntiNukeTrusted,
  addAntiNukeTrusted,
  removeAntiNukeTrusted,
  isTrusted,
  getAntiNukeExempt,
  addAntiNukeExempt,
  removeAntiNukeExempt,
  isChannelExempt,
  saveChannelSnapshot,
  saveAllChannelSnapshots,
  getChannelSnapshot,
  getChannelSnapshots,
  deleteChannelSnapshot,
  getLockdownState,
  saveLockdownState,
  clearLockdownState,
  recordAntiNukeIncident
};

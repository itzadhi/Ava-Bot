import { db } from './client.js';
import { getGuildSettings } from './guilds.js';
import { logger } from '../utils/logger.js';

export async function createBackupRecord({ id, guild_id, owner_id, name, storage_path, size_bytes, options, locked = false, is_auto = false }) {
  const { data, error } = await db
    .from('backups')
    .insert({
      id,
      guild_id,
      owner_id,
      name,
      storage_path,
      size_bytes,
      options,
      locked,
      is_auto,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, id, guild_id }, 'Error creating backup record');
    throw error;
  }
  return data;
}

export async function getBackupById(id) {
  const { data, error } = await db
    .from('backups')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error({ error, id }, 'Error retrieving backup');
    return null;
  }
  return data;
}

export async function getGuildBackups(guildId, { limit = 50, order = 'desc' } = {}) {
  const { data, error } = await db
    .from('backups')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: order === 'asc' })
    .limit(limit);

  if (error) {
    logger.error({ error, guildId }, 'Error retrieving guild backups');
    return [];
  }
  return data || [];
}

export async function getUserBackups(ownerId, { limit = 50, order = 'desc' } = {}) {
  const { data, error } = await db
    .from('backups')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: order === 'asc' })
    .limit(limit);

  if (error) {
    logger.error({ error, ownerId }, 'Error retrieving user backups');
    return [];
  }
  return data || [];
}

export async function deleteBackupRecord(id) {
  const { data, error } = await db
    .from('backups')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Error deleting backup record');
    throw error;
  }
  return data;
}

export async function purgeUnlockedBackups(guildId) {
  const { data, error } = await db
    .from('backups')
    .delete()
    .eq('guild_id', guildId)
    .eq('locked', false);

  if (error) {
    logger.error({ error, guildId }, 'Error purging unlocked backups');
    throw error;
  }
  return data;
}

export async function renameBackup(id, newName) {
  const { data, error } = await db
    .from('backups')
    .update({ name: newName })
    .eq('id', id);

  if (error) {
    logger.error({ error, id, newName }, 'Error renaming backup');
    throw error;
  }
  return data;
}

export async function setBackupLock(id, locked) {
  const { data, error } = await db
    .from('backups')
    .update({ locked })
    .eq('id', id);

  if (error) {
    logger.error({ error, id, locked }, 'Error updating backup lock status');
    throw error;
  }
  return data;
}

export async function getOldestUnlockedAutoBackups(guildId, keepCount = 5) {
  const backups = await getGuildBackups(guildId, { limit: 100, order: 'asc' });
  const unlocked = backups.filter(b => !b.locked);
  if (unlocked.length <= keepCount) {
    return [];
  }
  return unlocked.slice(0, unlocked.length - keepCount);
}

// BACKUP INTERVALS
export async function getBackupInterval(guildId) {
  const { data, error } = await db
    .from('backup_intervals')
    .select('*')
    .eq('guild_id', guildId)
    .maybeSingle();

  if (error) {
    logger.error({ error, guildId }, 'Error retrieving backup interval');
    return null;
  }
  return data;
}

export async function setBackupInterval(guildId, { interval_hours, max_backups, enabled, last_run }) {
  await getGuildSettings(guildId);

  const { data, error } = await db
    .from('backup_intervals')
    .upsert({
      guild_id: guildId,
      interval_hours,
      max_backups,
      enabled,
      last_run
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId }, 'Error setting backup interval');
    throw error;
  }
  return data;
}

export async function getAllActiveIntervals() {
  const { data, error } = await db
    .from('backup_intervals')
    .select('*')
    .eq('enabled', true);

  if (error) {
    logger.error({ error }, 'Error fetching active intervals');
    return [];
  }
  return data || [];
}

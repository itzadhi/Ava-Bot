import { db } from './client.js';
import { logger } from '../utils/logger.js';

// Fast in-memory cache of synced messages to prevent infinite echo loops
const syncedMessagesCache = new Set();

export async function createSyncRecord({ id, source_guild, target_guild, source_channel = null, target_channel = null, type, direction = 'one-way', enabled = true, created_by }) {
  const { data, error } = await db
    .from('syncs')
    .insert({
      id,
      source_guild,
      target_guild,
      source_channel,
      target_channel,
      type,
      direction,
      enabled,
      created_by,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, id }, 'Error creating sync record');
    throw error;
  }
  return data;
}

export async function getSyncById(id) {
  const { data, error } = await db
    .from('syncs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error({ error, id }, 'Error fetching sync');
    return null;
  }
  return data;
}

export async function getGuildSyncs(guildId) {
  const { data: sourceSyncs } = await db.from('syncs').select('*').eq('source_guild', guildId);
  const { data: targetSyncs } = await db.from('syncs').select('*').eq('target_guild', guildId);

  const combined = new Map();
  for (const s of (sourceSyncs || [])) combined.set(s.id, s);
  for (const s of (targetSyncs || [])) combined.set(s.id, s);

  return Array.from(combined.values());
}

export async function getActiveSyncsBySource(sourceGuildId, type) {
  let builder = db
    .from('syncs')
    .select('*')
    .eq('source_guild', sourceGuildId)
    .eq('enabled', true);

  if (type) {
    builder = builder.eq('type', type);
  }

  const { data, error } = await builder;
  if (error) {
    logger.error({ error, sourceGuildId, type }, 'Error fetching active syncs by source');
    return [];
  }
  return data || [];
}

export async function getAllActiveSyncs(type) {
  let builder = db
    .from('syncs')
    .select('*')
    .eq('enabled', true);

  if (type) {
    builder = builder.eq('type', type);
  }

  const { data, error } = await builder;
  if (error) {
    logger.error({ error, type }, 'Error fetching all active syncs');
    return [];
  }
  return data || [];
}

export async function setSyncEnabled(id, enabled) {
  const { data, error } = await db
    .from('syncs')
    .update({ enabled })
    .eq('id', id);

  if (error) {
    logger.error({ error, id, enabled }, 'Error toggling sync');
    throw error;
  }
  return data;
}

export async function deleteSyncRecord(id) {
  const { data, error } = await db
    .from('syncs')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Error deleting sync record');
    throw error;
  }
  return data;
}

// LOOP PREVENTION: SYNCED MESSAGES
export async function recordSyncedMessage(sourceMessageId, targetMessageId, syncId) {
  syncedMessagesCache.add(sourceMessageId);
  syncedMessagesCache.add(targetMessageId);

  // Keep in-memory cache bounded
  if (syncedMessagesCache.size > 10000) {
    const arr = Array.from(syncedMessagesCache);
    for (let i = 0; i < 2000; i++) {
      syncedMessagesCache.delete(arr[i]);
    }
  }

  const { error } = await db
    .from('synced_messages')
    .insert({
      source_message_id: sourceMessageId,
      target_message_id: targetMessageId,
      sync_id: syncId,
      created_at: new Date().toISOString()
    });

  if (error) {
    logger.error({ error, sourceMessageId, targetMessageId }, 'Error recording synced message');
  }
}

export async function isMessageAlreadySynced(messageId) {
  if (syncedMessagesCache.has(messageId)) {
    return true;
  }

  const { data: src } = await db
    .from('synced_messages')
    .select('source_message_id')
    .eq('source_message_id', messageId)
    .maybeSingle();

  if (src) {
    syncedMessagesCache.add(messageId);
    return true;
  }

  const { data: tgt } = await db
    .from('synced_messages')
    .select('target_message_id')
    .eq('target_message_id', messageId)
    .maybeSingle();

  if (tgt) {
    syncedMessagesCache.add(messageId);
    return true;
  }

  return false;
}

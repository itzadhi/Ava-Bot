import { db } from './client.js';
import { logger } from '../utils/logger.js';

export async function logAudit({ guildId = null, userId, action, details = {} }) {
  try {
    const { data, error } = await db
      .from('audit_logs')
      .insert({
        guild_id: guildId,
        user_id: userId,
        action,
        details,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, action }, 'Failed to insert audit log');
      return null;
    }
    return data;
  } catch (err) {
    logger.error({ err, action }, 'Exception writing audit log');
    return null;
  }
}

export async function getAuditLogs({ guildId = null, userId = null, limit = 5, page = 1 } = {}) {
  let builder = db.from('audit_logs').select('*');

  if (guildId) builder = builder.eq('guild_id', guildId);
  if (userId) builder = builder.eq('user_id', userId);

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await builder
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    logger.error({ error }, 'Error fetching audit logs');
    return [];
  }
  return data || [];
}

export async function deleteUserAuditLogs(userId) {
  const { data, error } = await db
    .from('audit_logs')
    .delete()
    .eq('user_id', userId);

  if (error) {
    logger.error({ error, userId }, 'Error deleting user audit logs');
  }
  return data;
}

export async function deleteGuildAuditLogs(guildId) {
  const { data, error } = await db
    .from('audit_logs')
    .delete()
    .eq('guild_id', guildId);

  if (error) {
    logger.error({ error, guildId }, 'Error deleting guild audit logs');
  }
  return data;
}

import { db } from './client.js';
import { logger } from '../utils/logger.js';

export async function logError({ scope, message, stack = null }) {
  try {
    // Scrub potential sensitive patterns before persisting
    const cleanMessage = String(message)
      .replace(/[\w-]{24}\.[\w-]{6}\.[\w-]{27}/g, '[REDACTED_TOKEN]')
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]');

    const cleanStack = stack ? String(stack)
      .replace(/[\w-]{24}\.[\w-]{6}\.[\w-]{27}/g, '[REDACTED_TOKEN]')
      .replace(/eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]') : null;

    const { data, error } = await db
      .from('error_logs')
      .insert({
        scope,
        message: cleanMessage,
        stack: cleanStack,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      logger.error({ error, scope }, 'Failed to insert error log into DB');
      return null;
    }
    return data;
  } catch (err) {
    logger.error({ err, scope }, 'Exception writing error log to DB');
    return null;
  }
}

export async function getErrorLogs({ limit = 5, page = 1 } = {}) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await db
    .from('error_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) {
    logger.error({ error }, 'Error fetching error logs');
    return [];
  }
  return data || [];
}

export async function getErrorCountLastHour() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('error_logs')
    .select('id')
    .gte('created_at', oneHourAgo);

  if (error) {
    return 0;
  }
  return data ? data.length : 0;
}

export async function clearOldErrors(days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await db
    .from('error_logs')
    .delete()
    .lt('created_at', cutoff);

  if (error) {
    logger.error({ error }, 'Error clearing old error logs');
  }
  return data;
}

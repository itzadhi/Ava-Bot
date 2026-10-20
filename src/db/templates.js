import { db } from './client.js';
import { logger } from '../utils/logger.js';

export async function createTemplateRecord({ id, guild_id, owner_id, name, description, category, is_public, backup_id }) {
  const { data, error } = await db
    .from('templates')
    .insert({
      id,
      guild_id,
      owner_id,
      name,
      description,
      category: category || 'Other',
      is_public: is_public || false,
      uses: 0,
      backup_id,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, id }, 'Error creating template record');
    throw error;
  }
  return data;
}

export async function getTemplateById(id) {
  const { data, error } = await db
    .from('templates')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    logger.error({ error, id }, 'Error fetching template');
    return null;
  }
  return data;
}

export async function getGuildTemplates(guildId) {
  const { data, error } = await db
    .from('templates')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false });

  if (error) {
    logger.error({ error, guildId }, 'Error fetching guild templates');
    return [];
  }
  return data || [];
}

export async function searchPublicTemplates({ query = '', category = null, limit = 5, page = 1 } = {}) {
  let builder = db
    .from('templates')
    .select('*')
    .eq('is_public', true);

  if (category && category !== 'All') {
    builder = builder.eq('category', category);
  }

  if (query) {
    builder = builder.ilike('name', `%${query}%`);
  }

  const from = (page - 1) * limit;
  const to = from + limit - 1;

  const { data, error } = await builder
    .order('uses', { ascending: false })
    .range(from, to);

  if (error) {
    logger.error({ error, query, category }, 'Error searching public templates');
    return [];
  }
  return data || [];
}

export async function deleteTemplateRecord(id) {
  const { data, error } = await db
    .from('templates')
    .delete()
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Error deleting template record');
    throw error;
  }
  return data;
}

export async function setTemplatePublic(id, is_public) {
  const { data, error } = await db
    .from('templates')
    .update({ is_public })
    .eq('id', id);

  if (error) {
    logger.error({ error, id, is_public }, 'Error updating template publicity');
    throw error;
  }
  return data;
}

export async function incrementTemplateUses(id) {
  const current = await getTemplateById(id);
  if (!current) return null;

  const { data, error } = await db
    .from('templates')
    .update({ uses: (current.uses || 0) + 1 })
    .eq('id', id);

  if (error) {
    logger.error({ error, id }, 'Error incrementing template uses');
  }
  return data;
}

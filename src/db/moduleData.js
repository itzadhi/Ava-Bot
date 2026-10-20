import { getSupabase } from './client.js';
import { logger } from '../utils/logger.js';

/**
 * Retrieves stored data for a specific module
 * @param {string} moduleName
 * @param {string} key
 * @param {string} [guildId='global']
 * @returns {Promise<any|null>}
 */
export async function getModuleData(moduleName, key, guildId = 'global') {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('module_data')
    .select('value')
    .eq('module_name', moduleName.toLowerCase())
    .eq('guild_id', guildId)
    .eq('key', key)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
      logger.debug({ moduleName, key, guildId }, 'module_data table not present in Supabase, using fallback');
    } else {
      logger.error({ error, moduleName, key, guildId }, 'Error fetching module data');
    }
    return null;
  }
  return data ? data.value : null;
}

/**
 * Saves or updates module data
 * @param {string} moduleName
 * @param {string} key
 * @param {any} value
 * @param {string} [guildId='global']
 * @returns {Promise<boolean>}
 */
export async function setModuleData(moduleName, key, value, guildId = 'global') {
  const supabase = getSupabase();
  const payload = {
    module_name: moduleName.toLowerCase(),
    guild_id: guildId,
    key,
    value,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('module_data')
    .upsert(payload, { onConflict: 'module_name,guild_id,key' });

  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
      logger.debug({ moduleName, key, guildId }, 'module_data table not present in Supabase, using fallback');
    } else {
      logger.error({ error, moduleName, key, guildId }, 'Error writing module data');
    }
    return false;
  }
  return true;
}

/**
 * Deletes a module data key
 * @param {string} moduleName
 * @param {string} key
 * @param {string} [guildId='global']
 * @returns {Promise<boolean>}
 */
export async function deleteModuleData(moduleName, key, guildId = 'global') {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('module_data')
    .delete()
    .eq('module_name', moduleName.toLowerCase())
    .eq('guild_id', guildId)
    .eq('key', key);

  if (error) {
    logger.error({ error, moduleName, key, guildId }, 'Error deleting module data');
    return false;
  }
  return true;
}

/**
 * Gets all keys and values for a module in a guild
 * @param {string} moduleName
 * @param {string} [guildId='global']
 * @returns {Promise<Record<string, any>>}
 */
export async function getAllModuleData(moduleName, guildId = 'global') {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('module_data')
    .select('key, value')
    .eq('module_name', moduleName.toLowerCase())
    .eq('guild_id', guildId);

  if (error) {
    logger.error({ error, moduleName, guildId }, 'Error fetching all module data');
    return {};
  }

  const result = {};
  if (data) {
    for (const row of data) {
      result[row.key] = row.value;
    }
  }
  return result;
}

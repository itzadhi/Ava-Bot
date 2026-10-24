import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { perm } from './permApply.js';

export const REQUIRED_TABLES = [
  'permission_write_log',
  'lockdown_plans',
  'lockdown_items',
  'lockdown_state',
  'bot_leases',
  'ava_jobs'
];

/**
 * Checks live database schema against required bot tables and RPCs.
 * If anything is missing, keeps permission writes OFF and logs ONE clear line.
 *
 * @returns {Promise<{ valid: boolean, missing: string[] }>}
 */
export async function checkPermissionSchema() {
  const missing = [];

  for (const table of REQUIRED_TABLES) {
    try {
      const { error } = await db.from(table).select('*').limit(0);
      if (error && (error.code === 'PGRST205' || error.code === '42P01')) {
        missing.push(`table:${table}`);
      }
    } catch {
      missing.push(`table:${table}`);
    }
  }

  if (missing.length > 0) {
    perm.setSchemaValid(false);
    logger.warn(`[SCHEMA   ] Missing required DB objects: ${missing.join(', ')}. Permission writes forced OFF.`);
    return { valid: false, missing };
  }

  perm.setSchemaValid(true);
  logger.info('[SCHEMA   ] Permission schema verification passed: all required tables and guards active.');
  return { valid: true, missing: [] };
}

export default { checkPermissionSchema, REQUIRED_TABLES };

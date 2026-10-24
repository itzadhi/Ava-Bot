import { db } from '../../db/client.js';
import { logger } from '../../utils/logger.js';

let currentMode = (process.env.PERMISSION_WRITES || 'off').toLowerCase().trim();
let schemaValid = false;

/**
 * Valid permission write modes:
 * - 'off': All permission writing operations are refused and logged (DEFAULT)
 * - 'dryrun': Operations compute plans and log exact diffs without invoking Discord API
 * - 'on': Operations execute if schema check has succeeded, logging every change to DB
 */
export const perm = {
  getMode() {
    return currentMode;
  },

  setMode(mode) {
    const m = String(mode || '').toLowerCase().trim();
    if (['off', 'dryrun', 'on'].includes(m)) {
      currentMode = m;
      logger.info(`[PERM-GUARD] Permission write mode set to: ${currentMode}`);
    } else {
      logger.warn(`[PERM-GUARD] Invalid mode "${mode}", keeping "${currentMode}"`);
    }
    return currentMode;
  },

  setSchemaValid(valid) {
    schemaValid = Boolean(valid);
  },

  isSchemaValid() {
    return schemaValid;
  },

  isWritable() {
    return currentMode === 'on' && schemaValid;
  },

  /**
   * Central wrapper for all Discord permission write operations.
   *
   * @param {object} op
   * @param {string} op.guildId - Guild Snowflake ID
   * @param {string} op.feature - Feature subsystem (e.g. 'lockdown', 'antinuke', 'permify', 'tickets', 'shop')
   * @param {string} [op.jobId] - Optional async job ID
   * @param {'role'|'channel'|'guild'} op.targetType - Target Discord object type
   * @param {string} op.targetId - Target Snowflake ID
   * @param {string} op.op - Operation description (e.g. 'set_permissions', 'edit_overwrite')
   * @param {string} op.field - Field affected (e.g. 'permissions', 'permissionOverwrites')
   * @param {any} [op.oldValue] - Serialized previous value
   * @param {any} [op.newValue] - Serialized target value
   * @param {string} [op.reason] - Audit log reason
   * @param {Function} op.execute - Async callback executing the Discord REST call
   * @returns {Promise<{ success: boolean, mode: string, executed: boolean, refused?: boolean, reason?: string, result?: any, wouldChange?: any }>}
   */
  async apply(op) {
    const {
      guildId,
      feature = 'unknown',
      jobId = null,
      targetType = 'channel',
      targetId = '0',
      op: operationName = 'modify_permission',
      field = 'permissions',
      oldValue = null,
      newValue = null,
      reason = 'AVA Automated Permission Operation',
      execute
    } = op;

    const oldStr = typeof oldValue === 'object' && oldValue !== null ? JSON.stringify(oldValue) : String(oldValue ?? '');
    const newStr = typeof newValue === 'object' && newValue !== null ? JSON.stringify(newValue) : String(newValue ?? '');

    // 1. Guard check: OFF mode
    if (currentMode === 'off') {
      logger.warn(
        { guildId, feature, targetId, op: operationName },
        `[PERM-FREEZE] Refused permission write (${feature}/${operationName}) on target ${targetId}: PERMISSION_WRITES=off`
      );
      return {
        success: false,
        mode: 'off',
        executed: false,
        refused: true,
        reason: 'PERMISSION_WRITES=off'
      };
    }

    // 2. Guard check: DRYRUN mode
    if (currentMode === 'dryrun') {
      logger.info(
        { guildId, feature, targetId, op: operationName, oldStr, newStr },
        `[PERM-DRYRUN] Would write ${field} (${feature}/${operationName}) on ${targetType} ${targetId}: [${oldStr}] -> [${newStr}]`
      );
      return {
        success: true,
        mode: 'dryrun',
        executed: false,
        refused: false,
        wouldChange: { oldValue: oldStr, newValue: newStr }
      };
    }

    // 3. Guard check: Schema validity
    if (!schemaValid) {
      logger.warn(
        { guildId, feature },
        `[PERM-FREEZE] Refused permission write: database schema validation incomplete or missing required tables`
      );
      return {
        success: false,
        mode: 'on',
        executed: false,
        refused: true,
        reason: 'schema_missing'
      };
    }

    // 4. ON mode: Execute real write
    if (typeof execute !== 'function') {
      throw new Error(`[PERM-GUARD] perm.apply() requires an executable async function for operation: ${operationName}`);
    }

    let result;
    try {
      result = await execute();
    } catch (err) {
      logger.error(
        { err, guildId, feature, targetId, op: operationName },
        `[PERM-GUARD] Failed executing permission write on ${targetType} ${targetId}`
      );
      throw err;
    }

    // 5. Asynchronously log write to permission_write_log
    db.from('permission_write_log')
      .insert({
        guild_id: String(guildId),
        feature: String(feature),
        job_id: jobId ? String(jobId) : null,
        target_id: String(targetId),
        target_type: String(targetType),
        op: String(operationName),
        field: String(field),
        old_value: oldStr,
        new_value: newStr,
        reason: String(reason || ''),
        created_at: new Date().toISOString()
      })
      .then(({ error }) => {
        if (error) {
          logger.warn({ error, guildId }, '[PERM-GUARD] Failed recording write to permission_write_log');
        }
      })
      .catch((err) => {
        logger.warn({ err, guildId }, '[PERM-GUARD] Unexpected error logging to permission_write_log');
      });

    return {
      success: true,
      mode: 'on',
      executed: true,
      result
    };
  }
};

export default perm;

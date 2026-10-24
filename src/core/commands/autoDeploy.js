import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger/index.js';
import { registry } from '../../structures/CommandRegistry.js';
import { db } from '../../db/client.js';

const COMMAND_CACHE_FILE = path.join(process.cwd(), 'cache', '.command_hash.json');

// Discord API limits for slash commands
const DISCORD_NAME_REGEX = /^[\p{Ll}\p{Lm}\p{Lo}\p{N}\p{sc=Devanagari}\p{sc=Thai}_-]+$/u;
const MAX_COMMAND_NAME = 32;
const MAX_DESCRIPTION = 100;
const MAX_OPTIONS = 25;

/**
 * Validates a single Discord slash command definition against Discord limits.
 * @param {object} cmd
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateCommandDefinition(cmd) {
  if (!cmd || typeof cmd !== 'object') {
    return { valid: false, error: 'Command payload is not an object' };
  }

  if (!cmd.name || typeof cmd.name !== 'string') {
    return { valid: false, error: 'Command missing required "name"' };
  }

  if (cmd.name.length < 1 || cmd.name.length > MAX_COMMAND_NAME) {
    return { valid: false, error: `Command "${cmd.name}" name length must be 1-${MAX_COMMAND_NAME} characters (got ${cmd.name.length})` };
  }

  if (!DISCORD_NAME_REGEX.test(cmd.name)) {
    return { valid: false, error: `Command "${cmd.name}" has invalid characters (must be lowercase alphanumeric, dashes, or underscores)` };
  }

  if (!cmd.description || typeof cmd.description !== 'string') {
    return { valid: false, error: `Command "${cmd.name}" missing required "description"` };
  }

  if (cmd.description.length < 1 || cmd.description.length > MAX_DESCRIPTION) {
    return { valid: false, error: `Command "${cmd.name}" description length must be 1-${MAX_DESCRIPTION} characters (got ${cmd.description.length})` };
  }

  if (Array.isArray(cmd.options)) {
    if (cmd.options.length > MAX_OPTIONS) {
      return { valid: false, error: `Command "${cmd.name}" exceeds maximum of ${MAX_OPTIONS} options (got ${cmd.options.length})` };
    }

    for (const opt of cmd.options) {
      if (!opt.name || !DISCORD_NAME_REGEX.test(opt.name)) {
        return { valid: false, error: `Command "${cmd.name}" option "${opt.name}" has invalid name` };
      }
      if (!opt.description || opt.description.length > MAX_DESCRIPTION) {
        return { valid: false, error: `Command "${cmd.name}" option "${opt.name}" description exceeds ${MAX_DESCRIPTION} characters` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates a list of slash commands and filters out invalid ones.
 * @param {Array<object>} commands
 * @returns {{ validCommands: Array<object>, errors: Array<{ command: string, error: string }> }}
 */
export function validateAllCommands(commands) {
  const validCommands = [];
  const errors = [];

  for (const cmd of commands) {
    const res = validateCommandDefinition(cmd);
    if (!res.valid) {
      errors.push({ command: cmd?.name || 'unknown', error: res.error });
      logger.warn(`[COMMANDS] Skipping invalid command "${cmd?.name || 'unknown'}": ${res.error}`);
    } else {
      validCommands.push(cmd);
    }
  }

  return { validCommands, errors };
}

/**
 * Recursively normalizes a command structure for deterministic hashing.
 * @param {object} cmd
 * @returns {object}
 */
function normalizeCommandForHash(cmd) {
  const normalized = {
    name: cmd.name,
    description: cmd.description,
    type: cmd.type ?? 1,
    default_member_permissions: cmd.default_member_permissions ?? null,
    dm_permission: cmd.dm_permission ?? false,
    options: []
  };

  if (Array.isArray(cmd.options)) {
    normalized.options = cmd.options
      .map(opt => ({
        name: opt.name,
        description: opt.description,
        type: opt.type,
        required: Boolean(opt.required),
        choices: Array.isArray(opt.choices)
          ? [...opt.choices].sort((a, b) => String(a.name).localeCompare(String(b.name)))
          : undefined,
        options: Array.isArray(opt.options)
          ? opt.options.map(o => normalizeCommandForHash(o))
          : undefined
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  return normalized;
}

/**
 * Computes a deterministic SHA-256 hash of all command definitions.
 * @param {Array<object>} commands
 * @returns {string}
 */
export function computeCommandsHash(commands) {
  if (!Array.isArray(commands)) return '';

  const normalizedList = commands
    .map(c => normalizeCommandForHash(c))
    .sort((a, b) => a.name.localeCompare(b.name));

  const jsonStr = JSON.stringify(normalizedList);
  return crypto.createHash('sha256').update(jsonStr).digest('hex');
}

/**
 * Reads the last deployed command hash from cache or Supabase.
 * @returns {Promise<string|null>}
 */
export async function getStoredCommandHash() {
  // 1. Try local cache file
  try {
    if (fs.existsSync(COMMAND_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(COMMAND_CACHE_FILE, 'utf8'));
      if (data?.hash) return data.hash;
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not read local command hash file');
  }

  // 2. Try Supabase state table if available
  try {
    const { data } = await db
      .from('bot_state')
      .select('value')
      .eq('key', 'command_hash')
      .maybeSingle();

    if (data?.value?.hash) {
      return data.value.hash;
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Could not read remote command hash from Supabase');
  }

  return null;
}

/**
 * Persists the newly deployed command hash to local file and Supabase.
 * @param {string} hash
 * @param {number} count
 * @returns {Promise<void>}
 */
export async function saveStoredCommandHash(hash, count) {
  const payload = {
    hash,
    count,
    deployed_at: new Date().toISOString()
  };

  // 1. Write to local file
  try {
    const dir = path.dirname(COMMAND_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COMMAND_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to write local command hash cache');
  }

  // 2. Write to Supabase bot_state if available
  try {
    await db.from('bot_state').upsert({
      key: 'command_hash',
      value: payload,
      updated_at: new Date().toISOString()
    });
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to persist command hash to remote database');
  }
}

/**
 * Automatically deploys application (/) commands to Discord if changes are detected.
 * Never blocks bot startup beyond a 5-second initial attempt; will retry in background.
 *
 * @param {import('discord.js').Client} client
 * @param {object} [options]
 * @param {boolean} [options.force=false] Force redeploy regardless of hash
 * @param {string} [options.scope] 'global' or 'guild'
 * @param {string} [options.guildId] Target guild ID if scope is 'guild'
 * @returns {Promise<{ deployed: boolean, count: number, hash: string, reason?: string }>}
 */
export async function autoDeployCommands(client, options = {}) {
  const role = (process.env.INSTANCE_ROLE || '').toLowerCase();
  const devGuildId = process.env.DEV_GUILD_ID || options.guildId || process.env.COMMAND_GUILD_ID;
  const isDev = role === 'dev';
  const scope = isDev && devGuildId ? 'guild' : (options.scope || process.env.COMMAND_SCOPE || 'global');
  const targetGuildId = isDev && devGuildId ? devGuildId : (options.guildId || process.env.COMMAND_GUILD_ID);

  // 1. Retrieve all commands from registry
  const rawSlashData = registry.toSlashData();
  const { validCommands, errors } = validateAllCommands(rawSlashData);

  if (errors.length > 0) {
    logger.warn(`[COMMANDS] ${errors.length} command definition(s) failed validation and were excluded`);
  }

  // 2. Compute current hash
  const currentHash = computeCommandsHash(validCommands);
  const storedHash = await getStoredCommandHash();

  // 3. Compare hash
  if (!force && storedHash && storedHash === currentHash) {
    logger.info(`✿ Commands up to date (cached, no changes: ${validCommands.length} commands)`);
    return {
      deployed: false,
      count: validCommands.length,
      hash: currentHash,
      reason: 'cached'
    };
  }

  logger.info(`✿ Changes detected in command definitions (or forced). Deploying ${validCommands.length} commands (${scope})...`);

  // 4. Deploy execution wrapped in a safe timeout guard so startup isn't blocked
  const deployPromise = async () => {
    try {
      if (scope === 'guild' && targetGuildId) {
        const guild = await client.guilds.fetch(targetGuildId).catch(() => null);
        if (!guild) {
          throw new Error(`Target guild "${targetGuildId}" not found for guild-scoped deployment`);
        }
        await guild.commands.set(validCommands);
        logger.info(`✓ Deployed ${validCommands.length} commands to guild ${guild.name} (${guild.id})`);
      } else {
        await client.application.commands.set(validCommands);
        logger.info(`✓ Deployed ${validCommands.length} commands globally to Discord Gateway`);

        // Clean up any stale guild-level command overrides that would shadow global commands
        for (const guild of client.guilds.cache.values()) {
          try {
            const guildCmds = await guild.commands.fetch().catch(() => new Map());
            if (guildCmds.size > 0) {
              await guild.commands.set([]);
              logger.info(`✓ Wiped ${guildCmds.size} stale guild-level overrides from ${guild.name}`);
            }
          } catch (err) {
            logger.debug({ err: err.message, guild: guild.name }, 'Could not clean guild-level commands');
          }
        }
      }

      // 5. Persist the new hash on success
      await saveStoredCommandHash(currentHash, validCommands.length);
      logger.info(`✿ Commands deployed (${validCommands.length})`);
      return { deployed: true, count: validCommands.length, hash: currentHash };
    } catch (err) {
      if (err.status === 429) {
        const retryAfter = (err.rawError?.retry_after || 5) * 1000;
        logger.warn(`[COMMANDS] Discord rate limit 429 hit during command deploy. Retrying in ${retryAfter / 1000}s...`);
        setTimeout(() => {
          autoDeployCommands(client, { ...options, force: true }).catch(e => {
            logger.error({ err: e }, '[COMMANDS] Background retry failed');
          });
        }, retryAfter);
        return { deployed: false, count: validCommands.length, hash: currentHash, reason: 'rate_limited' };
      }
      logger.error({ err }, '[COMMANDS] Failed to deploy application commands');
      throw err;
    }
  };

  // Guard startup: race deploy against a 5-second timeout
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Command deployment timed out (continuing in background)')), 5000);
  });

  try {
    return await Promise.race([deployPromise(), timeoutPromise]);
  } catch (err) {
    logger.warn(`[COMMANDS] ${err.message}`);
    // Let deploy finish in background if it timed out
    deployPromise().catch(bgErr => {
      logger.error({ err: bgErr }, '[COMMANDS] Background deployment error');
    });
    return { deployed: false, count: validCommands.length, hash: currentHash, reason: 'background_pending' };
  }
}

export default {
  validateCommandDefinition,
  validateAllCommands,
  computeCommandsHash,
  getStoredCommandHash,
  saveStoredCommandHash,
  autoDeployCommands
};

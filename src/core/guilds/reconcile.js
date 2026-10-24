import { db } from '../../db/client.js';
import { logger } from '../logger/index.js';
import {
  guildSettingsCache,
  getDefaultSettings,
  preloadGuildSettings
} from '../cache/guildCache.js';
import { markGuildLeft, unmarkGuildLeft } from '../../db/guilds.js';
import { brand } from '../../config/brand.js';
import { copy } from '../../config/copy.js';

/**
 * Startup Reconciliation Job:
 * Scans all guilds the bot is currently in, checks Supabase for missing settings rows,
 * and creates missing rows with default settings WITHOUT EVER overwriting existing rows.
 * Then warms the settings cache in one batch.
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<{ total: number, missing: number, initialized: number }>}
 */
export async function reconcileGuildSettings(client) {
  if (!client?.guilds?.cache?.size) {
    logger.info('✿ Guild reconciliation: 0 active guilds connected');
    return { total: 0, missing: 0, initialized: 0 };
  }

  const allGuildIds = Array.from(client.guilds.cache.keys());
  const total = allGuildIds.length;

  try {
    // 1. Fetch all existing guild IDs in database in one light query
    const { data: existingRows, error } = await db
      .from('guild_settings')
      .select('guild_id');

    if (error) {
      logger.warn({ err: error.message }, 'Could not fetch existing guild settings during reconciliation');
      // Still pre-warm cache from whatever is available
      await preloadGuildSettings(client);
      return { total, missing: 0, initialized: 0 };
    }

    const existingIdSet = new Set(existingRows?.map(r => r.guild_id) || []);
    const missingIds = allGuildIds.filter(id => !existingIdSet.has(id));

    // 2. Insert missing guild settings rows in batches (insert only, NEVER overwrite)
    let initialized = 0;
    if (missingIds.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const batch = missingIds.slice(i, i + batchSize);
        const rowsToInsert = batch.map(id => getDefaultSettings(id));

        const { error: insertError } = await db
          .from('guild_settings')
          .insert(rowsToInsert);

        if (insertError) {
          logger.warn({ err: insertError.message }, `Failed inserting default settings for batch of ${batch.length} guilds`);
        } else {
          initialized += batch.length;
        }
      }
      logger.info(`✿ Guild reconciliation: created ${initialized} missing settings rows across ${total} guilds`);
    } else {
      logger.info(`✿ Guild reconciliation: all ${total} guilds are up to date in database`);
    }

    // 3. Warm the cache in one batch
    await preloadGuildSettings(client);

    return { total, missing: missingIds.length, initialized };
  } catch (err) {
    logger.error({ err }, 'Error during guild reconciliation');
    return { total, missing: 0, initialized: 0 };
  }
}

/**
 * Handles guildCreate:
 * - Insert-if-missing default settings
 * - Unmarks left_at timestamp
 * - Pre-warms cache
 * - Sends owner welcome if SEND_OWNER_WELCOME === 'true'
 *
 * @param {import('discord.js').Guild} guild
 */
export async function handleGuildCreate(guild) {
  if (!guild?.id) return;
  logger.info(`Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

  try {
    // 1. Unmark left if it was previously left
    await unmarkGuildLeft(guild.id).catch(() => {});

    // 2. Insert-if-missing (check DB row first, never overwrite existing)
    const { data: existing } = await db
      .from('guild_settings')
      .select('guild_id')
      .eq('guild_id', guild.id)
      .maybeSingle();

    if (!existing) {
      const defaults = getDefaultSettings(guild.id);
      await db.from('guild_settings').insert(defaults);
      guildSettingsCache.set(guild.id, defaults);
      logger.info(`✿ Initialized default settings for guild "${guild.name}" (${guild.id})`);
    } else {
      // Warm cache with existing settings
      guildSettingsCache.delete(guild.id);
    }

    // 3. Send welcome message to owner if enabled
    if (process.env.SEND_OWNER_WELCOME === 'true') {
      sendOwnerWelcome(guild).catch(err => {
        logger.debug({ err: err.message }, 'Could not send owner welcome message');
      });
    }
  } catch (err) {
    logger.error({ err }, `Error during guildCreate handling for "${guild.name}"`);
  }
}

/**
 * Sends a clean Components V2 welcome message to guild owner.
 * @param {import('discord.js').Guild} guild
 */
async function sendOwnerWelcome(guild) {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return;

  const text = [
    `## ${brand.emojis.flower} Welcome to ${brand.name}`,
    `Thank you for inviting **${brand.name}** to **${guild.name}**!`,
    '',
    `• Configure moderation, antinuke, tickets, and shop using \`/settings\` or \`/help\`.`,
    `• All server settings are securely protected and backed up.`,
    '',
    `-# ${brand.footerText}`
  ].join('\n');

  await owner.send({
    content: text
  }).catch(() => {
    // DMs closed or blocked - ignore gracefully
  });
}

/**
 * Handles guildDelete:
 * Marks guild as left with timestamp.
 *
 * @param {import('discord.js').Guild} guild
 */
export async function handleGuildDelete(guild) {
  if (!guild?.id) return;
  logger.info(`Left guild: ${guild.name} (${guild.id})`);
  try {
    await markGuildLeft(guild.id);
    guildSettingsCache.delete(guild.id);
  } catch (err) {
    logger.warn({ err: err.message }, `Error marking guild ${guild.id} as left`);
  }
}

export default {
  reconcileGuildSettings,
  handleGuildCreate,
  handleGuildDelete
};

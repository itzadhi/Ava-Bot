import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/index.js';
import { updateGuildSettings, getGuildSettings } from '../src/db/guilds.js';
import { createSuggestion, updateSuggestion, getSuggestionById } from '../src/db/suggestions.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const FEEDBACK_CONFIG_PATH = path.join(rootDir, 'temp/Feedback-Bot-main/data/config.json');
const SUGGESTIONS_DB_PATH = path.join(rootDir, 'temp/Suggestions-Bot-main/db.json');

export async function runMigration() {
  logger.info('🚀 Starting idempotent migration from ./temp legacy databases...');
  let feedbackGuildsCount = 0;
  let suggestionsGuildsCount = 0;
  let suggestionsImported = 0;
  let votesImported = 0;

  // 1. MIGRATE FEEDBACK CONFIG
  if (fs.existsSync(FEEDBACK_CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(FEEDBACK_CONFIG_PATH, 'utf-8');
      const data = JSON.parse(raw);

      for (const [guildId, cfg] of Object.entries(data)) {
        if (!guildId || !cfg?.feedbackChannel) continue;
        await updateGuildSettings(guildId, {
          feedback_channel_id: cfg.feedbackChannel,
          feedback_enabled: true
        });
        feedbackGuildsCount++;
        logger.info(`✓ Imported feedback channel for guild ${guildId}: ${cfg.feedbackChannel}`);
      }
    } catch (err) {
      logger.error({ err }, 'Failed migrating Feedback config');
    }
  } else {
    logger.info('ℹ️ No Feedback config.json found at ./temp/Feedback-Bot-main/data/config.json');
  }

  // 2. MIGRATE SUGGESTIONS DB
  if (fs.existsSync(SUGGESTIONS_DB_PATH)) {
    try {
      const raw = fs.readFileSync(SUGGESTIONS_DB_PATH, 'utf-8');
      const data = JSON.parse(raw);
      const guilds = data.guilds || {};

      for (const [guildId, guildData] of Object.entries(guilds)) {
        suggestionsGuildsCount++;
        const updates = {};
        if (guildData.suggestionChannelId) {
          updates.suggestion_channel_id = guildData.suggestionChannelId;
          updates.suggestions_enabled = true;
        }

        if (Object.keys(updates).length > 0) {
          await updateGuildSettings(guildId, updates);
          logger.info(`✓ Imported suggestions settings for guild ${guildId}`);
        }

        const suggestions = guildData.suggestions || {};
        for (const [messageId, sug] of Object.entries(suggestions)) {
          const sugId = `sug_migrated_${messageId}`;

          const upvotesList = Array.isArray(sug.upvotes) ? sug.upvotes : [];
          const downvotesList = Array.isArray(sug.downvotes) ? sug.downvotes : [];

          const sugRecord = {
            id: sugId,
            guild_id: guildId,
            channel_id: guildData.suggestionChannelId || null,
            message_id: messageId,
            author_id: sug.authorId || '000000000000000000',
            author_username: sug.authorUsername || 'Legacy User',
            author_avatar: sug.authorAvatarURL || null,
            text: sug.text || 'Legacy suggestion',
            status: sug.status || 'pending',
            upvotes_count: upvotesList.length,
            downvotes_count: downvotesList.length,
            created_at: sug.createdAt ? new Date(sug.createdAt).toISOString() : new Date().toISOString()
          };

          // Idempotent upsert
          await db.from('suggestions').upsert(sugRecord);
          suggestionsImported++;

          // Migrate votes
          for (const voterId of upvotesList) {
            await db.from('suggestion_votes').upsert({
              suggestion_id: sugId,
              guild_id: guildId,
              user_id: voterId,
              vote_type: 'up'
            });
            votesImported++;
          }
          for (const voterId of downvotesList) {
            await db.from('suggestion_votes').upsert({
              suggestion_id: sugId,
              guild_id: guildId,
              user_id: voterId,
              vote_type: 'down'
            });
            votesImported++;
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed migrating Suggestions database');
    }
  } else {
    logger.info('ℹ️ No Suggestions db.json found at ./temp/Suggestions-Bot-main/db.json');
  }

  const summary = {
    feedbackGuildsCount,
    suggestionsGuildsCount,
    suggestionsImported,
    votesImported
  };

  logger.info(summary, '🎉 Migration from ./temp completed successfully');
  return summary;
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  runMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('Fatal migration error:', err);
      process.exit(1);
    });
}

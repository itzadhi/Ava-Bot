import { ShardingManager } from 'discord.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const botFile = path.join(__dirname, 'index.js');

logger.info('Initializing Argoni ShardingManager (Scale-ready for 2,500+ guilds)...');

export const manager = new ShardingManager(botFile, {
  totalShards: 'auto',
  token: config.DISCORD_TOKEN,
  mode: 'process',
  respawn: true
});

manager.on('shardCreate', (shard) => {
  logger.info(`[Shard #${shard.id}] Launched worker process`);

  shard.on('disconnect', () => {
    logger.warn(`[Shard #${shard.id}] Disconnected from Discord gateway`);
  });

  shard.on('reconnecting', () => {
    logger.info(`[Shard #${shard.id}] Reconnecting to Discord gateway...`);
  });

  shard.on('death', (process) => {
    logger.error(`[Shard #${shard.id}] Shard process died with exit code ${process.exitCode}`);
  });
});

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  manager.spawn().catch((err) => {
    logger.fatal({ err }, 'Failed to spawn shard cluster');
    process.exit(1);
  });
}

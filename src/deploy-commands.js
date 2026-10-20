import { REST, Routes } from 'discord.js';
import { config } from './config.js';
import { registry } from './structures/CommandRegistry.js';
import { loadCommands } from './structures/loader.js';
import { logger } from './utils/logger.js';

async function deploy() {
  logger.info('Loading commands for deployment...');
  await loadCommands();

  const commands = registry.toSlashData();
  logger.info(`Prepared ${commands.length} application (/) commands for registration.`);

  if (!config.DISCORD_TOKEN || config.DISCORD_TOKEN.startsWith('dummy_')) {
    logger.warn('Skipping Discord API deployment: Valid DISCORD_TOKEN is not configured.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  try {
    logger.info(`Started refreshing ${commands.length} application (/) commands...`);

    const data = await rest.put(
      Routes.applicationCommands(config.CLIENT_ID),
      { body: commands }
    );

    logger.info(`✓ Successfully deployed ${data.length} application (/) commands globally.`);
  } catch (error) {
    logger.error({ error }, 'Failed to deploy slash commands to Discord');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  deploy();
}

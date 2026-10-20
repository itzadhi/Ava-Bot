import {
  Client,
  GatewayIntentBits,
  ActivityType,
  Partials,
  Events
} from 'discord.js';
import { config, validateLiveCredentials } from './config.js';
import { logger } from './utils/logger.js';
import { loadCommands, loadModules } from './structures/loader.js';
import { registry, CommandRegistry } from './structures/CommandRegistry.js';
import { componentRegistry, ComponentRegistry, defineComponent } from './structures/ComponentRegistry.js';
import { moduleRegistry, ModuleRegistry } from './structures/ModuleRegistry.js';
import { ArgoniModule, defineModule } from './structures/Module.js';
import { CommandContext } from './structures/CommandContext.js';
import { initBlacklistCache } from './db/blacklist.js';
import { initBotState, getBotState } from './db/botState.js';
import { logError } from './db/errors.js';
import { startScheduler, stopScheduler } from './services/scheduler.js';
import { queue } from './services/queue.js';
import { db, getSupabase } from './db/index.js';
import * as ui from './ui/index.js';

import { onInteractionCreate } from './events/interactionCreate.js';
import { onMessageCreate } from './events/messageCreate.js';
import { onVoiceStateUpdate } from './events/voiceStateUpdate.js';
import { onGuildCreate } from './events/guildCreate.js';
import { onGuildDelete } from './events/guildDelete.js';
import { handleMessageSync, handleBanSync, handleRoleAssignSync } from './modules/sync/dispatcher.js';
import { backupModule } from './modules/backup/index.js';
import { starterModule } from './modules/starter/index.js';
import { recordLiveMessage } from './modules/chatlog/engine.js';
import { reconcileTempChannels } from './modules/voice/jtc.js';
import { ttsEngine } from './modules/voice/tts/engine.js';
import { handleAutoSuggest } from './modules/suggestions/index.js';
import { handleAutoFeedback, handleFeedbackImageUpload } from './modules/feedback/index.js';
import { handleAutoModMessage } from './modules/automod/engine.js';
import { handleBoostMemberUpdate } from './modules/boosts/tracker.js';
import { handleStickyMessage } from './modules/sticky/engine.js';
import { handleStickyRoleMemberLeave, handleStickyRoleMemberRejoin } from './modules/stickyroles/engine.js';
import { handleAutoRoleMemberJoin } from './modules/autorole/engine.js';
import { registerLogListeners } from './modules/logs/listeners.js';
import { startTicketScheduler, stopTicketScheduler, handleMemberLeave, handleChannelDelete } from './modules/tickets/autoclose.js';

/**
 * ArgoniClient - Reusable Discord Bot Client powered by Components V2 & Supabase
 */
export class ArgoniClient extends Client {
  /**
   * @param {import('discord.js').ClientOptions} [options]
   */
  constructor(options = {}) {
    const defaultIntents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates
    ];

    try {
      defaultIntents.push(GatewayIntentBits.MessageContent);
    } catch (_) {}

    super({
      intents: options.intents || defaultIntents,
      partials: options.partials || [Partials.Channel, Partials.Message, Partials.GuildMember],
      ...options
    });

    this.commands = registry;
    this.components = componentRegistry;
    this.modules = moduleRegistry;
    this.modules.setClient(this);
    this.db = db;
    this.ui = ui;

    // Attach default core event listeners
    this.on('interactionCreate', onInteractionCreate);
    this.on('messageCreate', async (message) => {
      // Real-time AutoMod protection scanning
      const isAutoMod = await handleAutoModMessage(message).catch(() => false);
      if (isAutoMod) return;

      // Sticky notes reposting to stay pinned at the bottom of channel
      await handleStickyMessage(message).catch(() => {});

      // Screenshot drop for pending feedback reviews
      const isFbkImg = await handleFeedbackImageUpload(message).catch(() => false);
      if (isFbkImg) return;

      // Auto-suggest in configured suggestion channel
      const isAutoSug = await handleAutoSuggest(message).catch(() => false);
      if (isAutoSug) return;

      // Auto-feedback in configured feedback channel
      const isAutoFbk = await handleAutoFeedback(message).catch(() => false);
      if (isAutoFbk) return;

      await onMessageCreate(message);
      await handleMessageSync(message);
      await recordLiveMessage(message);
      await ttsEngine.handleMessage(message);
    });
    this.on('voiceStateUpdate', onVoiceStateUpdate);
    this.on('guildCreate', onGuildCreate);
    this.on('guildDelete', onGuildDelete);
    this.on('guildBanAdd', handleBanSync);
    this.on('guildMemberUpdate', async (oldMember, newMember) => {
      await handleRoleAssignSync(oldMember, newMember).catch(() => {});
      await handleBoostMemberUpdate(oldMember, newMember).catch(() => {});
    });
    this.on('guildMemberAdd', async (member) => {
      await handleAutoRoleMemberJoin(member).catch(() => {});
      await handleStickyRoleMemberRejoin(member).catch(() => {});
    });
    this.on('guildMemberRemove', async (member) => {
      await handleStickyRoleMemberLeave(member).catch(() => {});
      await handleMemberLeave(member).catch(() => {});
    });
    this.on('channelDelete', async (channel) => {
      await handleChannelDelete(channel).catch(() => {});
    });

    // Register comprehensive server audit logging listeners
    registerLogListeners(this);

    this.once(Events.ClientReady, async (readyClient) => {
      if (typeof logger.ready === 'function') {
        logger.ready({
          tag: readyClient.user.tag,
          id: readyClient.user.id,
          guilds: readyClient.guilds.cache.size,
          ping: Math.round(readyClient.ws.ping)
        });
      } else {
        logger.info(`✓ Logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
      }

      if (!readyClient.options.intents.has(GatewayIntentBits.MessageContent)) {
        logger.warn('⚠️ MessageContent intent not enabled. Prefix commands will degrade gracefully.');
      }

      const presenceConfig = getBotState('presence') || { type: 'Playing', text: '/backup | /setting', status: 'online' };
      readyClient.user.setPresence({
        activities: [{ name: presenceConfig.text, type: ActivityType.Playing }],
        status: presenceConfig.status || 'online'
      });

      // Synchronize application commands with Discord
      try {
        const slashCommands = registry.toSlashData();
        await readyClient.application.commands.set(slashCommands);
        logger.info(`✓ Synced ${slashCommands.length} application (/) commands globally with Discord Gateway.`);

        // Clear any stale guild-level command overrides from all guilds
        for (const guild of readyClient.guilds.cache.values()) {
          const guildCmds = await guild.commands.fetch().catch(() => new Map());
          if (guildCmds.size > 0) {
            await guild.commands.set([]);
            logger.info(`✓ Wiped ${guildCmds.size} stale guild-level commands from ${guild.name}`);
          }
        }
      } catch (err) {
        logger.warn(`Could not sync slash commands on login: ${err.message}`);
      }

      // Reconcile active temporary voice channels
      await reconcileTempChannels(readyClient).catch(err => {
        logger.warn({ err }, 'Error during temporary voice channel reconciliation');
      });

      startScheduler(readyClient);
      startTicketScheduler(readyClient);
    });
  }

  /**
   * Registers a feature module
   * @param {ArgoniModule|object} mod
   */
  async registerModule(mod) {
    return this.modules.register(mod);
  }

  /**
   * Registers a command
   * @param {object} cmd
   */
  registerCommand(cmd) {
    return this.commands.register(cmd);
  }

  /**
   * Registers a component handler (button, select, modal)
   * @param {object} handler
   */
  registerComponent(handler) {
    return this.components.register(handler);
  }

  /**
   * Initializes database and loads all default modules and commands
   */
  async init() {
    if (typeof logger.banner === 'function') {
      logger.banner();
    }
    logger.info('Initializing Argoni Framework...');
    await initBlacklistCache();
    await initBotState();
    await loadCommands();
    await loadModules();
    return this;
  }

  /**
   * Starts the bot connection
   * @param {string} [token=config.DISCORD_TOKEN]
   */
  async start(token = config.DISCORD_TOKEN) {
    await this.init();

    const creds = validateLiveCredentials();
    if (creds.valid || (token && !token.startsWith('dummy_'))) {
      logger.info('Connecting to Discord Gateway...');
      await this.login(token);
    } else {
      logger.info('Running in local/test mode without live Discord token.');
    }
    return this;
  }
}

/**
 * Factory function to create and configure an Argoni bot instance
 * @param {import('discord.js').ClientOptions} [options]
 * @returns {ArgoniClient}
 */
export function createArgoni(options = {}) {
  return new ArgoniClient(options);
}

// Singleton client instance for backwards compatibility and standalone execution
export const client = new ArgoniClient();

// 2. ERROR & CRASH HANDLING
process.on('unhandledRejection', async (reason) => {
  logger.error({ reason }, 'Unhandled Rejection caught in process');
  await logError({
    scope: 'process:unhandledRejection',
    message: reason?.message || String(reason),
    stack: reason?.stack || null
  });
});

process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'Uncaught Exception in process');
  await logError({
    scope: 'process:uncaughtException',
    message: err.message,
    stack: err.stack
  });
});

// 3. GRACEFUL SHUTDOWN
async function handleShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  stopScheduler();
  stopTicketScheduler();

  if (queue.size > 0 || queue.pending > 0) {
    logger.info(`Waiting for ${queue.size + queue.pending} queued operations to finish...`);
    await queue.onIdle();
  }

  try {
    client.destroy();
    logger.info('Discord client destroyed');
  } catch (_) {}

  logger.info('Argoni shut down cleanly. Goodbye.');
  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// 4. BOOTSTRAP FUNCTION
export async function bootstrap() {
  return client.start();
}

// Auto-run if executed directly
if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  bootstrap().catch(err => {
    logger.fatal({ err }, 'Fatal error during startup bootstrap');
    process.exit(1);
  });
}

// Export Framework API
export {
  ArgoniModule,
  defineModule,
  defineComponent,
  CommandRegistry,
  ComponentRegistry,
  ModuleRegistry,
  CommandContext,
  registry,
  componentRegistry,
  moduleRegistry,
  backupModule,
  starterModule,
  db,
  getSupabase,
  ui,
  config
};

export default {
  ArgoniClient,
  createArgoni,
  client,
  defineModule,
  defineComponent,
  backupModule,
  starterModule,
  db,
  ui,
  registry,
  componentRegistry,
  moduleRegistry
};

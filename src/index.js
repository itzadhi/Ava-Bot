import {
  Client,
  GatewayIntentBits,
  ActivityType,
  Partials,
  Events,
  Options
} from 'discord.js';
import { config, validateLiveCredentials } from './config.js';
import { logger } from './utils/logger.js';
import { loadCommands, loadModules } from './structures/loader.js';
import { registry, CommandRegistry } from './structures/CommandRegistry.js';
import { componentRegistry, ComponentRegistry, defineComponent } from './structures/ComponentRegistry.js';
import { moduleRegistry, ModuleRegistry } from './structures/ModuleRegistry.js';
import { AvaModule, defineModule } from './structures/Module.js';
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
import { handleTicketImageDrop } from './modules/tickets/panel.js';
import { instanceManager } from './core/instance.js';
import { startShopExpiryJob, stopShopExpiryJob } from './modules/shop/jobs/expiry.js';
import { getTicketByChannel, updateTicketLastMessage } from './db/tickets.js';
import { autoRepairPermissionsAndTickets } from './modules/permify/repair.js';
import { initAutoModCache } from './db/automod.js';
import { initAntiNukeCache, saveAllChannelSnapshots } from './db/antinuke.js';
import { handleChannelDeleteEvent, queueChannelSnapshot } from './modules/antinuke/restore.js';
import { evaluateRaidMessage, trackMemberJoin, resumeActiveLockdowns } from './modules/antinuke/lockdown.js';
import { handleRoleDeleteEvent, handleRoleUpdateEvent, handleBotAddEvent, handleWebhookCreateEvent } from './modules/antinuke/extra.js';
import { preloadGuildSettings } from './core/cache/guildCache.js';
import { batchWriter } from './core/cache/batchWriter.js';
import { validatePterodactylEnv } from './core/pterodactyl/env.js';
import { startMemoryMonitor, stopMemoryMonitor } from './core/pterodactyl/memory.js';
import { checkCrashLoopGuard, recordCrash, markCleanStartup } from './core/pterodactyl/crashGuard.js';
import { pruneLogsDirectory } from './core/pterodactyl/storage.js';
import { startHealthServer, stopHealthServer } from './core/pterodactyl/healthServer.js';

/**
 * AvaClient - Reusable Discord Bot Client powered by Components V2 & Supabase
 */
class AvaClient extends Client {
  /**
   * @param {import('discord.js').ClientOptions} [options]
   */
  constructor(options = {}) {
    const defaultIntents = [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildWebhooks
    ];

    try {
      defaultIntents.push(GatewayIntentBits.MessageContent);
    } catch (_) {}

    super({
      intents: options.intents || defaultIntents,
      partials: options.partials || [Partials.Channel, Partials.Message, Partials.GuildMember],
      makeCache: Options.cacheWithLimits({
        MessageManager: 50,
        PresenceManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        StageInstanceManager: 0,
        ThreadManager: 25,
        ThreadMemberManager: 0,
        GuildScheduledEventManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        GuildMemberManager: 200,
        UserManager: 200
      }),
      sweepers: {
        ...Options.DefaultSweeperSettings,
        messages: {
          interval: 300,
          lifetime: 1800
        },
        threads: {
          interval: 3600,
          lifetime: 14400
        }
      },
      rest: {
        timeout: 15000,
        retries: 3
      },
      ...options
    });

    this.commands = registry;
    this.components = componentRegistry;
    this.modules = moduleRegistry;
    this.modules.setClient(this);
    this.db = db;
    this.ui = ui;

    // Attach connection health & gateway diagnostic listeners
    this.on('error', (err) => logger.error({ err: err.message }, 'Discord client error'));
    this.on('shardError', (err, shardId) => logger.error({ err: err.message, shardId }, `Discord shard #${shardId} error`));
    this.on('warn', (warning) => logger.warn({ warning }, 'Discord client warning'));
    this.on('shardDisconnect', (event, shardId) => logger.warn({ event, shardId }, `Discord shard #${shardId} disconnected`));
    this.on('shardReconnecting', (shardId) => logger.info({ shardId }, `Discord shard #${shardId} reconnecting`));
    this.on('shardResume', (shardId, replayedEvents) => logger.info({ shardId, replayedEvents }, `Discord shard #${shardId} resumed`));

    // Attach default core event listeners
    this.on('interactionCreate', onInteractionCreate);
    this.on('messageCreate', async (message) => {
      // 1. Intercept drag-and-drop image uploads for ticket panels
      const isImgDrop = await handleTicketImageDrop(message).catch(() => false);
      if (isImgDrop) return;

      // 2. Protect active ticket channels from unwanted module interference
      const isTicketChan = message.channel.name?.startsWith('ticket-') ||
                           message.channel.name?.startsWith('tkt-') ||
                           Boolean(await getTicketByChannel(message.guild?.id, message.channel?.id).catch(() => null));

      if (isTicketChan) {
        // Keep ticket active by updating last_message_at
        updateTicketLastMessage(message.guild?.id, message.channel?.id).catch(() => {});

        // Ticket channels are strictly exempted from AutoMod, AutoSuggest, AutoFeedback, Sticky Notes, and MessageSync
        await onMessageCreate(message);
        return;
      }

      // Real-time Anti-Nuke raid & flood detection
      const isRaid = await evaluateRaidMessage(message).catch(() => false);
      if (isRaid) return;

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
      trackMemberJoin(member);
      await handleBotAddEvent(member).catch(() => {});
      await handleAutoRoleMemberJoin(member).catch(() => {});
      await handleStickyRoleMemberRejoin(member).catch(() => {});
    });
    this.on('guildMemberRemove', async (member) => {
      await handleStickyRoleMemberLeave(member).catch(() => {});
      await handleMemberLeave(member).catch(() => {});
    });
    this.on('channelDelete', async (channel) => {
      await handleChannelDelete(channel).catch(() => {});
      await handleChannelDeleteEvent(channel).catch(() => {});
    });
    this.on('channelCreate', async (channel) => {
      queueChannelSnapshot(channel.guild?.id, channel);
    });
    this.on('channelUpdate', async (oldChannel, newChannel) => {
      queueChannelSnapshot(newChannel.guild?.id, newChannel);
    });
    this.on('roleDelete', async (role) => {
      await handleRoleDeleteEvent(role).catch(() => {});
    });
    this.on('roleUpdate', async (oldRole, newRole) => {
      await handleRoleUpdateEvent(oldRole, newRole).catch(() => {});
    });
    this.on('webhookUpdate', async (channel) => {
      await handleWebhookCreateEvent(channel).catch(() => {});
    });

    // Register comprehensive server audit logging listeners
    registerLogListeners(this);

    this.once(Events.ClientReady, async (readyClient) => {
      markCleanStartup();
      const tWarm0 = performance.now();
      const cachedCount = await preloadGuildSettings(readyClient).catch(() => 0);
      const cacheWarmUpMs = performance.now() - tWarm0;

      const isLiveDb = validateLiveCredentials().valid;
      const dbStatus = isLiveDb ? 'Live Supabase (Online • Keep-Alive)' : 'Memory Adapter (Test/Offline)';

      const configWarnings = [];
      if (!readyClient.options.intents.has(GatewayIntentBits.MessageContent)) {
        configWarnings.push('MessageContent intent disabled (prefix commands will degrade)');
      }

      const memMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
      if (typeof logger.ready === 'function') {
        logger.ready({
          tag: readyClient.user.tag,
          id: readyClient.user.id,
          guilds: readyClient.guilds.cache.size,
          ping: Math.round(readyClient.ws.ping),
          memoryMb
        });
      } else {
        logger.info(`✓ Logged in as ${readyClient.user.tag} (ID: ${readyClient.user.id})`);
      }

      if (typeof logger.startHeartbeat === 'function') {
        logger.startHeartbeat(readyClient);
      }

      const presenceConfig = getBotState('presence') || { type: 'Playing', text: '/backup | /setting', status: 'online' };
      readyClient.user.setPresence({
        activities: [{ name: presenceConfig.text, type: ActivityType.Playing }],
        status: presenceConfig.status || 'online'
      });

      // 1. Audit and print event listener counts to verify zero duplicate registrations
      const monitoredEvents = ['interactionCreate', 'messageCreate', 'ready', 'guildCreate', 'guildDelete', 'error', 'shardError'];
      for (const evt of monitoredEvents) {
        logger.info(`[LISTENERS] Event "${evt}" has ${readyClient.listenerCount(evt)} listener(s) registered`);
      }

      // 2. Start dual-instance heartbeat detector
      instanceManager.startHeartbeat();

      // 3. Synchronize application commands with Discord (fast-boot guarded)
      if (process.env.DEPLOY_COMMANDS === 'true' || process.argv.includes('--deploy')) {
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
      } else {
        logger.info(`⚡ Fast boot: Gateway slash command sync skipped (run with DEPLOY_COMMANDS=true or --deploy to update commands)`);
      }

      // Reconcile active temporary voice channels
      await reconcileTempChannels(readyClient).catch(err => {
        logger.warn({ err }, 'Error during temporary voice channel reconciliation');
      });

      startScheduler(readyClient);
      startTicketScheduler(readyClient);
      startShopExpiryJob(readyClient);
      await autoRepairPermissionsAndTickets(readyClient).catch(err => {
        logger.warn({ err }, 'Error during automatic permission & ticket repair on startup');
      });

      // AutoMod & Anti-Nuke Write-Through Cache Preload & Active Lockdown Monitoring
      await initAutoModCache(readyClient).catch(err => {
        logger.warn({ err }, 'Error preloading AutoMod cache');
      });
      await initAntiNukeCache(readyClient).catch(err => {
        logger.warn({ err }, 'Error preloading Anti-Nuke cache');
      });
      await resumeActiveLockdowns(readyClient).catch(err => {
        logger.warn({ err }, 'Error resuming active lockdowns');
      });

      // Snapshot all channels on ready for active servers
      for (const guild of readyClient.guilds.cache.values()) {
        saveAllChannelSnapshots(guild).catch(() => {});
      }
    });
  }

  /**
   * Registers a feature module
   * @param {AvaModule|object} mod
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
    validatePterodactylEnv();
    pruneLogsDirectory();
    startMemoryMonitor();

    if (typeof logger.banner === 'function') {
      logger.banner();
    }
    const t0 = performance.now();
    if (typeof logger.bootStep === 'function') {
      logger.bootStep('Config & Pterodactyl environment validated', performance.now() - t0);
    }

    const tDb = performance.now();
    await initBlacklistCache();
    await initBotState();
    if (typeof logger.bootStep === 'function') {
      logger.bootStep('Database connected & state loaded', performance.now() - tDb);
    }

    const tCmd = performance.now();
    await loadCommands();
    const cmdCount = registry.getAll().length;
    if (typeof logger.bootStep === 'function') {
      logger.bootStep(`${cmdCount} commands registered`, performance.now() - tCmd);
    }

    const tMod = performance.now();
    await loadModules();
    const modCount = moduleRegistry.getAll().length;
    if (typeof logger.bootStep === 'function') {
      logger.bootStep(`${modCount} modules loaded`, performance.now() - tMod);
    }

    return this;
  }

  /**
   * Starts the bot connection
   * @param {string} [token=config.DISCORD_TOKEN]
   */
  async start(token = config.DISCORD_TOKEN) {
    await this.init();

    // 1. Crash loop backoff guard
    const backoffMs = await checkCrashLoopGuard();
    if (backoffMs > 0) {
      await new Promise(r => setTimeout(r, backoffMs));
    }

    // 2. Optional health endpoint
    startHealthServer(this);

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
 * Factory function to create and configure an AVA bot instance
 * @param {import('discord.js').ClientOptions} [options]
 * @returns {AvaClient}
 */
function createAva(options = {}) {
  return new AvaClient(options);
}

// Singleton client instance for backwards compatibility and standalone execution
const client = new AvaClient();

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
  recordCrash(err);
  await logError({
    scope: 'process:uncaughtException',
    message: err.message,
    stack: err.stack
  });
});

// 3. GRACEFUL SHUTDOWN
async function handleShutdown(signal) {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  stopMemoryMonitor();
  stopHealthServer();
  stopScheduler();
  stopTicketScheduler();
  stopShopExpiryJob();

  if (queue.size > 0 || queue.pending > 0) {
    logger.info(`Waiting for ${queue.size + queue.pending} queued operations to finish...`);
    await queue.onIdle();
  }

  try {
    await batchWriter.destroy();
    logger.info('Batched database writes flushed');
  } catch (_) {}

  try {
    client.destroy();
    logger.info('Discord client destroyed');
  } catch (_) {}

  logger.info('AVA shut down cleanly. Goodbye.');
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
  AvaClient,
  AvaModule,
  createAva,
  client,
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
  AvaClient,
  AvaModule,
  createAva,
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

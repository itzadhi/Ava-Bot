import { logger } from '../utils/logger.js';

/**
 * Base class representing an Argoni feature module.
 * Modules bundle commands, UI component handlers, event listeners,
 * scheduled cron jobs, and database interactions into a reusable unit.
 */
export class ArgoniModule {
  /**
   * @param {object} options
   * @param {string} options.name Unique module identifier (e.g. 'economy', 'backup')
   * @param {string} [options.description] Short description of what this module does
   * @param {string} [options.version='1.0.0'] Module version string
   * @param {Array<object>} [options.commands=[]] Array of Command objects
   * @param {Array<object>} [options.components=[]] Array of Component handlers ({ customId, type, execute })
   * @param {Record<string, Function|Array<Function>>} [options.events={}] Event listeners
   * @param {Array<{ expression: string, run: Function }>} [options.cron=[]] Background cron jobs
   * @param {Function} [options.init] Called when the module is registered/initialized
   * @param {Function} [options.destroy] Called when the module is unregistered/stopped
   */
  constructor(options) {
    if (!options.name || typeof options.name !== 'string') {
      throw new Error('ArgoniModule requires a unique string name');
    }

    this.name = options.name.toLowerCase();
    this.description = options.description || `Argoni ${this.name} module`;
    this.version = options.version || '1.0.0';
    this.commands = options.commands || [];
    this.components = options.components || [];
    this.events = options.events || {};
    this.cron = options.cron || [];
    this.initHook = options.init || null;
    this.destroyHook = options.destroy || null;
    this.enabled = options.enabled !== false;
    this.loaded = false;
  }

  /**
   * Initializes the module with an active Argoni/Discord client
   * @param {import('discord.js').Client} client
   */
  async init(client) {
    if (this.initHook && typeof this.initHook === 'function') {
      await this.initHook(client);
    }
    this.loaded = true;
    logger.debug(`Initialized module: ${this.name} (v${this.version})`);
  }

  /**
   * Cleans up resources when the module is destroyed
   * @param {import('discord.js').Client} client
   */
  async destroy(client) {
    if (this.destroyHook && typeof this.destroyHook === 'function') {
      await this.destroyHook(client);
    }
    this.loaded = false;
    logger.debug(`Destroyed module: ${this.name}`);
  }
}

/**
 * Convenience builder function to define a new Argoni module
 * @param {object} options
 * @returns {ArgoniModule}
 */
export function defineModule(options) {
  return new ArgoniModule(options);
}

export default ArgoniModule;

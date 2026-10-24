import { registry as commandRegistry } from './CommandRegistry.js';
import { AvaModule } from './Module.js';
import { pluginLoader } from '../core/modules/loader.js';
import cron from 'node-cron';

export class ModuleRegistry {
  constructor() {
    this.modules = new Map();
    this.activeCronJobs = new Map();
    this.client = null;
  }

  /**
   * Sets the Discord client reference
   * @param {import('discord.js').Client} client
   */
  setClient(client) {
    this.client = client;
  }

  /**
   * Registers an AVA module
   * @param {AvaModule|object} module
   */
  async register(module) {
    const mod = module instanceof AvaModule ? module : new AvaModule(module);

    if (this.modules.has(mod.name)) {
      logger.warn(`Module "${mod.name}" is already registered. Skipping.`);
      return;
    }

    this.modules.set(mod.name, mod);

    // 1. Register commands
    if (Array.isArray(mod.commands)) {
      for (const cmd of mod.commands) {
        if (!cmd.category) {
          cmd.category = mod.name;
        }
        commandRegistry.register(cmd);
      }
    }

    // 2. Register component handlers
    if (Array.isArray(mod.components)) {
      for (const comp of mod.components) {
        componentRegistry.register(comp);
      }
    }

    // 3. Register event listeners if client is ready
    if (this.client && mod.events) {
      for (const [event, handler] of Object.entries(mod.events)) {
        if (Array.isArray(handler)) {
          handler.forEach(h => this.client.on(event, h));
        } else if (typeof handler === 'function') {
          this.client.on(event, handler);
        }
      }
    }

    // 4. Register cron jobs
    if (Array.isArray(mod.cron)) {
      const jobs = [];
      for (const job of mod.cron) {
        if (job.expression && typeof job.run === 'function') {
          const task = cron.schedule(job.expression, async () => {
            try {
              await job.run(this.client);
            } catch (err) {
              logger.error({ err, module: mod.name }, 'Error running scheduled module cron job');
            }
          });
          jobs.push(task);
        }
      }
      this.activeCronJobs.set(mod.name, jobs);
    }

    // 5. Run module init hook
    if (this.client) {
      await mod.init(this.client);
    }

    logger.info(`Registered AVA Module: [${mod.name}] (v${mod.version}) - ${mod.commands.length} command(s), ${mod.components.length} component(s)`);
  }

  /**
   * Unregisters and destroys a module
   * @param {string} moduleName
   */
  async unregister(moduleName) {
    const name = moduleName.toLowerCase();
    const mod = this.modules.get(name);
    if (!mod) return false;

    // Stop cron jobs
    const jobs = this.activeCronJobs.get(name);
    if (jobs) {
      jobs.forEach(j => j.stop());
      this.activeCronJobs.delete(name);
    }

    // Call destroy hook
    if (this.client) {
      await mod.destroy(this.client);
    }

    this.modules.delete(name);
    logger.info(`Unregistered AVA Module: [${name}]`);
    return true;
  }

  /**
   * Automatically scans a directory and registers any module definitions
   * @param {string} dir
   */
  async loadModulesFromDirectory(dir) {
    if (this.client) {
      pluginLoader.setClient(this.client);
    }
    const res = await pluginLoader.loadAll(this.client, dir);
    for (const record of pluginLoader.getAllModules()) {
      if (record.status === 'enabled') {
        this.modules.set(record.manifest.id.toLowerCase(), record.manifest);
        // Also alias by name if different
        if (record.manifest.name && record.manifest.name.toLowerCase() !== record.manifest.id.toLowerCase()) {
          this.modules.set(record.manifest.name.toLowerCase(), record.manifest);
        }
      }
    }
    return res.loaded;
  }

  get(name) {
    return this.modules.get(name.toLowerCase()) || null;
  }

  getAll() {
    return Array.from(this.modules.values());
  }

  has(name) {
    return this.modules.has(name.toLowerCase());
  }
}

export const moduleRegistry = new ModuleRegistry();
export default moduleRegistry;

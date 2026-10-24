import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../../utils/logger.js';
import { validateModuleManifest } from './contract.js';
import { registry as commandRegistry } from '../../structures/CommandRegistry.js';
import { componentRegistry } from '../../structures/ComponentRegistry.js';
import cron from 'node-cron';

/**
 * Robust Plugin Architecture Module Loader for AVA
 * Provides manifest validation, topological dependency resolution,
 * fault isolation, and live state/health inspection.
 */
export class PluginLoader {
  constructor() {
    this.modules = new Map(); // id -> { manifest, status, error, loadedAt, cronTasks, activeListeners }
    this.client = null;
  }

  setClient(client) {
    this.client = client;
  }

  /**
   * Checks whether a module is enabled according to environment variables and configuration
   * @param {string} moduleId
   * @param {boolean} defaultEnabled
   * @returns {boolean}
   */
  isModuleEnabled(moduleId, defaultEnabled = true) {
    const id = moduleId.toLowerCase();

    // Check specific environment toggle (e.g., MODULE_ANTINUKE_ENABLED=false)
    const specificEnv = process.env[`MODULE_${id.toUpperCase().replace(/-/g, '_')}_ENABLED`];
    if (specificEnv !== undefined) {
      return specificEnv === 'true' || specificEnv === '1';
    }

    // Check comma-separated DISABLED_MODULES
    if (process.env.DISABLED_MODULES) {
      const disabledList = process.env.DISABLED_MODULES.split(',').map(s => s.trim().toLowerCase());
      if (disabledList.includes(id)) return false;
    }

    // Check comma-separated ENABLED_MODULES
    if (process.env.ENABLED_MODULES) {
      const enabledList = process.env.ENABLED_MODULES.split(',').map(s => s.trim().toLowerCase());
      return enabledList.includes(id);
    }

    return defaultEnabled;
  }

  /**
   * Resolves topological dependency order for discovered modules
   * @param {Array<object>} rawManifests
   * @returns {Array<object>} Sorted manifests in safe initialization order
   */
  resolveDependencyOrder(rawManifests) {
    const manifestMap = new Map();
    for (const m of rawManifests) {
      manifestMap.set(m.id.toLowerCase(), m);
    }

    const order = [];
    const visited = new Set();
    const visiting = new Set();

    function visit(id) {
      if (visiting.has(id)) {
        logger.warn({ module: id }, `Circular dependency detected involving module "${id}". Proceeding with best-effort order.`);
        return;
      }
      if (visited.has(id)) return;

      visiting.add(id);
      const manifest = manifestMap.get(id);
      if (manifest && Array.isArray(manifest.dependsOn)) {
        for (const dep of manifest.dependsOn) {
          const depId = dep.toLowerCase();
          if (manifestMap.has(depId)) {
            visit(depId);
          } else {
            logger.warn({ module: id }, `Module "${id}" depends on missing module "${dep}".`);
          }
        }
      }

      visiting.delete(id);
      visited.add(id);
      if (manifest) order.push(manifest);
    }

    for (const id of manifestMap.keys()) {
      if (!visited.has(id)) {
        visit(id);
      }
    }

    return order;
  }

  /**
   * Scans /src/modules and discovers all valid module definitions
   * @param {string} modulesDir
   * @returns {Promise<Array<object>>}
   */
  async discoverModules(modulesDir = path.resolve('src/modules')) {
    const discovered = [];

    try {
      const entries = await fs.promises.readdir(modulesDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(modulesDir, entry.name);
        const candidates = [
          path.join(dirPath, 'module.js'),
          path.join(dirPath, 'index.js'),
          path.join(dirPath, `${entry.name}.js`)
        ];

        let targetFile = null;
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            targetFile = candidate;
            break;
          }
        }

        if (!targetFile) continue;

        try {
          const fileUrl = pathToFileURL(targetFile).href;
          const imported = await import(fileUrl);
          const raw = imported.default || imported.module || imported;

          if (raw && typeof raw === 'object' && (raw.id || raw.name)) {
            // Normalize ID if missing but name is present
            if (!raw.id && raw.name) {
              raw.id = raw.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
            }
            const validation = validateModuleManifest(raw);
            if (validation.valid) {
              discovered.push(validation.manifest);
            } else {
              logger.warn({ module: entry.name }, `Module "${entry.name}" manifest validation failed: ${validation.error}`);
            }
          }
        } catch (err) {
          logger.error({ module: entry.name, err }, `Failed to import module file from ${entry.name}`);
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error scanning modules directory');
    }

    return discovered;
  }

  /**
   * Loads all discovered modules in dependency order with failure isolation
   * @param {import('discord.js').Client} [client]
   * @param {string} [modulesDir]
   */
  async loadAll(client = this.client, modulesDir = path.resolve('src/modules')) {
    if (client) this.setClient(client);

    const discovered = await this.discoverModules(modulesDir);
    const ordered = this.resolveDependencyOrder(discovered);

    let successCount = 0;
    let disabledCount = 0;
    let failedCount = 0;

    for (const manifest of ordered) {
      const isEnabled = this.isModuleEnabled(manifest.id, manifest.defaultEnabled);

      if (!isEnabled) {
        this.modules.set(manifest.id, {
          manifest,
          status: 'disabled',
          error: null,
          loadedAt: null,
          cronTasks: [],
          activeListeners: []
        });
        disabledCount++;
        continue;
      }

      // Fault-isolated loading
      try {
        await this.loadModule(manifest);
        successCount++;
      } catch (err) {
        failedCount++;
        this.modules.set(manifest.id, {
          manifest,
          status: 'failed',
          error: err.message,
          loadedAt: null,
          cronTasks: [],
          activeListeners: []
        });
        logger.error({ module: manifest.id, err }, `[Fault Isolation] Module "${manifest.id}" failed to load. Disabled; continuing execution.`);
      }
    }

    return { total: ordered.length, loaded: successCount, disabled: disabledCount, failed: failedCount };
  }

  /**
   * Instantiates, hooks, and registers a single validated module
   * @param {object} manifest
   */
  async loadModule(manifest) {
    const cronTasks = [];
    const activeListeners = [];

    // 1. Register commands
    if (Array.isArray(manifest.commands)) {
      for (const cmd of manifest.commands) {
        if (!cmd.category) cmd.category = manifest.name;
        commandRegistry.register(cmd);
      }
    }

    // 2. Register component handlers
    if (Array.isArray(manifest.components)) {
      for (const comp of manifest.components) {
        componentRegistry.register(comp);
      }
    }

    // 3. Register event handlers
    if (this.client && manifest.events && typeof manifest.events === 'object') {
      for (const [eventName, handler] of Object.entries(manifest.events)) {
        if (Array.isArray(handler)) {
          for (const h of handler) {
            this.client.on(eventName, h);
            activeListeners.push({ event: eventName, handler: h });
          }
        } else if (typeof handler === 'function') {
          this.client.on(eventName, handler);
          activeListeners.push({ event: eventName, handler });
        }
      }
    }

    // 4. Register cron jobs
    if (Array.isArray(manifest.jobs)) {
      for (const job of manifest.jobs) {
        if (job.expression && typeof job.run === 'function') {
          const task = cron.schedule(job.expression, async () => {
            try {
              await job.run(this.client);
            } catch (err) {
              logger.error({ module: manifest.id, err }, `Scheduled job "${job.name}" encountered an error`);
            }
          });
          cronTasks.push(task);
        }
      }
    }

    // 5. Run module onLoad lifecycle hook
    if (typeof manifest.onLoad === 'function') {
      await manifest.onLoad({
        client: this.client,
        logger: logger.child({ module: manifest.id }),
        manifest
      });
    }

    this.modules.set(manifest.id, {
      manifest,
      status: 'enabled',
      error: null,
      loadedAt: new Date().toISOString(),
      cronTasks,
      activeListeners
    });
  }

  /**
   * Safely unloads a loaded module, stopping cron jobs and unregistering events
   * @param {string} moduleId
   */
  async unloadModule(moduleId) {
    const record = this.modules.get(moduleId.toLowerCase());
    if (!record || record.status !== 'enabled') return false;

    // Stop cron jobs
    for (const task of record.cronTasks) {
      try { task.stop(); } catch (_) {}
    }

    // Remove event listeners
    if (this.client) {
      for (const { event, handler } of record.activeListeners) {
        try { this.client.removeListener(event, handler); } catch (_) {}
      }
    }

    // Run onUnload hook
    if (typeof record.manifest.onUnload === 'function') {
      try {
        await record.manifest.onUnload({ client: this.client, manifest: record.manifest });
      } catch (err) {
        logger.warn({ module: moduleId, err }, `Error during module "${moduleId}" onUnload hook`);
      }
    }

    record.status = 'disabled';
    record.cronTasks = [];
    record.activeListeners = [];
    return true;
  }

  getModule(id) {
    return this.modules.get(id.toLowerCase()) || null;
  }

  getAllModules() {
    return Array.from(this.modules.values());
  }

  /**
   * Performs runtime health checks on all enabled modules
   * @returns {Promise<Array<object>>}
   */
  async runHealthChecks() {
    const results = [];
    for (const [id, record] of this.modules.entries()) {
      if (record.status !== 'enabled') {
        results.push({
          id,
          name: record.manifest.name,
          version: record.manifest.version,
          status: record.status,
          healthy: false,
          details: record.error || 'Module is disabled'
        });
        continue;
      }

      if (typeof record.manifest.healthCheck === 'function') {
        try {
          const hc = await record.manifest.healthCheck(this.client);
          results.push({
            id,
            name: record.manifest.name,
            version: record.manifest.version,
            status: record.status,
            healthy: Boolean(hc?.healthy ?? true),
            details: hc?.details || 'Healthy'
          });
        } catch (err) {
          results.push({
            id,
            name: record.manifest.name,
            version: record.manifest.version,
            status: 'degraded',
            healthy: false,
            details: `Health check error: ${err.message}`
          });
        }
      } else {
        results.push({
          id,
          name: record.manifest.name,
          version: record.manifest.version,
          status: record.status,
          healthy: true,
          details: 'Operational (standard)'
        });
      }
    }
    return results;
  }
}

export const pluginLoader = new PluginLoader();
export default pluginLoader;

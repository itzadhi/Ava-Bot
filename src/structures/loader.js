import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registry } from './CommandRegistry.js';
import { moduleRegistry } from './ModuleRegistry.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const commandsDir = path.resolve(__dirname, '../commands');
const modulesDir = path.resolve(__dirname, '../modules');

/**
 * Recursively scans commands directory and loads all .js command files
 */
export async function loadCommands(dir = commandsDir) {
  let count = 0;

  async function scan(currentDir) {
    try {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await scan(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const fileUrl = pathToFileURL(fullPath).href;
          const mod = await import(fileUrl);
          const command = mod.default || mod;

          if (command && command.name) {
            registry.register(command);
            count++;
          }
        }
      }
    } catch (_) {}
  }

  await scan(dir);

  logger.info(`Loaded and validated ${count} command(s) across ${registry.categories.size} categories`);
  return count;
}

/**
 * Scans modules directory and loads feature modules
 */
export async function loadModules(dir = modulesDir) {
  const loaded = await moduleRegistry.loadModulesFromDirectory(dir);
  logger.info(`Loaded ${loaded} feature module(s) from ${dir}`);
  return loaded;
}

export default { loadCommands, loadModules };

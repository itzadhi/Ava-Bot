import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { registry } from '../src/structures/CommandRegistry.js';
import { componentRegistry } from '../src/structures/ComponentRegistry.js';
import { loadCommands, loadModules } from '../src/structures/loader.js';

async function scan() {
  const t0 = performance.now();
  console.log('=== AVA DIAGNOSTIC SCANNER ===');
  
  // 1. Memory before loading
  const memBefore = process.memoryUsage();

  // 2. Load commands & modules
  await loadCommands();
  await loadModules();

  const loadDurationMs = performance.now() - t0;
  const memAfter = process.memoryUsage();

  // 3. Command analysis
  const commands = registry.getAll();
  const cmdNames = new Map();
  const duplicateCommands = [];

  for (const cmd of commands) {
    if (cmdNames.has(cmd.name)) {
      duplicateCommands.push({ name: cmd.name, first: cmdNames.get(cmd.name), second: cmd.category });
    } else {
      cmdNames.set(cmd.name, cmd.category);
    }

    if (Array.isArray(cmd.aliases)) {
      for (const alias of cmd.aliases) {
        if (cmdNames.has(alias)) {
          duplicateCommands.push({ name: alias, type: 'alias', first: cmdNames.get(alias), second: cmd.name });
        } else {
          cmdNames.set(alias, `${cmd.name} (alias)`);
        }
      }
    }
  }

  // 4. Component handlers analysis
  const components = componentRegistry.getAll?.() || [];
  const compPatterns = new Map();
  const duplicateComponents = [];

  for (const comp of components) {
    const patternStr = comp.pattern?.toString() || comp.id;
    if (compPatterns.has(patternStr)) {
      duplicateComponents.push({ pattern: patternStr, first: compPatterns.get(patternStr) });
    } else {
      compPatterns.set(patternStr, comp.category || 'unknown');
    }
  }

  // 5. File tree analysis
  let totalFiles = 0;
  let totalBytes = 0;
  const dirStats = {};

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'logs', 'cache'].includes(entry.name)) {
          scanDir(full);
        }
      } else if (entry.isFile()) {
        totalFiles++;
        const stat = fs.statSync(full);
        totalBytes += stat.size;
        const topDir = full.split(path.sep)[1] || 'root';
        dirStats[topDir] = (dirStats[topDir] || 0) + stat.size;
      }
    }
  }

  scanDir('.');

  const results = {
    loadDurationMs: Math.round(loadDurationMs * 100) / 100,
    memory: {
      rssMb: Math.round((memAfter.rss / 1024 / 1024) * 100) / 100,
      heapUsedMb: Math.round((memAfter.heapUsed / 1024 / 1024) * 100) / 100,
      heapTotalMb: Math.round((memAfter.heapTotal / 1024 / 1024) * 100) / 100
    },
    commands: {
      total: commands.length,
      duplicates: duplicateCommands
    },
    components: {
      total: components.length,
      duplicates: duplicateComponents
    },
    filesystem: {
      totalFiles,
      totalBytes,
      totalMb: Math.round((totalBytes / 1024 / 1024) * 100) / 100,
      dirStats
    }
  };

  console.log(JSON.stringify(results, null, 2));
}

scan().catch(err => {
  console.error('Scan error:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';

/**
 * AVA Module Generator
 * Scaffolds an expandable, contract-compliant feature module in /src/modules/<name>/
 * Usage: node scripts/new-module.js <module-name>
 */

const rawName = process.argv[2];
if (!rawName) {
  console.error('\n❌ Please provide a module name. Example: npm run new:module polls\n');
  process.exit(1);
}

const id = rawName.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-');
const pascalName = id
  .split(/[-_]/)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1))
  .join('');

const targetDir = path.resolve('src/modules', id);
const testFile = path.resolve('tests', `module_${id}.test.js`);

if (fs.existsSync(targetDir)) {
  console.error(`\n❌ Error: Module directory already exists at ${targetDir}\n`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

// 1. module.js
const moduleJsContent = `import { z } from 'zod';
import { handle${pascalName}Interaction, execute${pascalName}Job } from './index.js';

export const moduleManifest = {
  id: '${id}',
  name: '${pascalName}',
  version: '1.0.0',
  description: '${pascalName} feature module for AVA',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: '${id}:*',
      type: 'any',
      async execute(interaction, args) {
        return handle${pascalName}Interaction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [
    {
      name: '${id}-maintenance',
      expression: '0 * * * *',
      run: async (client) => {
        await execute${pascalName}Job(client).catch(() => {});
      }
    }
  ],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    maxItems: z.number().default(50)
  }),
  defaultSettings: {
    enabled: true,
    maxItems: 50
  },
  copy: {
    success: '${pascalName} action completed successfully.'
  },
  async healthCheck() {
    return { healthy: true, details: '${pascalName} module operational' };
  },
  async onLoad({ logger }) {
    logger.debug('${pascalName} module loaded successfully.');
  },
  async onUnload({ logger }) {
    logger.debug('${pascalName} module unloaded.');
  }
};

export default moduleManifest;
`;

// 2. index.js
const indexJsContent = `import { logger } from '../../utils/logger.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';
import { successCard } from '../../ui/cards.js';

/**
 * Handles component interactions matching ${id}:*
 * @param {import('discord.js').Interaction} interaction
 * @param {string[]} args
 */
export async function handle${pascalName}Interaction(interaction, args = []) {
  return safeRespond(interaction, successCard({
    title: '${pascalName} Interaction',
    subtitle: 'Handled by modular plugin',
    body: \`Received action with args: \${args.join(', ') || 'none'}\`
  }), { ephemeral: true });
}

/**
 * Scheduled maintenance job for ${id}
 * @param {import('discord.js').Client} client
 */
export async function execute${pascalName}Job(client) {
  logger.debug({ module: '${id}' }, 'Executing scheduled maintenance job');
}

export default {
  handle${pascalName}Interaction,
  execute${pascalName}Job
};
`;

// 3. Automated Test
const testContent = `import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleManifest } from '../src/modules/${id}/module.js';
import { validateModuleManifest } from '../src/core/modules/contract.js';
import { validateSettings } from '../src/core/modules/settings.js';

test('${pascalName} Module: manifest complies with standard contract', () => {
  const result = validateModuleManifest(moduleManifest);
  assert.equal(result.valid, true, \`Manifest validation failed: \${result.error}\`);
  assert.equal(moduleManifest.id, '${id}');
  assert.equal(moduleManifest.name, '${pascalName}');
});

test('${pascalName} Module: settings schema validates and falls back safely', () => {
  const validSettings = validateSettings('${id}', { enabled: true, maxItems: 10 }, moduleManifest.settingsSchema, moduleManifest.defaultSettings);
  assert.equal(validSettings.enabled, true);
  assert.equal(validSettings.maxItems, 10);

  const fallbackSettings = validateSettings('${id}', { maxItems: 'invalid_type' }, moduleManifest.settingsSchema, moduleManifest.defaultSettings);
  assert.equal(fallbackSettings.maxItems, 50);
});

test('${pascalName} Module: health check reports healthy', async () => {
  const hc = await moduleManifest.healthCheck();
  assert.equal(hc.healthy, true);
});
`;

fs.writeFileSync(path.join(targetDir, 'module.js'), moduleJsContent, 'utf8');
fs.writeFileSync(path.join(targetDir, 'index.js'), indexJsContent, 'utf8');
fs.writeFileSync(testFile, testContent, 'utf8');

console.log(`\n🌸 Scaffolding completed for module "${id}"!`);
console.log(`  - Manifest:   src/modules/${id}/module.js`);
console.log(`  - Logic:      src/modules/${id}/index.js`);
console.log(`  - Test Suite: tests/module_${id}.test.js`);
console.log(`\nRun "node tests/module_${id}.test.js" to verify.\n`);

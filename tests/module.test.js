import test from 'node:test';
import assert from 'node:assert/strict';
import { defineModule, ArgoniModule } from '../src/structures/Module.js';
import { moduleRegistry } from '../src/structures/ModuleRegistry.js';
import { registry } from '../src/structures/CommandRegistry.js';
import { componentRegistry } from '../src/structures/ComponentRegistry.js';

test('defineModule and ArgoniModule create valid module structures', () => {
  let initCalled = false;
  let destroyCalled = false;

  const sampleModule = defineModule({
    name: 'testmod',
    description: 'Test Feature Module',
    version: '2.1.0',
    commands: [
      {
        name: 'testmod_cmd',
        description: 'Test module command',
        category: 'testmod',
        args: [],
        execute: async (ctx) => {}
      }
    ],
    components: [
      {
        customId: 'testmod:btn',
        type: 'button',
        execute: async (i) => {}
      }
    ],
    init: async (client) => {
      initCalled = true;
    },
    destroy: async (client) => {
      destroyCalled = true;
    }
  });

  assert.ok(sampleModule instanceof AvaModule);
  assert.equal(sampleModule.name, 'testmod');
  assert.equal(sampleModule.version, '2.1.0');
  assert.equal(sampleModule.commands.length, 1);
  assert.equal(sampleModule.components.length, 1);
});

test('ModuleRegistry registers commands, components, and triggers init/destroy hooks', async () => {
  let initialized = false;
  let destroyed = false;

  const mockClient = {
    on: () => {},
    guilds: { cache: new Map() }
  };
  moduleRegistry.setClient(mockClient);

  const mod = defineModule({
    name: 'custom_feature',
    description: 'Custom feature module',
    commands: [
      {
        name: 'custom_action',
        description: 'Executes custom feature action',
        args: [],
        execute: async (ctx) => {}
      }
    ],
    components: [
      {
        customId: 'custom:press',
        type: 'button',
        execute: async (i) => {}
      }
    ],
    init: async () => { initialized = true; },
    destroy: async () => { destroyed = true; }
  });

  await moduleRegistry.register(mod);

  assert.ok(moduleRegistry.has('custom_feature'));
  assert.equal(initialized, true, 'init hook was called');

  // Verify command was registered in registry
  const cmd = registry.resolve('custom_action');
  assert.ok(cmd, 'Command should be registered in CommandRegistry');
  assert.equal(cmd.name, 'custom_action');

  // Verify component was registered in componentRegistry
  const comp = componentRegistry.resolve({ customId: 'custom:press', isButton: () => true });
  assert.ok(comp, 'Component should be resolvable in ComponentRegistry');

  // Unregister
  await moduleRegistry.unregister('custom_feature');
  assert.equal(moduleRegistry.has('custom_feature'), false);
  assert.equal(destroyed, true, 'destroy hook was called');
});

test('backupModule is a fully compliant ArgoniModule with commands, components, and cron', async () => {
  const { backupModule, createServerBackup, restoreServerBackup } = await import('../src/modules/backup/index.js');

  assert.ok(backupModule instanceof AvaModule);
  assert.equal(backupModule.name, 'backup');
  assert.equal(typeof createServerBackup, 'function');
  assert.equal(typeof restoreServerBackup, 'function');

  assert.ok(Array.isArray(backupModule.commands));
  assert.equal(backupModule.commands[0].name, 'backup');

  assert.ok(Array.isArray(backupModule.components));
  const inspectHandler = backupModule.components.find(c => c.customId === 'bk_select_inspect:*');
  assert.ok(inspectHandler, 'Should include bk_select_inspect component handler');

  const moduleSelectHandler = backupModule.components.find(c => c.customId === 'bk_select_modules:*');
  assert.ok(moduleSelectHandler, 'Should include bk_select_modules component handler');

  const deleteHandler = backupModule.components.find(c => c.customId === 'bk_delete_snapshot:*');
  assert.ok(deleteHandler, 'Should include bk_delete_snapshot component handler');

  assert.ok(Array.isArray(backupModule.cron));
  assert.ok(backupModule.cron.some(c => c.expression === '*/15 * * * *'));
});

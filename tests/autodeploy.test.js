import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCommandDefinition,
  validateAllCommands,
  computeCommandsHash,
  autoDeployCommands
} from '../src/core/commands/autoDeploy.js';
import { registry } from '../src/structures/CommandRegistry.js';
import { getDefaultSettings } from '../src/core/cache/guildCache.js';

test('AutoDeploy: validateCommandDefinition checks Discord API constraints', () => {
  // Valid command
  const valid = validateCommandDefinition({
    name: 'ping',
    description: 'Check bot latency and gateway ping'
  });
  assert.equal(valid.valid, true);

  // Invalid: uppercase name
  const upper = validateCommandDefinition({
    name: 'Ping',
    description: 'Valid description'
  });
  assert.equal(upper.valid, false);
  assert.match(upper.error, /invalid characters/);

  // Invalid: name too long
  const longName = validateCommandDefinition({
    name: 'a'.repeat(33),
    description: 'Valid description'
  });
  assert.equal(longName.valid, false);
  assert.match(longName.error, /name length must be 1-32/);

  // Invalid: description too long (>100 chars)
  const longDesc = validateCommandDefinition({
    name: 'test',
    description: 'd'.repeat(101)
  });
  assert.equal(longDesc.valid, false);
  assert.match(longDesc.error, /description length must be 1-100/);

  // Invalid: > 25 options
  const tooManyOpts = validateCommandDefinition({
    name: 'options_test',
    description: 'Test options count',
    options: Array.from({ length: 26 }, (_, i) => ({
      name: `opt_${i}`,
      description: 'Option description',
      type: 3
    }))
  });
  assert.equal(tooManyOpts.valid, false);
  assert.match(tooManyOpts.error, /exceeds maximum of 25 options/);
});

test('AutoDeploy: computeCommandsHash is deterministic and detects modifications', () => {
  const commandsA = [
    { name: 'ping', description: 'Check ping', options: [{ name: 'detailed', description: 'Show breakdown', type: 5 }] },
    { name: 'help', description: 'Show help guide' }
  ];

  // Identical payload in reverse order
  const commandsB = [
    { name: 'help', description: 'Show help guide' },
    { name: 'ping', description: 'Check ping', options: [{ name: 'detailed', description: 'Show breakdown', type: 5 }] }
  ];

  const hashA = computeCommandsHash(commandsA);
  const hashB = computeCommandsHash(commandsB);
  assert.equal(hashA, hashB, 'Hashes should be identical regardless of original array order');
  assert.equal(typeof hashA, 'string');
  assert.equal(hashA.length, 64, 'SHA-256 produces 64 hex characters');

  // Modified payload
  const commandsC = [
    { name: 'help', description: 'Show help guide updated' },
    { name: 'ping', description: 'Check ping', options: [{ name: 'detailed', description: 'Show breakdown', type: 5 }] }
  ];
  const hashC = computeCommandsHash(commandsC);
  assert.notEqual(hashA, hashC, 'Hash should change when a description changes');
});

test('AutoDeploy: validateAllCommands filters bad commands and keeps valid ones', () => {
  const mixed = [
    { name: 'valid_one', description: 'First valid command' },
    { name: 'INVALID_CAPS', description: 'Should be rejected' },
    { name: 'valid_two', description: 'Second valid command' }
  ];

  const { validCommands, errors } = validateAllCommands(mixed);
  assert.equal(validCommands.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].command, 'INVALID_CAPS');
});

test('AutoDeploy: autoDeployCommands respects cache when hash matches', async () => {
  const mockSet = [];
  const mockClient = {
    application: {
      commands: {
        set: async (cmds) => {
          mockSet.push(...cmds);
          return cmds;
        }
      }
    },
    guilds: {
      cache: new Map()
    }
  };

  // First run with force=true to establish hash
  const first = await autoDeployCommands(mockClient, { force: true });
  assert.equal(first.deployed, true);

  // Second run without force should detect cache and skip
  const second = await autoDeployCommands(mockClient, { force: false });
  assert.equal(second.deployed, false);
  assert.equal(second.reason, 'cached');
});

test('Reconcile: getDefaultSettings returns complete safe defaults for new guild', () => {
  const defaults = getDefaultSettings('123456789012345678');
  assert.equal(defaults.guild_id, '123456789012345678');
  assert.equal(defaults.locale, 'en-US');
  assert.equal(defaults.prefix_commands_enabled, true);
  assert.equal(defaults.prefix, 'a!');
  assert.equal(defaults.automod_enabled, true);
  assert.equal(defaults.suggestions_enabled, true);
});

test('Registry: prefix command resolution shares registry definitions and aliases', async () => {
  // If registry is empty in isolated test runner, register a verified command
  if (registry.commands.size === 0) {
    registry.register({
      name: 'ping',
      description: 'Check bot latency and gateway ping',
      category: 'utility',
      aliases: ['latency', 'p'],
      args: [],
      execute: async () => 'pong'
    });

  }

  assert(registry.commands.size > 0, 'Registry must have registered commands');
  
  // Resolve primary command
  const pingCmd = registry.resolve('ping');
  assert(pingCmd, 'Must resolve "ping" command');
  assert.equal(typeof pingCmd.execute, 'function');

  // Case insensitive resolution
  const pingUpper = registry.resolve('PING');
  assert.equal(pingUpper, pingCmd);

  // Alias resolution
  const pingAlias = registry.resolve('latency');
  assert.equal(pingAlias, pingCmd);
});


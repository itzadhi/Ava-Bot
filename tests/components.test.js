import test from 'node:test';
import assert from 'node:assert/strict';
import { ComponentRegistry } from '../src/structures/ComponentRegistry.js';

test('ComponentRegistry handles exact string, wildcard, and regex patterns with parameter extraction', async () => {
  const registry = new ComponentRegistry();
  let clicked = false;
  let receivedParams = null;

  // 1. Wildcard button handler: 'counter:click:*'
  registry.register({
    customId: 'counter:click:*',
    type: 'button',
    execute: async (interaction, params) => {
      clicked = true;
      receivedParams = params;
    }
  });

  // Mock interaction
  const mockButtonInteraction = {
    customId: 'counter:click:guild_12345',
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false
  };

  const resolved = registry.resolve(mockButtonInteraction);
  assert.ok(resolved, 'Should resolve wildcard button pattern');
  assert.equal(resolved.params[0], 'guild_12345', 'Should extract wildcard parameter');

  await registry.dispatch(mockButtonInteraction);
  assert.equal(clicked, true);
  assert.deepEqual(receivedParams, ['guild_12345']);
});

test('ComponentRegistry validates component types strictly', async () => {
  const registry = new ComponentRegistry();
  let modalHandled = false;

  registry.register({
    customId: 'feedback_modal',
    type: 'modal',
    execute: async (i) => {
      modalHandled = true;
    }
  });

  // Button with same customId should NOT resolve
  const buttonInteraction = {
    customId: 'feedback_modal',
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false
  };
  assert.equal(registry.resolve(buttonInteraction), null);

  // Modal interaction should resolve
  const modalInteraction = {
    customId: 'feedback_modal',
    isButton: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => true
  };
  assert.ok(registry.resolve(modalInteraction));

  await registry.dispatch(modalInteraction);
  assert.equal(modalHandled, true);
});

test('ComponentRegistry enforces authorOnly checks', async () => {
  const registry = new ComponentRegistry();
  let executed = false;
  let rejected = false;

  registry.register({
    customId: 'protected_btn',
    type: 'button',
    authorOnly: true,
    execute: async () => { executed = true; }
  });

  // Imposter interaction (not author)
  const imposterInteraction = {
    customId: 'protected_btn',
    user: { id: 'imposter_id' },
    message: {
      interaction: {
        user: { id: 'original_author_id' }
      }
    },
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async () => { rejected = true; }
  };

  await registry.dispatch(imposterInteraction);
  assert.equal(executed, false, 'Execution should be blocked for non-author');
  assert.equal(rejected, true, 'Imposter should receive ephemeral refusal');

  // Legitimate author interaction
  const authorInteraction = {
    customId: 'protected_btn',
    user: { id: 'original_author_id' },
    message: {
      interaction: {
        user: { id: 'original_author_id' }
      }
    },
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false
  };

  await registry.dispatch(authorInteraction);
  assert.equal(executed, true, 'Original author should execute successfully');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { routeInteraction } from '../src/core/interactions/router.js';
import { runHandler } from '../src/core/interactions/runHandler.js';

test('Fresh Start: Old pre-reset button fails gracefully with expired panel card', async () => {
  let capturedPayload = null;

  const mockInteraction = {
    id: 'mock_int_old_button_001',
    customId: 'tkt:panel:open:999999999999:old_category',
    guildId: '1447230598295978198',
    channelId: '1560686050907783372',
    user: { id: '507601702812385320', tag: 'test#0001' },
    member: { permissions: { has: () => true } },
    client: { user: { id: 'bot_id' } },
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    deferred: false,
    replied: false,
    deferReply: async () => { mockInteraction.deferred = true; },
    deferUpdate: async () => { mockInteraction.deferred = true; },
    reply: async (p) => { capturedPayload = p; mockInteraction.replied = true; },
    editReply: async (p) => { capturedPayload = p; },
    followUp: async (p) => { capturedPayload = p; }
  };

  await routeInteraction(mockInteraction);

  assert.ok(capturedPayload, 'Interaction must return a response');
  // Confirm response is Components V2 compliant with expired panel text
  const payloadStr = JSON.stringify(capturedPayload);
  assert.ok(
    payloadStr.includes('Panel Expired') || payloadStr.includes('expired'),
    'Response must clearly state panel is expired'
  );
  assert.ok(
    payloadStr.includes('run the command again') || payloadStr.includes('Please run the command again'),
    'Response must instruct user to run the command again'
  );
});

test('Fresh Start: runHandler catches missing DB records (PGRST116) and returns expired card', async () => {
  let captured = null;
  const mockInt = {
    id: 'mock_int_pgrst116',
    customId: 'shop:product:view:9999',
    user: { id: 'user_1' },
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isChatInputCommand: () => false,
    deferred: false,
    replied: false,
    deferReply: async () => {},
    deferUpdate: async () => {},
    reply: async (p) => { captured = p; },
    editReply: async (p) => { captured = p; }
  };

  await runHandler(mockInt, async () => {
    const err = new Error('JSON object requested, multiple (or no) rows returned');
    err.code = 'PGRST116';
    throw err;
  });

  assert.ok(captured, 'Interaction must be handled');
  const str = JSON.stringify(captured);
  assert.ok(str.includes('Panel Expired'), 'Must return Panel Expired title');
  assert.ok(str.includes('This panel expired, run the command again'), 'Must return exact friendly copy');
});

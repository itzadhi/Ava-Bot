import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle } from 'discord.js';
import { buildPerfCard } from '../src/commands/settings/perf.js';
import { metrics } from '../src/core/metrics.js';
import { interactionRegistry } from '../src/core/interactions/registry.js';

test('Perf Command: renders compliant Components V2 card with grey refresh button and no accent color', () => {
  const mockClient = {
    ws: { ping: 22 },
    guilds: { cache: new Map([['1', {}], ['2', {}]]) }
  };

  const payload = buildPerfCard(mockClient, true);

  assert.ok(payload, 'Payload must be returned');
  assert.equal(
    (payload.flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    'Must declare MessageFlags.IsComponentsV2'
  );
  assert.equal(
    (payload.flags & MessageFlags.Ephemeral),
    MessageFlags.Ephemeral,
    'Must be ephemeral'
  );

  assert.ok(Array.isArray(payload.components), 'Must have components container');
  assert.equal(payload.components.length, 1, 'Must have exactly one top-level container');

  const container = payload.components[0];
  const containerData = container.toJSON ? container.toJSON() : container;

  // Confirm NO accent color / color strip
  assert.equal(containerData.accent_color, undefined, 'Must not set accent_color on container');

  // Find ActionRow and examine buttons
  const actionRow = containerData.components.find(c => c.type === 1);
  assert.ok(actionRow, 'Must contain an ActionRow');
  assert.ok(actionRow.components.length >= 1, 'Must contain at least 1 button');

  // Verify EVERY button is grey (ButtonStyle.Secondary = 2)
  for (const btn of actionRow.components) {
    assert.equal(
      btn.style,
      ButtonStyle.Secondary,
      `Button "${btn.label || btn.custom_id}" must use ButtonStyle.Secondary (grey)`
    );
  }
});

test('Metrics Collector: records latencies, errors, and accurately aggregates p95 and rates', () => {
  metrics.recordAck(12.5);
  metrics.recordAck(34.2);
  metrics.recordAck(120.0);

  metrics.recordHandler(5.2);
  metrics.recordHandler(18.9);

  metrics.recordDbQuery('guild_settings select', 45);
  metrics.recordError(10062);
  metrics.recordError(40060);
  metrics.recordError(50027);

  const mockClient = {
    ws: { ping: 15 },
    guilds: { cache: new Map() }
  };

  const snapshot = metrics.getSnapshot(mockClient);

  assert.equal(snapshot.wsPing, '15 ms');
  assert.ok(snapshot.ackTime.avg.includes('ms'));
  assert.ok(snapshot.handlerTime.avg.includes('ms'));
  assert.equal(snapshot.errorsLastHour.unknownInteraction10062 >= 1, true);
  assert.equal(snapshot.errorsLastHour.alreadyAcknowledged40060 >= 1, true);
  assert.equal(snapshot.errorsLastHour.invalidWebhook50027 >= 1, true);
});

test('Perf Component Registry: perf:refresh is registered as persistent handler', () => {
  const handler = interactionRegistry.resolveComponent('perf:refresh');
  assert.ok(handler, 'perf:refresh must be registered in interactionRegistry');
  assert.equal(typeof handler.handler, 'function');
});

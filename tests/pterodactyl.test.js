import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { validatePterodactylEnv } from '../src/core/pterodactyl/env.js';
import { getContainerMemoryLimit, getMemoryStats, trimMemoryCaches } from '../src/core/pterodactyl/memory.js';
import { checkCrashLoopGuard, recordCrash, markCleanStartup } from '../src/core/pterodactyl/crashGuard.js';
import { pruneLogsDirectory } from '../src/core/pterodactyl/storage.js';
import { startHealthServer, stopHealthServer } from '../src/core/pterodactyl/healthServer.js';
import { buildAvaStatusPayload } from '../src/commands/owner/ava.js';
import { MessageFlags, ButtonStyle } from 'discord.js';

test('Pterodactyl: validatePterodactylEnv validates Node.js version >= 20', () => {
  const result = validatePterodactylEnv();
  assert.equal(typeof result.valid, 'boolean');
  assert.ok(parseInt(result.nodeVersion.split('.')[0], 10) >= 20);
});

test('Pterodactyl: getMemoryStats reads memory and calculates percentages', () => {
  const stats = getMemoryStats();
  assert.ok(stats.rssMb > 0);
  assert.ok(stats.heapUsedMb > 0);
  assert.ok(stats.limitMb > 0);
  assert.equal(typeof stats.usagePercent, 'number');
  assert.equal(typeof stats.isConstrained, 'boolean');
});

test('Pterodactyl: trimMemoryCaches runs safely without throwing', () => {
  assert.doesNotThrow(() => {
    trimMemoryCaches();
  });
});

test('Pterodactyl: crashGuard records crashes and triggers backoff on rapid loop', async () => {
  const logsDir = path.resolve('logs');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const historyFile = path.join(logsDir, 'crash-history.json');
  const now = Date.now();
  // Simulate 3 crashes within 1 minute
  fs.writeFileSync(historyFile, JSON.stringify([now - 30000, now - 20000, now - 10000]), 'utf8');

  const backoffMs = await checkCrashLoopGuard();
  assert.ok(backoffMs >= 5000, `Expected backoff >= 5000ms, got ${backoffMs}`);

  // Test recording a crash
  recordCrash(new Error('Simulated crash for testing'));
  const lastCrashFile = path.join(logsDir, 'last-crash.json');
  assert.ok(fs.existsSync(lastCrashFile));

  // Clean up
  markCleanStartup();
  assert.ok(!fs.existsSync(historyFile));
});

test('Pterodactyl: pruneLogsDirectory enforces 20MB disk cap safely', () => {
  const res = pruneLogsDirectory();
  assert.equal(typeof res.prunedCount, 'number');
  assert.equal(typeof res.totalSizeBytes, 'number');
});

test('Pterodactyl: buildAvaStatusPayload strictly returns Components V2 with grey buttons', () => {
  const dummyClient = {
    ws: { ping: 24 },
    guilds: { cache: new Map() }
  };
  const payload = buildAvaStatusPayload(dummyClient, '123456789012345678', '987654321098765432');

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.ok(Array.isArray(payload.components));
  assert.equal(payload.components.length, 2); // Container + ActionRow

  // Verify button is grey (Secondary)
  const row = payload.components[1];
  const btn = row.components[0];
  assert.equal(btn.data.style, ButtonStyle.Secondary);
});

test('Pterodactyl: health probe server responds with 200 JSON when enabled', async () => {
  process.env.ENABLE_HEALTH_ENDPOINT = 'true';
  process.env.SERVER_PORT = '19876';

  const dummyClient = { ws: { ping: 32 } };
  const srv = startHealthServer(dummyClient);
  assert.ok(srv !== null);

  await new Promise(r => setTimeout(r, 100));

  const resData = await new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:19876/health', (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });

  assert.equal(resData.status, 'ok');
  assert.equal(resData.ping, 32);
  assert.ok(resData.memory.rssMb > 0);

  stopHealthServer();
  delete process.env.ENABLE_HEALTH_ENDPOINT;
  delete process.env.SERVER_PORT;
});

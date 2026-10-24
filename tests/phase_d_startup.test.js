import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startOnce, hasStarted, getDuplicateStartsCount, resetStartRegistry, printStartupCheck } from '../src/core/lifecycle/startOnce.js';
import { validateTokenSafety, acquireInstanceLease, releaseInstanceLease, isLeader, holderId } from '../src/core/instance/lease.js';
import { summarizeTrace, runWithTrace, recordRestCall, recordDbCall, recordBuildDuration, setAckDuration } from '../src/core/interactions/trace.js';
import { detectEnvironment, getRealMemoryLimitString } from '../src/core/logger/style.js';
import { moduleRegistry } from '../src/structures/ModuleRegistry.js';

import { loadModules } from '../src/structures/loader.js';

describe('Phase D: Startup & Logging Suite', () => {
  beforeEach(() => {
    resetStartRegistry();
  });

  test('D1: startOnce executes function exactly once per key and tracks duplicates', async () => {
    let callCount = 0;
    const task = async () => {
      callCount++;
      return 'initialized';
    };

    const res1 = await startOnce('test:service', task);
    const res2 = await startOnce('test:service', task);
    const res3 = await startOnce('test:service', task);

    assert.equal(callCount, 1, 'Underlying task must execute only once');
    assert.equal(res1, 'initialized');
    assert.equal(res2, 'initialized');
    assert.equal(res3, 'initialized');
    assert.equal(hasStarted('test:service'), true);
    assert.equal(getDuplicateStartsCount(), 2, 'Duplicate counter must track 2 prevented executions');

    // Reset and verify clean state
    resetStartRegistry();
    assert.equal(getDuplicateStartsCount(), 0);
    assert.equal(printStartupCheck(), 0, 'printStartupCheck must report 0 duplicate starts');
  });

  test('D2: Module count reconciliation ensures unique modules in getAll()', async () => {
    await loadModules();
    const all = moduleRegistry.getAll();
    assert.ok(Array.isArray(all));
    assert.equal(all.length, 22, `Expected exactly 22 unique modules in registry, got ${all.length}`);
    const uniqueIds = new Set(all.map(m => m.id || m.name));
    assert.equal(uniqueIds.size, 22, 'All module records in getAll() must be unique');
  });

  test('D3: Environment detection & real memory formatting', () => {
    const env = detectEnvironment();
    assert.ok(['local', 'Pterodactyl'].includes(env));

    const memStr = getRealMemoryLimitString();
    assert.ok(typeof memStr === 'string' && memStr.length > 0);
    assert.ok(
      memStr.includes('limit') || memStr.includes('host') || memStr.includes('process'),
      `Memory string must match format "limit X MB" or "host X GB, process Y MB" (got: ${memStr})`
    );
  });

  test('D4: Token safety guard refuses production token locally without override', () => {
    const oldEnv = process.env.P_SERVER_UUID;
    const oldRole = process.env.INSTANCE_ROLE;
    const oldAllow = process.env.ALLOW_PROD_TOKEN_LOCAL;
    const oldDev = process.env.DEV_DISCORD_TOKEN;

    try {
      delete process.env.P_SERVER_UUID;
      delete process.env.DEV_DISCORD_TOKEN;
      process.env.INSTANCE_ROLE = 'prod';
      process.env.ALLOW_PROD_TOKEN_LOCAL = 'false';

      const check = validateTokenSafety('prod_bot_token_12345');
      assert.equal(check.allowed, false, 'Production token must be refused locally by default');
      assert.ok(check.reason.includes('Local run detected'));

      // Allowed when ALLOW_PROD_TOKEN_LOCAL=true
      process.env.ALLOW_PROD_TOKEN_LOCAL = 'true';
      const checkOverride = validateTokenSafety('prod_bot_token_12345');
      assert.equal(checkOverride.allowed, true);

      // Allowed when DEV_DISCORD_TOKEN is set
      process.env.ALLOW_PROD_TOKEN_LOCAL = 'false';
      process.env.DEV_DISCORD_TOKEN = 'dev_test_token_54321';
      const checkDev = validateTokenSafety('prod_bot_token_12345');
      assert.equal(checkDev.allowed, true);
      assert.equal(checkDev.effectiveToken, 'dev_test_token_54321');
    } finally {
      if (oldEnv) process.env.P_SERVER_UUID = oldEnv;
      if (oldRole) process.env.INSTANCE_ROLE = oldRole;
      if (oldAllow) process.env.ALLOW_PROD_TOKEN_LOCAL = oldAllow;
      if (oldDev) process.env.DEV_DISCORD_TOKEN = oldDev;
    }
  });

  test('D5: Single-instance leadership lease acquires, renews and releases with generation fencing', async () => {
    const leaseRes = await acquireInstanceLease();
    assert.equal(leaseRes.isLeader, true);
    assert.ok(leaseRes.generation >= 1);
    assert.equal(isLeader(), true);

    const released = await releaseInstanceLease();
    assert.equal(released, true);
    assert.equal(isLeader(), false);
  });

  test('D6: Trace output formats to single-line with unattributed time and REST counts', async () => {
    await runWithTrace({ id: '123456789012346289', identifier: '/lockdown' }, async () => {
      setAckDuration(595);
      recordRestCall('reply', 210);
      recordRestCall('editReply', 200);
      recordDbCall('lockdown_plans', 'insert', 1100);
      recordDbCall('lockdown_items', 'insert', 1224);
      recordBuildDuration(12);

      const summary = summarizeTrace();
      assert.ok(summary.summaryLine.includes('#6289 /lockdown'), 'Line must start with short ID and identifier');
      assert.ok(summary.summaryLine.includes('ack=595ms'), 'Must include ack=595ms');
      assert.ok(summary.summaryLine.includes('rest=2/410ms'), 'Must include rest=2/410ms');
      assert.ok(summary.summaryLine.includes('db=2/2324ms'), 'Must include db calls/ms');
      assert.ok(summary.summaryLine.includes('build=12ms'), 'Must include build=12ms');
      assert.ok(summary.summaryLine.includes('total='), 'Must include total seconds');
      assert.ok(summary.summaryLine.includes('lag='), 'Must include loop lag');
      assert.ok(typeof summary.unattributedMs === 'number');
    });
  });
});

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { perm } from '../src/core/permissions/permApply.js';
import { checkPermissionSchema } from '../src/core/permissions/schemaCheck.js';

describe('Phase A: Permission Guard & Kill Switch', () => {
  const originalMode = perm.getMode();

  afterEach(() => {
    perm.setMode(originalMode);
    perm.setSchemaValid(false);
  });

  test('Mode "off" unconditionally refuses and blocks execution', async () => {
    perm.setMode('off');
    let executed = false;

    const res = await perm.apply({
      guildId: '123456789012345678',
      feature: 'test_feature',
      targetType: 'channel',
      targetId: '987654321098765432',
      op: 'edit_channel_overwrite',
      field: 'permissionOverwrites',
      oldValue: { SendMessages: true },
      newValue: { SendMessages: false },
      execute: async () => {
        executed = true;
        return { modified: true };
      }
    });

    assert.equal(res.success, false);
    assert.equal(res.mode, 'off');
    assert.equal(res.executed, false);
    assert.equal(res.refused, true);
    assert.equal(res.reason, 'PERMISSION_WRITES=off');
    assert.equal(executed, false, 'Target execute function must NEVER be invoked when PERMISSION_WRITES=off');
  });

  test('Mode "dryrun" returns diff and skips execution', async () => {
    perm.setMode('dryrun');
    let executed = false;

    const res = await perm.apply({
      guildId: '123456789012345678',
      feature: 'lockdown',
      targetType: 'role',
      targetId: '123456789012345678',
      op: 'set_permissions',
      field: 'permissions',
      oldValue: '1074151489',
      newValue: '1074149441',
      reason: 'Raid Lockdown simulation',
      execute: async () => {
        executed = true;
        return { modified: true };
      }
    });

    assert.equal(res.success, true);
    assert.equal(res.mode, 'dryrun');
    assert.equal(res.executed, false);
    assert.equal(res.refused, false);
    assert.deepEqual(res.wouldChange, {
      oldValue: '1074151489',
      newValue: '1074149441'
    });
    assert.equal(executed, false, 'Target execute function must not run in dryrun mode');
  });

  test('Mode "on" refuses if schema check has not validated required tables', async () => {
    perm.setMode('on');
    perm.setSchemaValid(false);
    let executed = false;

    const res = await perm.apply({
      guildId: '123456789012345678',
      feature: 'permify',
      targetType: 'channel',
      targetId: '987654321098765432',
      op: 'set_channel_overwrites',
      field: 'permissionOverwrites',
      execute: async () => {
        executed = true;
        return { modified: true };
      }
    });

    assert.equal(res.success, false);
    assert.equal(res.mode, 'on');
    assert.equal(res.refused, true);
    assert.equal(res.reason, 'schema_missing');
    assert.equal(executed, false, 'Execution must be refused when schema is missing or invalid');
  });

  test('Mode "on" executes successfully and records write when schema is valid', async () => {
    perm.setMode('on');
    perm.setSchemaValid(true);
    let executed = false;

    const res = await perm.apply({
      guildId: '123456789012345678',
      feature: 'permify',
      targetType: 'channel',
      targetId: '987654321098765432',
      op: 'set_channel_overwrites',
      field: 'permissionOverwrites',
      oldValue: '1',
      newValue: '2',
      execute: async () => {
        executed = true;
        return { modified: true, channelId: '987654321098765432' };
      }
    });

    assert.equal(res.success, true);
    assert.equal(res.mode, 'on');
    assert.equal(res.executed, true);
    assert.equal(executed, true);
    assert.equal(res.result.modified, true);
  });
});

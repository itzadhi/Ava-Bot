import test from 'node:test';
import assert from 'node:assert/strict';
import { setBackupInterval, getBackupInterval, createBackupRecord, getOldestUnlockedAutoBackups } from '../src/db/backups.js';
import { runIntervalCheck } from '../src/services/scheduler.js';

test('Backup interval setting and rotation query', async () => {
  const guildId = `sched_${Date.now()}`;

  await setBackupInterval(guildId, {
    interval_hours: 24,
    max_backups: 2,
    enabled: true,
    last_run: null
  });

  const interval = await getBackupInterval(guildId);
  assert.ok(interval);
  assert.equal(interval.interval_hours, 24);
  assert.equal(interval.max_backups, 2);

  const runId = Date.now();
  const bk1 = `BK-1-${runId}`;
  const bk2 = `BK-2-${runId}`;
  const bk3 = `BK-3-${runId}`;

  // Create 3 backups (1 locked, 2 unlocked)
  await createBackupRecord({
    id: bk1,
    guild_id: guildId,
    owner_id: 'user1',
    name: 'Old Unlocked',
    storage_path: 'path/bk1',
    size_bytes: 100,
    options: {},
    locked: false,
    is_auto: true
  });

  await createBackupRecord({
    id: bk2,
    guild_id: guildId,
    owner_id: 'user1',
    name: 'Important Locked',
    storage_path: 'path/bk2',
    size_bytes: 100,
    options: {},
    locked: true,
    is_auto: true
  });

  await createBackupRecord({
    id: bk3,
    guild_id: guildId,
    owner_id: 'user1',
    name: 'Newer Unlocked',
    storage_path: 'path/bk3',
    size_bytes: 100,
    options: {},
    locked: false,
    is_auto: true
  });

  // When keeping max 1 unlocked backup out of 2 unlocked backups, bk1 should be returned for rotation
  const toRotate = await getOldestUnlockedAutoBackups(guildId, 1);
  assert.equal(toRotate.length, 1);
  assert.equal(toRotate[0].id, bk1, 'Oldest unlocked backup should be rotated');
});

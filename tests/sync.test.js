import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSyncRecord,
  getSyncById,
  getGuildSyncs,
  setSyncEnabled,
  recordSyncedMessage,
  isMessageAlreadySynced
} from '../src/db/syncs.js';

test('Sync repository and loop prevention caching', async () => {
  const runId = Date.now();
  const syncId = `SYNC-${runId}`;
  await createSyncRecord({
    id: syncId,
    source_guild: 'guild_A',
    target_guild: 'guild_B',
    source_channel: 'ch_A',
    target_channel: 'ch_B',
    type: 'messages',
    direction: 'one-way',
    enabled: true,
    created_by: 'owner_user'
  });

  const record = await getSyncById(syncId);
  assert.ok(record);
  assert.equal(record.type, 'messages');
  assert.equal(record.enabled, true);

  const guildSyncs = await getGuildSyncs('guild_A');
  assert.ok(guildSyncs.some(s => s.id === syncId));

  // Loop prevention check
  const originalMsgId = `orig_${runId}`;
  const mirroredMsgId = `mirr_${runId}`;

  assert.equal(await isMessageAlreadySynced(originalMsgId), false);
  assert.equal(await isMessageAlreadySynced(mirroredMsgId), false);

  await recordSyncedMessage(originalMsgId, mirroredMsgId, syncId);

  assert.equal(await isMessageAlreadySynced(originalMsgId), true);
  assert.equal(await isMessageAlreadySynced(mirroredMsgId), true);
});

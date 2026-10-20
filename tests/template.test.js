import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTemplateRecord,
  getTemplateById,
  searchPublicTemplates,
  setTemplatePublic,
  incrementTemplateUses
} from '../src/db/templates.js';
import { createBackupRecord } from '../src/db/backups.js';

test('Template repository management and search', async () => {
  const runId = Date.now();
  const id = `TPL-${runId}`;
  const backupId = `BK-SAMPLE-${runId}`;

  await createBackupRecord({
    id: backupId,
    guild_id: '123456789',
    owner_id: 'user_owner',
    name: 'Sample Backup',
    storage_path: 'path/sample',
    size_bytes: 100,
    options: {}
  });

  const templateName = `Community Hub Template ${runId}`;

  await createTemplateRecord({
    id,
    guild_id: '123456789',
    owner_id: 'user_owner',
    name: templateName,
    description: 'Perfect for gaming and hangout communities',
    category: 'Community',
    is_public: false,
    backup_id: backupId
  });

  const record = await getTemplateById(id);
  assert.ok(record);
  assert.equal(record.name, templateName);
  assert.equal(record.is_public, false);

  // Search when private should not return
  let results = await searchPublicTemplates({ query: `${runId}`, limit: 50 });
  assert.ok(!results.some(r => r.id === id));

  // Publish template
  await setTemplatePublic(id, true);
  results = await searchPublicTemplates({ query: `${runId}`, limit: 50 });
  assert.ok(results.some(r => r.id === id));

  // Increment usage
  await incrementTemplateUses(id);
  const updated = await getTemplateById(id);
  assert.equal(updated.uses, 1);
});

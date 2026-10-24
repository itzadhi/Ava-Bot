import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import {
  card,
  successCard,
  errorCard,
  infoCard,
  warnCard,
  confirmCard,
  progressCard,
  listCard,
  detailCard,
  loadingCard,
  metricCard,
  formCard,
  mediaGalleryCard,
  brandCard,
  backupCard,
  homeCard,
  restoreConsoleCard
} from '../src/ui/cards.js';

test('Components V2 cards strictly return MessageFlags.IsComponentsV2 and Container layout', () => {
  const cards = [
    { name: 'successCard', payload: successCard({ title: 'Task Done', body: 'All items restored.' }) },
    { name: 'errorCard', payload: errorCard({ title: 'Error', reason: 'Missing perms', fix: 'Add Admin' }) },
    { name: 'infoCard', payload: infoCard({ title: 'Information', body: 'Overview details' }) },
    { name: 'warnCard', payload: warnCard({ title: 'Warning', body: 'Quota nearly reached' }) },
    { name: 'confirmCard', payload: confirmCard({ title: 'Confirm Delete', details: 'Cannot be undone' }) },
    { name: 'progressCard', payload: progressCard({ title: 'Restoring', step: 'Channels', done: 5, total: 10 }) },
    { name: 'listCard', payload: listCard({ title: 'Items', items: ['Item 1', 'Item 2'], page: 1, totalPages: 2 }) },
    { name: 'detailCard', payload: detailCard({ title: 'Record', fields: [{ label: 'ID', value: '123' }] }) },
    { name: 'loadingCard', payload: loadingCard({ title: 'Processing' }) },
    { name: 'metricCard', payload: metricCard({ title: 'Status', metrics: [{ label: 'Ping', value: '42ms' }] }) },
    { name: 'formCard', payload: formCard({ title: 'Feedback', buttonLabel: 'Fill Form' }) },
    { name: 'mediaGalleryCard', payload: mediaGalleryCard({ title: 'Gallery', images: ['https://example.com/pic.png'] }) },
    { name: 'brandCard', payload: brandCard({ title: 'AVA' }) },
    { name: 'backupCard', payload: backupCard({ title: 'Universal Snapshot', id: 'TEST-123', name: 'Alpha', sizeFormatted: '100 KB' }) },
    { name: 'homeCard', payload: homeCard({ title: 'AVA Control Center' }) },
    { name: 'restoreConsoleCard', payload: restoreConsoleCard({ stage: 'confirm', record: { name: 'Alpha', id: '123' }, targetGuildName: 'Target', originGuildName: 'Origin' }) }
  ];

  for (const { name, payload } of cards) {
    assert.ok(
      (payload.flags & MessageFlags.IsComponentsV2) !== 0,
      `${name} must include MessageFlags.IsComponentsV2 flag (32768)`
    );

    assert.equal(
      payload.components.length,
      1,
      `${name} must contain exactly ONE root ContainerBuilder layout`
    );

    const json = payload.components[0].toJSON();
    assert.ok(json.type === 17 || json.type === undefined, `${name} container must be a valid Discord container builder`);
    assert.ok(json.components?.length > 0, `${name} container must have children components`);
  }
});

test('Cards automatically bundle logo.jpg attachment when thumbnail is attachment://logo.jpg', () => {
  const cardWithLogo = infoCard({
    title: 'Help Directory',
    thumbnail: 'attachment://logo.jpg'
  });

  assert.ok(Array.isArray(cardWithLogo.files), 'Payload must have files array');
  assert.equal(cardWithLogo.files.length, 1);
  assert.equal(cardWithLogo.files[0].name, 'logo.jpg', 'Attachment name must match referenced attachment');
});


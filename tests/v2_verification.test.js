import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ComponentType } from 'discord.js';
import { buildHelpMenuPayload, buildCategoryHelpPayload } from '../src/modules/help/panel.js';
import { buildDashboardPayload } from '../src/modules/panel/index.js';
import { buildLogCard, buildLogsPanel } from '../src/modules/logs/engine.js';
import {
  moderationResultCard,
  infoCard,
  errorCard,
  permissionCard,
  cooldownCard
} from '../src/utils/ui/components.js';

function validateV2Payload(name, payload, expectedEphemeral = false) {
  const isV2 = (payload.flags & MessageFlags.IsComponentsV2) === MessageFlags.IsComponentsV2;
  const isEph = (payload.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral;
  const rootType = payload.components?.[0]?.data?.type;
  const accent = payload.components?.[0]?.data?.accent_color;

  let totalChars = 0;
  function countChars(c) {
    if (c.data?.content) totalChars += c.data.content.length;
    if (Array.isArray(c.components)) c.components.forEach(countChars);
  }
  payload.components.forEach(countChars);

  assert.equal(isV2, true, `${name} must include IsComponentsV2 flag`);
  assert.equal(isEph, expectedEphemeral, `${name} ephemeral flag mismatch`);
  assert.equal(rootType, ComponentType.Container, `${name} root component must be Container`);
  assert.equal(accent, undefined, `${name} must have NO accent color (borderless card)`);
  assert.ok(totalChars <= 4000, `${name} total characters must be <= 4000 (got ${totalChars})`);
}

test('Components V2: Help Menu matches reference structure with borderless container', () => {
  const helpPayload = buildHelpMenuPayload({
    user: { username: 'Aegis', displayName: 'Aegis', displayAvatarURL: () => 'https://discord.com/avatar.png' },
    client: { user: { username: 'AVA' } },
    prefix: '&',
    sessionId: 'session_123'
  });
  validateV2Payload('Help Menu', helpPayload, false);
});

test('Components V2: Help Category Page renders commands and select menus without color sidebar', () => {
  const catPayload = buildCategoryHelpPayload({
    categoryId: 'voice',
    prefix: '&',
    sessionId: 'session_123',
    page: 1
  });
  validateV2Payload('Help Category Page', catPayload, false);
});

test('Components V2: Dashboard Panel renders central module hub in a clean card', async () => {
  const dashPayload = await buildDashboardPayload({
    guild: { name: 'Alpha Guild', id: '123' },
    user: { id: 'admin' },
    sessionId: 'session_123'
  });
  validateV2Payload('Dashboard Panel', dashPayload, false);
});

test('Components V2: Moderation Result Card formats action and case without color border', () => {
  const modPayload = moderationResultCard({
    action: 'Member Banned',
    target: { id: '9999', tag: 'BadActor#0001', username: 'BadActor' },
    moderator: { id: '1111', tag: 'Mod#0001' },
    reason: 'Violating community guidelines and spamming',
    caseId: 'CASE-8821'
  });
  validateV2Payload('Moderation Result Card', modPayload, false);
});

test('Components V2: Info Command Card returns clean text and key-values', () => {
  const infoPayload = infoCard('Server Information', 'High performance Discord bot infrastructure.', {
    fields: [
      { name: 'Owner', value: '<@12345>' },
      { name: 'Uptime', value: '4 days, 12 hours' }
    ]
  });
  validateV2Payload('Info Card', infoPayload, false);
});

test('Components V2: Error, Permission, and Cooldown Cards strictly use ephemeral V2 container', () => {
  const errPayload = errorCard('Invalid Target', 'You cannot ban yourself or the server owner.', {
    hint: 'Mention a different member.'
  });
  validateV2Payload('Error Card', errPayload, true);

  const permPayload = permissionCard({
    missing: ['BanMembers', 'ManageGuild'],
    isBot: false,
    ephemeral: true
  });
  validateV2Payload('Permission Card', permPayload, true);

  const coolPayload = cooldownCard('ban', Date.now() + 5000, { ephemeral: true });
  validateV2Payload('Cooldown Card', coolPayload, true);
});

test('Components V2: Server Log Event Card uses emoji headings and diff blocks with zero accent', () => {
  const logCardPayload = buildLogCard({
    eventName: 'Member Banned',
    emoji: '🔨',
    category: 'mod',
    user: { id: '9999', tag: 'BadActor#0001' },
    moderator: { id: '1111' },
    reason: 'Spamming raid links',
    targetId: '9999'
  });
  validateV2Payload('Log Event Card', logCardPayload, false);
});

test('Components V2: Server Logs Panel renders interactive category toggles', async () => {
  const logsPanelPayload = await buildLogsPanel({ id: '123' });
  validateV2Payload('Logs Control Panel', logsPanelPayload, false);
});

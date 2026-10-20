import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, Collection } from 'discord.js';
import {
  buildLogCard,
  getLogConfig,
  updateLogConfig,
  buildLogsPanel,
  dispatchLog,
  LOG_CATEGORIES
} from '../src/modules/logs/engine.js';
import { registerLogListeners } from '../src/modules/logs/listeners.js';
import { theme } from '../src/config/theme.js';

test('buildLogCard: produces compliant Components V2 cards with category colors', () => {
  const dummyUser = {
    id: 'user_log_1',
    tag: 'TestMod#0001',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/user_log_1/avatar.png'
  };

  // 1. Mod Ban Card (Red Accent)
  const banCard = buildLogCard({
    eventName: 'Member Banned',
    emoji: '🔨',
    category: 'mod',
    user: dummyUser,
    reason: 'Violated Rule 1: No spamming'
  });

  assert.equal(banCard.flags, MessageFlags.IsComponentsV2);
  assert.equal(banCard.components.length, 1);
  const banJson = banCard.components[0].toJSON();
  assert.equal(banJson.accent_color, theme.logColors.red);
  assert.deepEqual(banCard.allowedMentions, { parse: [] });

  // 2. Message Edit Card with Diff Block (Orange Accent)
  const editCard = buildLogCard({
    eventName: 'Message Edited',
    emoji: '📝',
    category: 'messages',
    user: dummyUser,
    channel: { id: 'chan_123' },
    beforeText: 'Hello world',
    afterText: 'Hello Discord'
  });

  assert.equal(editCard.flags, MessageFlags.IsComponentsV2);
  const editJson = editCard.components[0].toJSON();
  assert.equal(editJson.accent_color, theme.logColors.orange);

  // 3. Member Join Card (Green Accent)
  const joinCard = buildLogCard({
    eventName: 'Member Joined',
    emoji: '📥',
    category: 'members',
    user: dummyUser
  });
  const joinJson = joinCard.components[0].toJSON();
  assert.equal(joinJson.accent_color, theme.logColors.green);

  // 4. Voice Channel Switch Card (Purple Accent)
  const voiceCard = buildLogCard({
    eventName: 'Voice Channel Switched',
    emoji: '🔄',
    category: 'voice',
    user: dummyUser,
    details: ['From: <#111>', 'To: <#222>']
  });
  const voiceJson = voiceCard.components[0].toJSON();
  assert.equal(voiceJson.accent_color, theme.logColors.purple);
});

test('getLogConfig & updateLogConfig: persists settings and category toggles', async () => {
  const guildId = `g_log_test_${Date.now()}`;

  const initial = await getLogConfig(guildId);
  assert.ok(initial.categories);
  assert.equal(initial.categories.mod, true);

  // Update global channel & toggle a category
  await updateLogConfig(guildId, {
    globalChannelId: 'chan_log_global_999',
    categories: { voice: false }
  });

  const updated = await getLogConfig(guildId);
  assert.equal(updated.globalChannelId, 'chan_log_global_999');
  assert.equal(updated.categories.voice, false);
  assert.equal(updated.categories.mod, true);
});

test('buildLogsPanel: renders interactive Components V2 panel', async () => {
  const dummyGuild = {
    id: `g_panel_test_${Date.now()}`,
    name: 'Log Guild',
    ownerId: 'owner_1'
  };

  const panel = await buildLogsPanel(dummyGuild);
  assert.equal(panel.flags, MessageFlags.IsComponentsV2);
  assert.equal(panel.components.length, 1);

  const json = panel.components[0].toJSON();
  // ActionRows: ChannelSelectMenu, CategoryStringSelectMenu, ButtonRow
  assert.ok(json.components.length >= 3);
});

test('dispatchLog: handles logging and skips disabled categories safely', async () => {
  let sentPayload = null;
  const mockChannel = {
    id: 'chan_sent_1',
    isTextBased: () => true,
    send: async (p) => { sentPayload = p; }
  };

  const dummyGuild = {
    id: `g_disp_test_${Date.now()}`,
    channels: {
      cache: new Collection([['chan_sent_1', mockChannel]]),
      fetch: async () => mockChannel
    }
  };

  await updateLogConfig(dummyGuild.id, {
    globalChannelId: 'chan_sent_1',
    enabled: true,
    categories: { mod: true, voice: false }
  });

  const logCard = buildLogCard({
    eventName: 'Ban Test',
    category: 'mod',
    user: { id: 'u_1' }
  });

  // 1. Mod is enabled -> should send
  await dispatchLog(dummyGuild, { category: 'mod', cardPayload: logCard });
  assert.ok(sentPayload, 'Log must be dispatched to channel');

  // 2. Voice is disabled -> should NOT send
  sentPayload = null;
  await dispatchLog(dummyGuild, { category: 'voice', cardPayload: logCard });
  assert.equal(sentPayload, null, 'Disabled category must not be dispatched');
});

test('registerLogListeners: registers all client audit event listeners safely', () => {
  const clientEvents = new Map();
  const mockClient = {
    on: (evt, handler) => { clientEvents.set(evt, handler); }
  };

  registerLogListeners(mockClient);

  const expectedEvents = [
    'guildMemberAdd',
    'guildMemberRemove',
    'guildBanAdd',
    'guildBanRemove',
    'guildMemberUpdate',
    'messageDelete',
    'messageUpdate',
    'messageDeleteBulk',
    'channelCreate',
    'channelDelete',
    'channelUpdate',
    'roleCreate',
    'roleDelete',
    'voiceStateUpdate',
    'inviteCreate',
    'inviteDelete'
  ];

  for (const evt of expectedEvents) {
    assert.ok(clientEvents.has(evt), `Event ${evt} must be registered on client`);
    assert.equal(typeof clientEvents.get(evt), 'function');
  }
});

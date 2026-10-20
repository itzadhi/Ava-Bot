import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportChannelChatlog,
  recordLiveMessage,
  getChannelVaultMessages,
  getGuildVaultStats
} from '../src/modules/chatlog/engine.js';
import { updateGuildSettings } from '../src/db/guilds.js';
import { downloadSnapshot } from '../src/db/storage.js';
import { renderChatlogPanel } from '../src/modules/chatlog/panel.js';

test('Chatlog engine enforces opt-in and encrypts stored message data with AES-256-GCM', async () => {
  const guildId = '333444555666777888';
  const mockGuild = {
    id: guildId,
    name: 'Chatlog Test Guild',
    client: { user: { id: 'bot_id' } },
    channels: { cache: new Map() },
    iconURL: () => null
  };

  const mockChannel = {
    id: 'ch_text_1',
    name: 'general',
    isTextBased: () => true,
    messages: {
      fetch: async () => new Map([
        ['msg1', { id: 'msg1', author: { id: 'u1', username: 'Alice', displayAvatarURL: () => 'https://example.com/a.png' }, content: 'Confidential Secret Data', createdAt: new Date(), attachments: new Map(), reference: null }],
        ['msg2', { id: 'msg2', author: { id: 'u2', username: 'Bob', displayAvatarURL: () => 'https://example.com/b.png' }, content: 'Another Message', createdAt: new Date(), attachments: new Map(), reference: null }]
      ])
    }
  };

  const mockUser = { id: 'owner_user_id' };

  // Ensure opt-in is false initially
  await updateGuildSettings(guildId, { chatlog_enabled: false });

  // 1. Should fail initially because opt-in is false
  await assert.rejects(
    async () => {
      await exportChannelChatlog({ guild: mockGuild, channel: mockChannel, user: mockUser });
    },
    /OPT_IN_REQUIRED/
  );

  // 2. Enable opt-in
  await updateGuildSettings(guildId, { chatlog_enabled: true });

  // 3. Export should succeed
  const { id, record, count } = await exportChannelChatlog({
    guild: mockGuild,
    channel: mockChannel,
    user: mockUser
  });

  assert.ok(id);
  assert.equal(count, 2);
  assert.equal(record.message_count, 2);

  // 4. Download and verify decrypted content matches original
  const decrypted = await downloadSnapshot(record.storage_path, true);
  assert.equal(decrypted.messages.length, 2);
  assert.ok(decrypted.messages.some(m => m.content === 'Confidential Secret Data'));
});

test('recordLiveMessage continuously records chat in real-time buffer', async () => {
  const guildId = '777888999000111222';
  await updateGuildSettings(guildId, { chatlog_enabled: true });

  const mockChannel = {
    id: 'ch_live_vault_1',
    name: 'secret-chat',
    isTextBased: () => true
  };

  const mockGuild = {
    id: guildId,
    name: 'Live Vault Guild',
    channels: {
      cache: new Map([['ch_live_vault_1', mockChannel]])
    },
    iconURL: () => null
  };

  const liveMsg1 = {
    id: 'live_101',
    guild: mockGuild,
    channel: mockChannel,
    author: { bot: false, id: 'user_a', username: 'UserA', displayAvatarURL: () => null },
    content: 'Autonomous live chat message 1',
    createdAt: new Date(),
    attachments: new Map(),
    components: []
  };

  const liveMsg2 = {
    id: 'live_102',
    guild: mockGuild,
    channel: mockChannel,
    author: { bot: false, id: 'user_b', username: 'UserB', displayAvatarURL: () => null },
    content: 'Autonomous live chat message 2 with rich data',
    createdAt: new Date(),
    attachments: new Map(),
    components: []
  };

  await recordLiveMessage(liveMsg1);
  await recordLiveMessage(liveMsg2);

  const messages = await getChannelVaultMessages({
    guild: mockGuild,
    channel: mockChannel
  });

  assert.ok(messages.length >= 2, 'Should have at least 2 buffered live messages');
  assert.equal(messages[messages.length - 2].content, 'Autonomous live chat message 1');
  assert.equal(messages[messages.length - 1].content, 'Autonomous live chat message 2 with rich data');

  const stats = getGuildVaultStats(guildId);
  assert.ok(stats.trackedChannels >= 1);
  assert.ok(stats.bufferedMessages >= 2);
});

test('renderChatlogPanel formats automatic recovery view without archives', async () => {
  const guildId = '777888999000111222';
  const mockChannel = {
    id: 'ch_live_vault_1',
    name: 'secret-chat',
    isTextBased: () => true
  };

  const mockGuild = {
    id: guildId,
    name: 'Live Vault Guild',
    channels: {
      cache: new Map([['ch_live_vault_1', mockChannel]])
    },
    iconURL: () => null
  };

  const panel = await renderChatlogPanel({ guild: mockGuild, channel: mockChannel });
  assert.ok(panel);
  assert.ok(panel.components);
});

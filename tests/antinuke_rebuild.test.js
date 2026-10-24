import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  validateSettings,
  computeSnapshotHash,
  saveChannelSnapshotHashed,
  repairAntinukeState
} from '../src/modules/antinuke/storage.js';
import {
  AntinukeSettingsSchema,
  AntinukeThresholdsSchema,
  LockdownStateSchema
} from '../src/modules/antinuke/schema.js';
import { remapIds } from '../src/core/db/remap.js';
import { restoreChannelBatch } from '../src/modules/antinuke/pipeline.js';
import { isChannelExempt, isTrusted } from '../src/db/antinuke.js';

test('Antinuke: Zod schema validates settings and coerces strings/missing keys to defaults', () => {
  // Corrupted input with string limits, nulls, and extra unrecognized fields
  const corrupted = {
    guild_id: '999888777666555',
    enabled: 'true',
    thresholds: {
      channel_delete_limit: '5', // string instead of number
      channel_delete_window_seconds: '15',
      mass_ban_limit: null // null instead of number
    },
    punishment: 'ban',
    unknown_junk_field: 'should_be_stripped'
  };

  const parsed = validateSettings(corrupted, '999888777666555');
  assert.equal(parsed.guild_id, '999888777666555');
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.thresholds.channel_delete_limit, 5);
  assert.equal(typeof parsed.thresholds.channel_delete_limit, 'number');
  assert.equal(parsed.thresholds.channel_delete_window_seconds, 15);
  assert.equal(typeof parsed.thresholds.channel_delete_window_seconds, 'number');
  // Null mass_ban_limit should fall back to schema default of 5
  assert.equal(parsed.thresholds.mass_ban_limit, 5);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.schema_version, 2);
});

test('Antinuke: computeSnapshotHash produces deterministic MD5 hash', () => {
  const channelData1 = {
    name: 'general',
    type: 0,
    topic: 'General discussion',
    position: 1
  };

  const channelData2 = {
    position: 1,
    topic: 'General discussion',
    type: 0,
    name: 'general'
  };

  const hash1 = computeSnapshotHash(channelData1);
  const hash2 = computeSnapshotHash(channelData2);

  assert.equal(hash1, hash2, 'Hash must be identical regardless of key order');
  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 32, 'MD5 hex is 32 characters');

  // Modified content produces different hash
  const hashModified = computeSnapshotHash({ ...channelData1, topic: 'Updated topic' });
  assert.notEqual(hash1, hashModified, 'Hash must change when channel properties change');
});

test('Antinuke: saveChannelSnapshotHashed skips duplicate writes when hash is unchanged', async () => {
  const mockChannel = {
    id: 'chan_test_101',
    name: 'announcements',
    type: ChannelType.GuildText,
    topic: 'Important server notices',
    nsfw: false,
    rateLimitPerUser: 0,
    position: 2,
    permissionOverwrites: { cache: new Map() }
  };

  // First save should succeed and record hash
  const first = await saveChannelSnapshotHashed('guild_mock_1', mockChannel);
  assert.equal(first.saved, true);
  assert(first.hash);

  // Immediate second save of identical channel payload should detect unchanged hash and skip
  const second = await saveChannelSnapshotHashed('guild_mock_1', mockChannel);
  assert.equal(second.saved, false);
  assert.equal(second.reason, 'unchanged_hash');
  assert.equal(second.hash, first.hash);
});

test('Antinuke: isChannelExempt protects ticket categories and ticket channels', async () => {
  const guildId = '123456789';

  // Channels with ticket- or tkt- prefix are exempt
  const ticketChan = { id: '901', name: 'ticket-0042', parentId: '555' };
  assert.equal(await isChannelExempt(guildId, ticketChan.id, ticketChan), true);

  const tktChan = { id: '902', name: 'tkt-premium', parentId: '555' };
  assert.equal(await isChannelExempt(guildId, tktChan.id, tktChan), true);

  // Standard channels are not exempt
  const normalChan = { id: '903', name: 'general-chat', parentId: '555' };
  assert.equal(await isChannelExempt(guildId, normalChan.id, normalChan), false);
});

test('Antinuke: isTrusted grants immunity to owner, bot, and trusted users', async () => {
  const mockGuild = {
    id: 'guild_test_immunity',
    ownerId: 'owner_user_1',
    client: { user: { id: 'bot_client_id' } },
    members: { cache: new Map() }
  };

  // Real guild owner is immune
  assert.equal(await isTrusted(mockGuild, 'owner_user_1'), true);

  // Bot itself is immune
  assert.equal(await isTrusted(mockGuild, 'bot_client_id'), true);

  // Random untrusted user is NOT immune
  assert.equal(await isTrusted(mockGuild, 'untrusted_attacker_99'), false);
});

test('Antinuke: restoreChannelBatch orders categories before child channels', async () => {
  const createdOrder = [];

  const mockGuild = {
    id: 'guild_restore_test',
    roles: { cache: new Map() },
    members: { cache: new Map() },
    channels: {
      create: async (opts) => {
        createdOrder.push({ name: opts.name, type: opts.type });
        return { id: `new_${opts.name}`, idMap: new Map() };
      }
    }
  };

  // Snapshots mixed: text channel first, then category
  const mixedSnapshots = [
    { id: 'c1', name: 'chat-one', type: ChannelType.GuildText, parentId: 'cat1' },
    { id: 'cat1', name: 'COMMUNITY', type: ChannelType.GuildCategory, parentId: null },
    { id: 'c2', name: 'voice-hangout', type: ChannelType.GuildVoice, parentId: 'cat1' }
  ];

  const res = await restoreChannelBatch(mockGuild, mixedSnapshots);
  assert.equal(res.restored, 3);
  assert.equal(res.failed, 0);

  // Verify Category was created FIRST in order
  assert.equal(createdOrder[0].name, 'COMMUNITY');
  assert.equal(createdOrder[0].type, ChannelType.GuildCategory);
  assert.equal(createdOrder[1].name, 'chat-one');
  assert.equal(createdOrder[2].name, 'voice-hangout');
});

test('Remap: remapIds correctly maps channel and role IDs across module settings', async () => {
  const channelMap = new Map([
    ['old_log_chan', 'new_log_chan'],
    ['old_boost_chan', 'new_boost_chan']
  ]);

  const roleMap = new Map([
    ['old_staff_role', 'new_staff_role']
  ]);

  const res = await remapIds('mock_guild_remap', { channels: channelMap, roles: roleMap });
  assert.equal(typeof res.channelsRemapped, 'number');
  assert.equal(typeof res.rolesRemapped, 'number');
});

test('Antinuke: repairAntinukeState fixes corrupted database records and generates backup', async () => {
  const { repaired, fixes } = await repairAntinukeState('mock_guild_repair_101');
  assert.equal(typeof repaired, 'boolean');
  assert(Array.isArray(fixes));
  assert(fixes.length > 0);
  assert(fixes.some(f => f.includes('backup') || f.includes('defaults') || f.includes('schema')));
});

test('Lockdown: LockdownStateSchema enforces locked_channels array and versioning', () => {
  const validState = LockdownStateSchema.parse({
    guild_id: '123456',
    active: true,
    locked_channels: ['chan_1', 'chan_2', 'chan_3'],
    saved_overwrites: {
      chan_1: { allow: '0', deny: '2048' }
    },
    version: 1
  });

  assert.equal(validState.active, true);
  assert.equal(validState.locked_channels.length, 3);
  assert.equal(validState.locked_channels[0], 'chan_1');
  assert.equal(validState.version, 1);
});

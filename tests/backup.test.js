import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerBackup } from '../src/modules/backup/creator.js';
import { restoreServerBackup, validateRestorePermissions } from '../src/modules/backup/restorer.js';
import { getBackupById, getGuildBackups, setBackupLock, renameBackup } from '../src/db/backups.js';
import { ChannelType, PermissionFlagsBits } from 'discord.js';

test('createServerBackup generates structured snapshot and persists to database and storage', async () => {
  const mockGuild = {
    id: '111222333444555666',
    name: 'Test Server',
    description: 'Server Description',
    verificationLevel: 1,
    defaultMessageNotifications: 0,
    explicitContentFilter: 0,
    afkTimeout: 300,
    preferredLocale: 'en-US',
    iconURL: () => 'https://example.com/icon.png',
    bannerURL: () => null,
    splashURL: () => null,
    roles: {
      cache: new Map([
        ['role1', { id: 'role1', name: 'Moderator', color: 0x3498db, hoist: true, permissions: { bitfield: 8n }, mentionable: true, position: 2, managed: false }],
        ['111222333444555666', { id: '111222333444555666', name: '@everyone', color: 0, hoist: false, permissions: { bitfield: 0n }, mentionable: false, position: 0, managed: false }]
      ])
    },
    channels: {
      cache: new Map([
        ['cat1', { id: 'cat1', name: 'General Category', type: ChannelType.GuildCategory, rawPosition: 0, permissionOverwrites: { cache: new Map() } }],
        ['ch1', { id: 'ch1', name: 'chat', type: ChannelType.GuildText, parentId: 'cat1', rawPosition: 1, topic: 'General Chat', nsfw: false, permissionOverwrites: { cache: new Map() } }]
      ])
    },
    emojis: { cache: new Map([['emo1', { name: 'pepe', url: 'https://example.com/pepe.png' }]]) },
    stickers: { cache: new Map() },
    members: {
      me: {
        permissions: {
          has: () => true
        }
      }
    }
  };

  const mockUser = { id: '999888777666555444', tag: 'Owner#0001' };

  const { id, record, snapshot } = await createServerBackup({
    guild: mockGuild,
    user: mockUser,
    name: 'Alpha-Snapshot',
    options: { roles: true, channels: true, settings: true, emojis: true }
  });

  assert.ok(id, 'Backup ID generated');
  assert.equal(record.name, 'Alpha-Snapshot');
  assert.equal(snapshot.roles.length, 1);
  assert.equal(snapshot.channels.length, 2);

  const fetched = await getBackupById(id);
  assert.ok(fetched, 'Backup fetched from DB');
  assert.equal(fetched.id, id);

  await setBackupLock(id, true);
  const locked = await getBackupById(id);
  assert.equal(locked.locked, true);

  await renameBackup(id, 'Renamed-Snapshot');
  const renamed = await getBackupById(id);
  assert.equal(renamed.name, 'Renamed-Snapshot');
});

test('validateRestorePermissions detects missing permissions', () => {
  const mockGuildMissingPerms = {
    members: {
      me: {
        permissions: {
          has: (bit) => bit !== PermissionFlagsBits.ManageRoles
        }
      }
    }
  };

  const check = validateRestorePermissions(mockGuildMissingPerms);
  assert.equal(check.valid, false);
  assert.ok(check.missing.includes('Manage Roles'));
});

test('getUserBackups retrieves snapshots across all servers and cross-server restore succeeds', async () => {
  const { getUserBackups } = await import('../src/db/backups.js');
  const userId = 'user_cross_server_tester';

  const mockGuildA = {
    id: `origin_${Date.now()}`,
    name: 'Origin Guild Alpha',
    description: null,
    iconURL: () => null,
    bannerURL: () => null,
    splashURL: () => null,
    roles: { cache: new Map() },
    channels: {
      cache: new Map([
        ['c1', { id: 'c1', name: 'announcements', type: ChannelType.GuildText, rawPosition: 0, permissionOverwrites: { cache: new Map() } }]
      ])
    },
    emojis: { cache: new Map() },
    stickers: { cache: new Map() },
    members: { me: { permissions: { has: () => true } } }
  };

  const { id, snapshot } = await createServerBackup({
    guild: mockGuildA,
    user: { id: userId, tag: 'CrossOwner#0001' },
    name: 'Cross-Server-Template',
    options: { channels: true }
  });

  // Verify user can fetch their backup regardless of current guild
  const userBackups = await getUserBackups(userId);
  assert.ok(userBackups.some(b => b.id === id), 'User backups must include snapshot created in Guild A');

  // Now simulate restoring into Guild B (a completely different server)
  let deletedChannelCount = 0;
  let deletedRoleCount = 0;
  let setPositionsCalled = false;

  const mockGuildB = {
    id: `dest_${Date.now()}`,
    name: 'Destination Guild Beta',
    roles: {
      cache: new Map([
        ['old_role_1', { id: 'old_role_1', name: 'Old Role', managed: false, position: 2, delete: async () => { deletedRoleCount++; } }]
      ]),
      everyone: { setPermissions: async () => {} },
      create: async (opts) => ({ id: `new_role_${Date.now()}_${Math.random()}`, name: opts.name, position: 1 }),
      setPositions: async (positions) => {
        setPositionsCalled = true;
        return positions;
      }
    },
    channels: {
      cache: new Map([
        ['old_chan_1', { id: 'old_chan_1', name: 'old-chat', delete: async () => { deletedChannelCount++; } }]
      ]),
      create: async (opts) => ({ id: `new_${Date.now()}`, name: opts.name, type: opts.type })
    },
    members: {
      me: {
        roles: { highest: { position: 15 } },
        permissions: { has: () => true }
      }
    }
  };

  const result = await restoreServerBackup({
    guild: mockGuildB,
    user: { id: userId, tag: 'CrossOwner#0001' },
    snapshot,
    clean: true
  });

  assert.ok(result.completedSteps.length > 0, 'Restore into Guild B should succeed');
  assert.equal(deletedChannelCount, 1, 'Clean restore should wipe existing unpreserved channels');
  assert.equal(deletedRoleCount, 1, 'Clean restore should wipe existing non-managed roles');
  assert.ok(result.completedSteps.some(s => s.includes('Cleaned')), 'Result should log clean wipe');
});


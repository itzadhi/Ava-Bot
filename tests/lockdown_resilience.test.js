import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import {
  initiateLockdown,
  terminateLockdown,
  isGuildLocked,
  getLockdownState,
  repairCorruptedLockdown
} from '../src/modules/antinuke/lockdown.js';
import { updateAntiNukeSettings } from '../src/db/antinuke.js';
import { backgroundQueue } from '../src/core/jobs/jobManager.js';

test('Lockdown Resilience Matrix: 150 Channels, Fast-Path, Plan Persistence, and Idempotency', async () => {
  const guildId = `test_resilience_${Date.now()}`;
  await updateAntiNukeSettings(guildId, { enabled: true });

  let roleSetPermissionsCalled = false;
  let rolePermsAfterFastPath = 0n;

  const mockEveryoneRole = {
    id: guildId,
    name: '@everyone',
    permissions: new PermissionsBitField(
      PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.AddReactions
    ),
    setPermissions: async (perms) => {
      roleSetPermissionsCalled = true;
      rolePermsAfterFastPath = perms;
    }
  };

  const channelMap = new Map();
  const overwriteEditLog = new Map();

  for (let i = 1; i <= 150; i++) {
    const chId = `chan_${i}`;
    const initialDeny = i % 3 === 0 ? PermissionFlagsBits.EmbedLinks : 0n;
    const initialAllow = i % 5 === 0 ? PermissionFlagsBits.ViewChannel : 0n;

    const ch = {
      id: chId,
      name: `channel-${i}`,
      type: ChannelType.GuildText,
      isTextBased: () => true,
      permissionOverwrites: {
        cache: new Map([
          [guildId, {
            id: guildId,
            type: 0,
            allow: { bitfield: initialAllow },
            deny: { bitfield: initialDeny }
          }]
        ]),
        edit: async (targetId, overwrites) => {
          overwriteEditLog.set(chId, overwrites);
          const current = ch.permissionOverwrites.cache.get(guildId) || {
            allow: { bitfield: 0n },
            deny: { bitfield: 0n }
          };
          if (overwrites.SendMessages === false) {
            current.deny.bitfield |= PermissionFlagsBits.SendMessages;
          }
        },
        delete: async () => {
          ch.permissionOverwrites.cache.delete(guildId);
        }
      }
    };
    channelMap.set(chId, ch);
  }

  const mockGuild = {
    id: guildId,
    name: 'Resilience Test Server',
    client: {},
    roles: {
      everyone: mockEveryoneRole,
      cache: new Map([[guildId, mockEveryoneRole]])
    },
    channels: {
      cache: channelMap
    },
    members: {
      me: {
        permissions: new PermissionsBitField(PermissionFlagsBits.Administrator)
      }
    }
  };

  // 1. FAST PATH EXECUTION SPEED: Must complete role lock in < 150ms
  const start = performance.now();
  const lockResult = await initiateLockdown(mockGuild, 'Mass raid simulation on 150 channels');
  const elapsed = performance.now() - start;

  assert.equal(lockResult.locked, true, 'Lockdown initiate must return locked status');
  assert.ok(elapsed < 3000, `Fast-path role lock must return in < 3s SLA (took ${elapsed.toFixed(1)}ms)`);
  assert.equal(roleSetPermissionsCalled, true, 'Fast path must edit @everyone role permissions');
  assert.equal((rolePermsAfterFastPath & PermissionFlagsBits.SendMessages), 0n, 'SendMessages must be stripped from role');
  assert.equal(isGuildLocked(guildId), true, 'Server must report isGuildLocked = true immediately');

  // 2. PLAN PERSISTENCE BEFORE FULL CHANNEL RUN
  const state = await getLockdownState(guildId);
  assert.ok(state, 'Lockdown state must be saved');
  assert.equal(state.state, 'locking', 'Initial state must be locking');
  assert.equal(Object.keys(state.plan.channels).length, 150, 'All 150 original overwrites must be preserved in plan');

  // 3. IDEMPOTENCY: Repeated initiate while locking returns existing status instantly (<10ms)
  const repeatStart = performance.now();
  const repeatLock = await initiateLockdown(mockGuild, 'Another trigger while already locking');
  const repeatElapsed = performance.now() - repeatStart;
  assert.equal(repeatLock.locked, true);
  assert.equal(repeatLock.alreadyLocked, true);
  assert.ok(repeatElapsed < 20, `Repeated call must return instantly (< 20ms, took ${repeatElapsed.toFixed(1)}ms)`);

  // 4. WAIT FOR BACKGROUND CHANNEL OVERWRITES POOL (150 channels via 8 workers)
  await backgroundQueue.onIdle();

  const finishedState = await getLockdownState(guildId);
  assert.ok(finishedState);
  assert.equal(finishedState.state, 'locked', 'State must advance to locked once workers complete');
  assert.equal(finishedState.counters.locked, 150, 'All 150 channels must be locked');

  // 5. UNLOCK AND EXACT RESTORATION
  const unlockResult = await terminateLockdown(mockGuild, 'All raid members cleared');
  assert.equal(unlockResult.unlocked, true, 'Unlock command must initiate successfully');
  assert.equal(isGuildLocked(guildId), false, 'Server must immediately be un-locked during unlock phase');

  await backgroundQueue.onIdle();

  const finalState = await getLockdownState(guildId);
  assert.ok(!finalState || finalState.state === 'idle', 'State must be reset to idle on finish');

  // 6. ONE-TIME REPAIR VERIFICATION
  // Simulate 3 channels corrupted with remnant lockdown deny bits
  for (let i = 1; i <= 3; i++) {
    const ch = channelMap.get(`chan_${i}`);
    ch.permissionOverwrites.cache.set(guildId, {
      deny: { bitfield: PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions }
    });
  }

  const repairReport = await repairCorruptedLockdown(mockGuild);
  assert.equal(repairReport.repaired, true);
  assert.equal(repairReport.fixed, 3, 'Repair tool must identify and fix the 3 corrupted channels');
});

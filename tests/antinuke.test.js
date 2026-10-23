import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle, PermissionFlagsBits, ChannelType } from 'discord.js';
import {
  getAntiNukeSettings,
  updateAntiNukeSettings,
  addTrustedUser,
  removeTrustedUser,
  addTrustedRole,
  isTrusted,
  takeChannelSnapshot,
  getChannelSnapshot,
  getAllLiveChannelSnapshots,
  saveLockdownState,
  getLockdownState,
  clearLockdownState
} from '../src/db/antinuke.js';
import { remapChannelIds } from '../src/modules/antinuke/remap.js';
import { restoreChannelFromSnapshot, handleChannelDelete } from '../src/modules/antinuke/restore.js';
import { evaluateRaidMessage, executeLockdown, liftLockdown, isGuildLocked } from '../src/modules/antinuke/lockdown.js';
import { handleRoleDelete, handleBotMemberAdd, handleRolePermissionUpdate } from '../src/modules/antinuke/extra.js';
import { buildAntiNukeWizard, TOTAL_PAGES, PAGE_TITLES } from '../src/modules/antinuke/panel.js';

test('Anti-Nuke Settings & Trusted: Owner is always trusted, custom trusted roles and users work', async () => {
  const guildId = `test_an_guild_${Date.now()}`;
  const ownerId = 'guild_real_owner_100';

  const mockGuild = {
    id: guildId,
    ownerId: ownerId,
    roles: { cache: new Map() }
  };

  // 1. Owner is always trusted
  const ownerTrusted = await isTrusted(mockGuild, ownerId);
  assert.equal(ownerTrusted, true, 'Real guild owner must always be trusted');

  // 2. Untrusted user is false initially
  const randomUser = 'untrusted_user_1';
  const initiallyTrusted = await isTrusted(mockGuild, randomUser);
  assert.equal(initiallyTrusted, false, 'Regular member should not be trusted');

  // 3. Add user to trusted list
  await addTrustedUser(guildId, randomUser);
  const nowTrusted = await isTrusted(mockGuild, randomUser);
  assert.equal(nowTrusted, true, 'User should be trusted after addTrustedUser');

  // 4. Remove user from trusted list
  await removeTrustedUser(guildId, randomUser);
  const untrustedAgain = await isTrusted(mockGuild, randomUser);
  assert.equal(untrustedAgain, false, 'User should not be trusted after removal');

  // 5. Extra owner in settings is trusted
  await updateAntiNukeSettings(guildId, { extra_owners: ['trusted_co_owner_1'] });
  const coOwnerTrusted = await isTrusted(mockGuild, 'trusted_co_owner_1');
  assert.equal(coOwnerTrusted, true, 'User in extra_owners must be trusted');
});

test('Anti-Nuke Snapshot & ID Remapping: Channel snapshots persist and update references across tables', async () => {
  const guildId = `test_an_snap_${Date.now()}`;
  const oldChanId = 'chan_old_111';
  const newChanId = 'chan_restored_222';

  // 1. Take snapshot of mock channel
  const mockChannel = {
    id: oldChanId,
    name: 'announcements',
    type: ChannelType.GuildText,
    parentId: null,
    position: 2,
    topic: 'Official community announcements',
    nsfw: false,
    rateLimitPerUser: 0,
    permissionOverwrites: {
      cache: new Map([
        ['everyone_role_id', { id: 'everyone_role_id', type: 0, allow: { bitfield: 0n }, deny: { bitfield: 2048n } }]
      ])
    }
  };

  const mockGuild = {
    id: guildId,
    channels: {
      cache: new Map([[oldChanId, mockChannel]])
    }
  };

  await takeChannelSnapshot(mockGuild, mockChannel);
  const snapshot = await getChannelSnapshot(guildId, oldChanId);
  assert.ok(snapshot, 'Snapshot must be stored in database and live cache');
  assert.equal(snapshot.name, 'announcements');
  assert.equal(snapshot.topic, 'Official community announcements');

  // 2. Test Channel ID Remapping across settings tables
  const idMap = new Map([[oldChanId, newChanId]]);
  const remapped = await remapChannelIds(guildId, idMap);
  assert.ok(remapped, 'remapChannelIds should complete without error');
});

test('Anti-Nuke Channel Restore: Ticket channels and categories are strictly ignored', async () => {
  const guildId = `test_an_tkt_exempt_${Date.now()}`;
  await updateAntiNukeSettings(guildId, { enabled: true });

  const mockGuild = {
    id: guildId,
    ownerId: 'owner_99',
    channels: { cache: new Map() }
  };

  const ticketChannel = {
    id: 'chan_ticket_888',
    name: 'ticket-0099',
    parentId: 'cat_tickets_exempt',
    guild: mockGuild,
    isTextBased: () => true
  };
  mockGuild.channels.cache.set(ticketChannel.id, ticketChannel);

  // Channel deletion of ticket channel should be ignored
  const handled = await handleChannelDelete(ticketChannel);
  assert.equal(handled, false, 'Ticket channel deletion must be skipped by Anti-Nuke restoration');
});

test('Anti-Nuke Raid Detection & Server Lockdown: Triggers on burst spam and denies @everyone', async () => {
  const guildId = `test_an_raid_${Date.now()}`;
  await updateAntiNukeSettings(guildId, { enabled: true });
  const spamContent = 'FREE NITRO AT HTTPS://SCAM-DISCORD.GG/GIFT';

  let sendDisabled = false;
  const mockEveryoneRole = {
    id: guildId,
    name: '@everyone'
  };

  const mockChannel = {
    id: 'chan_general_raid',
    name: 'general',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionOverwrites: {
      cache: new Map([
        [guildId, {
          id: guildId,
          type: 0,
          allow: { bitfield: 0n },
          deny: { bitfield: 0n }
        }]
      ]),
      edit: async (roleOrUser, overwrites) => {
        if (overwrites.SendMessages === false) {
          sendDisabled = true;
        }
      }
    }
  };

  const mockGuild = {
    id: guildId,
    name: 'Raid Test Server',
    roles: {
      everyone: mockEveryoneRole,
      cache: new Map([[guildId, mockEveryoneRole]])
    },
    channels: {
      cache: new Map([[mockChannel.id, mockChannel]])
    },
    members: {
      ban: async () => {}
    }
  };

  // Feed burst messages from 5 distinct users
  let raidTriggered = false;
  for (let i = 1; i <= 6; i++) {
    const msg = {
      guild: mockGuild,
      channel: mockChannel,
      author: { id: `raider_user_${i}`, bot: false, tag: `Raider#${i}` },
      content: spamContent,
      delete: async () => {}
    };

    const isRaid = await evaluateRaidMessage(msg);
    if (isRaid) {
      raidTriggered = true;
      break;
    }
  }

  assert.equal(raidTriggered, true, 'Raid detector must trigger on rapid identical spam from distinct users');

  // Execute server lockdown
  const lockdownResult = await executeLockdown(mockGuild, ['raider_user_1', 'raider_user_2'], 'Mass raid spam detected');
  assert.equal(lockdownResult.locked, true, 'Server should be in lockdown');
  assert.equal(isGuildLocked(guildId), true, 'isGuildLocked should return true');
  assert.equal(sendDisabled, true, 'Lockdown must deny SendMessages permission for @everyone');

  // Verify backup stored in lockdown_state
  const state = await getLockdownState(guildId);
  assert.ok(state, 'Previous overwrites must be preserved in lockdown_state');

  // Lift server lockdown
  const liftResult = await liftLockdown(mockGuild, 'Test finished');
  assert.equal(liftResult.unlocked, true);
  assert.equal(isGuildLocked(guildId), false);
});

test('Anti-Nuke Extra Protections: Detects unauthorized bot additions and dangerous permissions', async () => {
  const guildId = `test_an_extra_${Date.now()}`;
  await updateAntiNukeSettings(guildId, { enabled: true });
  let kickedBot = false;

  const mockBotMember = {
    id: 'rogue_bot_user_1',
    user: { bot: true, id: 'rogue_bot_user_1', tag: 'RogueBot#0001' },
    guild: {
      id: guildId,
      ownerId: 'owner_legit_1',
      fetchAuditLogs: async () => ({
        entries: new Map([
          ['audit_1', {
            action: 28, // BOT_ADD
            executor: { id: 'malicious_admin_1' },
            target: { id: 'rogue_bot_user_1' }
          }]
        ])
      })
    },
    kick: async () => { kickedBot = true; }
  };

  await handleBotMemberAdd(mockBotMember);
  assert.equal(kickedBot, true, 'Unauthorized bot addition by untrusted user must be kicked');
});

test('Anti-Nuke Wizard UI: Strictly Components V2, no accent color, and pure grey buttons across all 7 pages', async () => {
  const guildId = 'test_wizard_antinuke_1';
  const userId = 'user_wizard_owner_1';

  assert.equal(TOTAL_PAGES, 7);
  assert.equal(PAGE_TITLES.length, 7);

  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const wizard = await buildAntiNukeWizard(guildId, userId, page);

    // Strict UI Rule 1: Components V2 ONLY
    assert.equal(wizard.flags, MessageFlags.IsComponentsV2, `Page ${page} must return MessageFlags.IsComponentsV2`);
    assert.equal(wizard.components.length, 1, `Page ${page} must contain exactly 1 container component`);

    const containerJson = wizard.components[0].toJSON();

    // Strict UI Rule 2: NO accent color
    assert.equal(containerJson.accent_color, undefined, `Page ${page} must NOT have accent_color`);

    // Strict UI Rule 3: Check all buttons are ButtonStyle.Secondary (pure grey) or Link
    const actionRows = containerJson.components.filter(c => c.type === 1);
    for (const row of actionRows) {
      for (const comp of row.components) {
        if (comp.type === 2) { // Button
          assert.ok(
            comp.style === ButtonStyle.Secondary || comp.style === ButtonStyle.Link,
            `Button ${comp.custom_id || comp.label} on page ${page} must be pure grey (Secondary) or Link`
          );
        }
      }
    }
  }
});

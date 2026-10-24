import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { scanMessage, enforceViolation, isAutoModBypassed } from '../src/modules/automod/engine.js';
import { buildAutoModPanel, buildBannedWordsModal } from '../src/modules/automod/panel.js';
import { buildBoostCelebrationCard, handleBoostMemberUpdate } from '../src/modules/boosts/tracker.js';
import { buildBoostPanel, buildBoostMessageModal } from '../src/modules/boosts/panel.js';
import { handleFeedbackVoiceInteraction } from '../src/modules/router.js';
import { getGuildSettings, updateGuildSettings } from '../src/db/guilds.js';
import { buildSuggestionCard, postSuggestionMessage } from '../src/modules/suggestions/index.js';

test('AutoMod Engine: Rule detection for invites, links, mentions, caps, words, and spam', async () => {
  const guildSettings = {
    automod_enabled: true,
    automod_anti_invites: true,
    automod_anti_links: true,
    automod_anti_mentions: true,
    automod_anti_caps: true,
    automod_word_filter: true,
    automod_banned_words: ['scamlink', 'freenitro'],
    automod_anti_spam: true,
    automod_action: 'delete'
  };

  const normalMember = {
    user: { bot: false, id: 'user_norm_1' },
    permissions: { has: () => false },
    roles: { cache: new Map() }
  };

  // 1. Anti-Invites test
  const inviteMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'Check out my cool server https://discord.gg/AvaDev'
  };
  const inviteResult = await scanMessage(inviteMsg, guildSettings);
  assert.equal(inviteResult.violated, true);
  assert.equal(inviteResult.rule, 'anti_invites');

  // 2. Anti-Links test
  const linkMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'Visit https://example.com for free gifts'
  };
  const linkResult = await scanMessage(linkMsg, guildSettings);
  assert.equal(linkResult.violated, true);
  assert.equal(linkResult.rule, 'anti_links');

  // 3. Mass Mentions test (> 4)
  const mentionMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'Hello everyone!',
    mentions: {
      users: new Map([['u1', {}], ['u2', {}], ['u3', {}]]),
      roles: new Map([['r1', {}], ['r2', {}]])
    }
  };
  const mentionResult = await scanMessage(mentionMsg, guildSettings);
  assert.equal(mentionResult.violated, true);
  assert.equal(mentionResult.rule, 'anti_mentions');

  // 4. Anti-Caps test (> 70% uppercase)
  const capsMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'PLEASE JOIN MY VOICE CHANNEL RIGHT NOW',
    mentions: { users: new Map(), roles: new Map() }
  };
  const capsResult = await scanMessage(capsMsg, guildSettings);
  assert.equal(capsResult.violated, true);
  assert.equal(capsResult.rule, 'anti_caps');

  // 5. Word Filter test
  const wordMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'Click here to claim your FreeNitro promotion!',
    mentions: { users: new Map(), roles: new Map() }
  };
  const wordResult = await scanMessage(wordMsg, guildSettings);
  assert.equal(wordResult.violated, true);
  assert.equal(wordResult.rule, 'word_filter');

  // 6. Safe message passes cleanly
  const safeMsg = {
    guild: { id: 'guild_am_1' },
    author: normalMember.user,
    member: normalMember,
    content: 'Hello team, how is the development going today?',
    mentions: { users: new Map(), roles: new Map() }
  };
  const safeResult = await scanMessage(safeMsg, guildSettings);
  assert.equal(safeResult.violated, false);
});

test('AutoMod Engine: Staff and Admin bypasses correctly', async () => {
  const guildSettings = {
    automod_enabled: true,
    automod_anti_invites: true,
    staff_role_id: 'staff_role_99'
  };

  const adminMember = {
    user: { bot: false, id: 'admin_1' },
    permissions: {
      has: (bit) => bit === PermissionFlagsBits.Administrator || bit === PermissionFlagsBits.ManageGuild
    },
    roles: { cache: new Map() }
  };

  assert.equal(isAutoModBypassed(adminMember, guildSettings), true);

  const adminMsg = {
    guild: { id: 'guild_am_2' },
    author: adminMember.user,
    member: adminMember,
    content: 'Staff announcement: discord.gg/staffroom'
  };
  const adminResult = await scanMessage(adminMsg, guildSettings);
  assert.equal(adminResult.violated, false, 'Admins should bypass AutoMod rules');

  const staffMember = {
    user: { bot: false, id: 'staff_1' },
    permissions: { has: () => false },
    roles: { cache: new Map([['staff_role_99', {}]]) }
  };
  assert.equal(isAutoModBypassed(staffMember, guildSettings), true, 'Staff role should bypass AutoMod rules');

  // Test AutoMod Exception Role bypass
  const exceptionSettings = {
    automod_enabled: true,
    automod_anti_invites: true,
    automod_exception_role_id: 'role_vip_exception'
  };

  const vipMember = {
    user: { bot: false, id: 'vip_1' },
    permissions: { has: () => false },
    roles: { cache: new Map([['role_vip_exception', {}]]) }
  };

  assert.equal(isAutoModBypassed(vipMember, exceptionSettings), true, 'Exception role must bypass AutoMod');

  const vipMsg = {
    guild: { id: 'guild_am_3' },
    author: vipMember.user,
    member: vipMember,
    content: 'VIP announcement: discord.gg/vipzone'
  };
  const vipResult = await scanMessage(vipMsg, exceptionSettings);
  assert.equal(vipResult.violated, false, 'VIP with exception role should not have message blocked');
});

test('AutoMod Panel: Renders with Components V2 without sidebar accent colors', () => {
  const guildSettings = {
    automod_enabled: true,
    automod_anti_invites: true,
    automod_anti_links: false,
    automod_anti_spam: true,
    automod_anti_mentions: true,
    automod_anti_caps: false,
    automod_word_filter: true,
    automod_banned_words: ['badword'],
    automod_action: 'warn',
    automod_log_channel_id: 'chan_log_1'
  };

  const panel = buildAutoModPanel(guildSettings);
  assert.equal(panel.flags, MessageFlags.IsComponentsV2);
  assert.equal(panel.components.length, 1);

  const containerJson = panel.components[0].toJSON();
  assert.equal(containerJson.accent_color, undefined, 'Container must NOT have sidebar accent color');

  // Must have action rows for toggles, action select, channel select, and utilities
  const actionRows = containerJson.components.filter(c => c.type === 1);
  assert.ok(actionRows.length >= 4, 'Must have at least 4 interactive component rows');

  // Modal builder check
  const modal = buildBannedWordsModal(['word1', 'word2']);
  assert.ok(modal.data.custom_id.startsWith('fb:am:words_submit:'));
});

test('Boost Tracker: Celebration card adheres strictly to Components V2', () => {
  const mockGuild = {
    id: 'guild_bst_1',
    name: 'AVA Community',
    premiumSubscriptionCount: 7,
    premiumTier: 2,
    iconURL: () => 'https://cdn.discordapp.com/icons/123/abc.png'
  };

  const mockMember = {
    id: 'booster_user_1',
    user: { id: 'booster_user_1', username: 'HyperBooster', tag: 'HyperBooster#0001' },
    displayName: 'HyperBooster',
    displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/abc.png'
  };

  const card = buildBoostCelebrationCard({
    member: mockMember,
    guild: mockGuild,
    boostCount: 8,
    tier: 2,
    customMessage: 'Thank you for boosting the community!'
  });

  assert.equal(card.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components.length, 1);

  const containerJson = card.components[0].toJSON();
  assert.equal(containerJson.accent_color, undefined, 'Celebration container must not have accent color');
  const section = containerJson.components.find(c => c.type === 9 || c.components?.length > 0);
  assert.ok(section, 'Must contain section component');
});

test('Boost Tracker: Detects boost event, auto-assigns booster role, and removes on expiry', async () => {
  const testGuildId = `guild_bst_${Date.now()}`;
  const boosterRoleId = 'role_booster_vip_99';
  const boostChanId = 'chan_boosts_123';

  await updateGuildSettings(testGuildId, {
    boost_tracking_enabled: true,
    boost_auto_role_enabled: true,
    boost_role_id: boosterRoleId,
    boost_channel_id: boostChanId
  });

  let assignedRole = null;
  let removedRole = null;
  let sentAnnouncement = null;

  const mockGuild = {
    id: testGuildId,
    premiumSubscriptionCount: 5,
    premiumTier: 1,
    members: {
      me: {
        permissions: { has: (bit) => bit === PermissionFlagsBits.ManageRoles }
      }
    },
    channels: {
      cache: new Map([
        [boostChanId, {
          id: boostChanId,
          isTextBased: () => true,
          send: async (payload) => {
            sentAnnouncement = payload;
            return { id: 'msg_boost_card' };
          }
        }]
      ])
    }
  };

  const oldMemberBeforeBoost = {
    id: 'user_bst_100',
    guild: mockGuild,
    premiumSince: null,
    roles: { cache: new Map() }
  };

  const newMemberAfterBoost = {
    id: 'user_bst_100',
    guild: mockGuild,
    premiumSince: new Date(),
    roles: {
      cache: new Map(),
      add: async (roleId) => { assignedRole = roleId; }
    },
    user: { id: 'user_bst_100', username: 'AceBooster' }
  };

  // Trigger member started boosting
  await handleBoostMemberUpdate(oldMemberBeforeBoost, newMemberAfterBoost);

  assert.equal(assignedRole, boosterRoleId, 'Should automatically assign configured booster role');
  assert.ok(sentAnnouncement, 'Should send boost celebration announcement card');
  assert.equal(sentAnnouncement.flags, MessageFlags.IsComponentsV2);

  // Trigger member stopped boosting
  const expiredMember = {
    id: 'user_bst_100',
    guild: mockGuild,
    premiumSince: null,
    roles: {
      cache: new Map([[boosterRoleId, {}]]),
      remove: async (roleId) => { removedRole = roleId; }
    },
    user: { id: 'user_bst_100', username: 'AceBooster' }
  };

  await handleBoostMemberUpdate(newMemberAfterBoost, expiredMember);
  assert.equal(removedRole, boosterRoleId, 'Should automatically remove booster role when boost expires');
});

test('Router: Intercepts AutoMod and Boost interactions smoothly', async () => {
  const testGuildId = `guild_router_am_bst_${Date.now()}`;
  await updateGuildSettings(testGuildId, {
    automod_enabled: true,
    automod_anti_invites: false,
    boost_tracking_enabled: true
  });

  let updatedPanelPayload = null;
  const mockStaffMember = {
    permissions: { has: (bit) => bit === PermissionFlagsBits.ManageGuild },
    roles: { cache: new Map() }
  };

  const mockInteraction = {
    customId: 'fb:am:toggle:invites',
    guildId: testGuildId,
    guild: { id: testGuildId, channels: { cache: new Map() } },
    member: mockStaffMember,
    deferUpdate: async () => {},
    update: async (payload) => { updatedPanelPayload = payload; },
    editReply: async (payload) => { updatedPanelPayload = payload; }
  };

  // Route AutoMod toggle
  const handledAM = await handleFeedbackVoiceInteraction(mockInteraction);
  assert.equal(handledAM, true, 'Router must handle fb:am:*');

  const settingsAfterAM = await getGuildSettings(testGuildId);
  assert.equal(settingsAfterAM.automod_anti_invites, true, 'Anti-invites should be toggled ON');

  // Route AutoMod exception role selection
  const exceptRoleInteraction = {
    customId: 'fb:am:except_role:0',
    values: ['role_media_team_10'],
    guildId: testGuildId,
    guild: { id: testGuildId, channels: { cache: new Map() } },
    member: mockStaffMember,
    deferUpdate: async () => {},
    update: async (payload) => { updatedPanelPayload = payload; },
    editReply: async (payload) => { updatedPanelPayload = payload; }
  };
  const handledExcept = await handleFeedbackVoiceInteraction(exceptRoleInteraction);
  assert.equal(handledExcept, true);
  const settingsAfterExcept = await getGuildSettings(testGuildId);
  assert.equal(settingsAfterExcept.automod_exception_role_id, 'role_media_team_10');

  // Route AutoMod clear exception roles
  const clearExceptInteraction = {
    customId: 'fb:am:clear_except:0',
    guildId: testGuildId,
    guild: { id: testGuildId, channels: { cache: new Map() } },
    member: mockStaffMember,
    deferUpdate: async () => {},
    update: async (payload) => { updatedPanelPayload = payload; },
    editReply: async (payload) => { updatedPanelPayload = payload; }
  };
  const handledClearExcept = await handleFeedbackVoiceInteraction(clearExceptInteraction);
  assert.equal(handledClearExcept, true);
  const settingsAfterClear = await getGuildSettings(testGuildId);
  assert.equal(settingsAfterClear.automod_exception_role_id, null);

  // Route Boost role select
  const boostRoleInteraction = {
    customId: 'fb:bst:role_sel:0',
    values: ['role_boost_champion_7'],
    guildId: testGuildId,
    guild: { id: testGuildId, channels: { cache: new Map() } },
    member: mockStaffMember,
    deferUpdate: async () => {},
    update: async (payload) => { updatedPanelPayload = payload; },
    editReply: async (payload) => { updatedPanelPayload = payload; }
  };

  const handledBoost = await handleFeedbackVoiceInteraction(boostRoleInteraction);
  assert.equal(handledBoost, true, 'Router must handle fb:bst:*');

  const settingsAfterBoost = await getGuildSettings(testGuildId);
  assert.equal(settingsAfterBoost.boost_role_id, 'role_boost_champion_7', 'Booster role should be saved');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { checkPermissions } from '../src/middleware/permissions.js';
import { getStickyNote, getAllStickyNotes, setStickyNote, toggleStickyNote, deleteStickyNote, getMemberStickyRoles, saveMemberStickyRoles } from '../src/db/sticky.js';
import { buildStickyNoteCard, handleStickyMessage } from '../src/modules/sticky/engine.js';
import { buildStickyPanel, buildStickyNoteModal } from '../src/modules/sticky/panel.js';
import { handleStickyRoleMemberLeave, handleStickyRoleMemberRejoin } from '../src/modules/stickyroles/engine.js';
import { buildStickyRolesPanel } from '../src/modules/stickyroles/panel.js';
import { handleAutoRoleMemberJoin } from '../src/modules/autorole/engine.js';
import { buildAutoRolePanel } from '../src/modules/autorole/panel.js';
import { handleFeedbackVoiceInteraction } from '../src/modules/router.js';
import { updateGuildSettings, getGuildSettings } from '../src/db/guilds.js';

test('Permissions: Regular members can run /suggest and /feedback without Server Owner Only restriction', async () => {
  let replyPayload = null;
  const regularCtx = {
    guild: { id: 'g_perm_1', ownerId: 'owner_user_999', name: 'Community Server' },
    user: { id: 'regular_member_123' },
    member: {
      permissions: { has: () => false },
      roles: { cache: new Map() }
    },
    isSlash: true,
    reply: async (payload) => { replyPayload = payload; }
  };

  // 1. /suggest is a public command
  const suggestCmd = { name: 'suggest', category: 'suggestions' };
  const permResult1 = await checkPermissions(regularCtx, suggestCmd);
  assert.equal(permResult1.ok, true, 'Regular members must be permitted to run /suggest');
  assert.equal(replyPayload, null, 'No error should be replied for public command');

  // 2. /feedback is a public command
  const feedbackCmd = { name: 'feedback', category: 'feedback' };
  const permResult2 = await checkPermissions(regularCtx, feedbackCmd);
  assert.equal(permResult2.ok, true, 'Regular members must be permitted to run /feedback');

  // 3. /automod is an admin command -> regular member gets Permission Denied (not Server Owner Only)
  const automodCmd = { name: 'automod', category: 'settings', userPermissions: [PermissionFlagsBits.ManageGuild] };
  const permResult3 = await checkPermissions(regularCtx, automodCmd);
  assert.equal(permResult3.ok, false);
  assert.ok(replyPayload, 'Should send rejection message');
  const renderedContent = JSON.stringify(replyPayload);
  assert.ok(renderedContent.includes('Permission Denied'), 'Should give Permission Denied instead of Server Owner Only');

  // 4. Server Owner can run admin commands
  const ownerCtx = {
    guild: { id: 'g_perm_1', ownerId: 'owner_user_999', name: 'Community Server' },
    user: { id: 'owner_user_999' },
    member: { permissions: { has: () => true }, roles: { cache: new Map() } },
    isSlash: true,
    reply: async () => {}
  };
  const permResultOwner = await checkPermissions(ownerCtx, automodCmd);
  assert.equal(permResultOwner.ok, true, 'Server owner can run any command');
});

test('Sticky Notes: Setting, card rendering, and message repositioning', async () => {
  const guildId = `g_stk_${Date.now()}`;
  const channelId = `c_stk_${Date.now()}`;

  // 1. Set sticky note
  const note = await setStickyNote(guildId, channelId, 'Remember to keep comments respectful!');
  assert.equal(note.channel_id, channelId);
  assert.equal(note.is_enabled, true);

  // 2. Card builder conforms to Components V2
  const card = buildStickyNoteCard(note.content);
  assert.equal(card.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components.length, 1);
  const containerJson = card.components[0].toJSON();
  assert.equal(containerJson.accent_color, undefined, 'Sticky note must not have accent color');

  // 3. Panel builder
  const allNotes = await getAllStickyNotes(guildId);
  assert.equal(allNotes.length, 1);
  const panel = buildStickyPanel({ id: guildId }, allNotes, channelId);
  assert.equal(panel.flags, MessageFlags.IsComponentsV2);

  // 4. Repositioning sticky message on user chat
  let deletedMsgId = null;
  let sentMsg = null;
  const mockUserMsg = {
    guild: { id: guildId },
    channel: {
      id: channelId,
      messages: {
        fetch: async (id) => ({ id, delete: async () => { deletedMsgId = id; } })
      },
      send: async (payload) => {
        sentMsg = { id: 'sticky_msg_new', ...payload };
        return sentMsg;
      }
    },
    author: { bot: false, id: 'user_chat_1' }
  };

  note.last_message_id = 'sticky_msg_old';

  const handled = await handleStickyMessage(mockUserMsg);
  assert.equal(handled, true);
  assert.equal(deletedMsgId, 'sticky_msg_old', 'Old sticky message must be deleted');
  assert.ok(sentMsg, 'New sticky message must be posted');

  // 5. Toggle and Delete
  const toggled = await toggleStickyNote(channelId);
  assert.equal(toggled.is_enabled, false);

  await deleteStickyNote(channelId);
  const afterDelete = await getStickyNote(channelId);
  assert.equal(afterDelete, null);
});

test('Sticky Roles: Member leave saves roles and rejoin restores them', async () => {
  const guildId = `g_sr_${Date.now()}`;
  const userId = `u_sr_${Date.now()}`;
  const role1 = 'role_vip_1';
  const role2 = 'role_muted_2';

  await updateGuildSettings(guildId, {
    sticky_roles_enabled: true,
    sticky_all_roles: true
  });

  const mockGuild = {
    id: guildId,
    roles: {
      cache: new Map([
        [role1, { id: role1, position: 5, managed: false }],
        [role2, { id: role2, position: 4, managed: false }]
      ])
    },
    members: {
      me: {
        permissions: { has: (bit) => bit === PermissionFlagsBits.ManageRoles },
        roles: { highest: { position: 10 } }
      }
    }
  };

  const leavingMember = {
    guild: mockGuild,
    id: userId,
    user: { bot: false, id: userId },
    roles: {
      cache: new Map([
        [role1, { id: role1, position: 5, managed: false }],
        [role2, { id: role2, position: 4, managed: false }],
        [guildId, { id: guildId, position: 0, managed: false }] // @everyone
      ])
    }
  };

  // Member departs
  await handleStickyRoleMemberLeave(leavingMember);

  const savedRoles = await getMemberStickyRoles(guildId, userId);
  assert.ok(savedRoles.includes(role1));
  assert.ok(savedRoles.includes(role2));
  assert.ok(!savedRoles.includes(guildId), '@everyone should not be saved as a sticky role');

  // Member rejoins
  let assignedRoles = null;
  const rejoiningMember = {
    guild: mockGuild,
    id: userId,
    user: { bot: false, id: userId },
    roles: {
      add: async (roles) => { assignedRoles = roles; }
    }
  };

  await handleStickyRoleMemberRejoin(rejoiningMember);
  assert.deepEqual(assignedRoles, [role1, role2], 'Saved sticky roles must be re-assigned');
});

test('Auto-Role: Assigns human role to members and bot role to bots upon joining', async () => {
  const guildId = `g_ar_${Date.now()}`;
  const memberRoleId = 'role_member_join_1';
  const botRoleId = 'role_bot_join_2';

  await updateGuildSettings(guildId, {
    autorole_enabled: true,
    autorole_member_role_id: memberRoleId,
    autorole_bot_role_id: botRoleId
  });

  const mockGuild = {
    id: guildId,
    roles: {
      cache: new Map([
        [memberRoleId, { id: memberRoleId, position: 5 }],
        [botRoleId, { id: botRoleId, position: 4 }]
      ])
    },
    members: {
      me: {
        permissions: { has: (bit) => bit === PermissionFlagsBits.ManageRoles },
        roles: { highest: { position: 10 } }
      }
    }
  };

  // 1. Human user joins
  let humanAssigned = null;
  const humanMember = {
    guild: mockGuild,
    id: 'user_human_99',
    user: { bot: false },
    roles: { add: async (r) => { humanAssigned = r; } }
  };
  await handleAutoRoleMemberJoin(humanMember);
  assert.equal(humanAssigned, memberRoleId, 'Human should receive member auto-role');

  // 2. Bot joins
  let botAssigned = null;
  const botMember = {
    guild: mockGuild,
    id: 'user_bot_88',
    user: { bot: true },
    roles: { add: async (r) => { botAssigned = r; } }
  };
  await handleAutoRoleMemberJoin(botMember);
  assert.equal(botAssigned, botRoleId, 'Bot should receive bot auto-role');
});

test('Router: Intercepts Sticky, Sticky Roles, and Auto-Role interactions smoothly', async () => {
  const guildId = `g_router_ext_${Date.now()}`;
  let updatedPayload = null;

  const staffMember = {
    permissions: { has: (bit) => bit === PermissionFlagsBits.ManageGuild },
    roles: { cache: new Map() }
  };

  const baseInteraction = {
    guildId,
    guild: { id: guildId, channels: { cache: new Map() } },
    member: staffMember,
    deferUpdate: async () => {},
    update: async (p) => { updatedPayload = p; },
    editReply: async (p) => { updatedPayload = p; },
    reply: async (p) => { updatedPayload = p; }
  };

  // 1. Sticky channel select
  const handledStk = await handleFeedbackVoiceInteraction({
    ...baseInteraction,
    customId: 'fb:stk:chan_sel:0',
    values: ['chan_stk_test_1']
  });
  assert.equal(handledStk, true);

  // 2. Sticky Roles toggle
  const handledSR = await handleFeedbackVoiceInteraction({
    ...baseInteraction,
    customId: 'fb:sr:toggle:0'
  });
  assert.equal(handledSR, true);
  const srSettings = await getGuildSettings(guildId);
  assert.equal(srSettings.sticky_roles_enabled, false);

  // 3. Auto-Role member select
  const handledAR = await handleFeedbackVoiceInteraction({
    ...baseInteraction,
    customId: 'fb:ar:mem_sel:0',
    values: ['role_new_mem_123']
  });
  assert.equal(handledAR, true);
  const arSettings = await getGuildSettings(guildId);
  assert.equal(arSettings.autorole_member_role_id, 'role_new_mem_123');
});

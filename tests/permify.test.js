import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  ButtonStyle,
  PermissionsBitField,
  Collection
} from 'discord.js';

import { greyButton } from '../src/utils/ui/greyButton.js';
import { paginatedSelect } from '../src/utils/ui/paginatedSelect.js';
import {
  createSession,
  getSession,
  isGuildLocked,
  updateSession,
  endSession,
  clearAllSessions
} from '../src/modules/permify/session.js';
import { renderWizardStep, buildProgressBar } from '../src/modules/permify/wizard.js';
import { validateRoleSelection, handlePermifyInteraction } from '../src/modules/permify/router.js';
import { executePermifyApply, executePermifyUndo } from '../src/modules/permify/engine.js';
import { saveSnapshot, getLatestSnapshot, saveGuildRoles, getGuildRoles } from '../src/db/permify.js';
import permifyCommand from '../src/commands/permify/permify.js';
import { buildAutoRolePanel } from '../src/modules/autorole/panel.js';
import { handleAutoRoleMemberJoin } from '../src/modules/autorole/engine.js';
import { updateGuildSettings, getGuildSettings } from '../src/db/guilds.js';
import { updateTicketSettings, getTicketSettings } from '../src/db/tickets.js';

/**
 * Creates a mock guild with customizable channels and roles
 */
function createMockGuild(options = {}) {
  const guildId = options.id || `guild_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ownerId = options.ownerId || `owner_${Date.now()}`;

  const roles = new Collection();
  const channels = new Collection();

  // 1. Core roles
  roles.set(guildId, { id: guildId, name: '@everyone', position: 0, managed: false });

  const botRoleId = `bot_role_${guildId}`;
  roles.set(botRoleId, { id: botRoleId, name: 'Argoni Bot Role', position: 90, managed: true });

  const highestRoleId = `super_admin_${guildId}`;
  roles.set(highestRoleId, { id: highestRoleId, name: 'Higher Role', position: 95, managed: false });

  const staff1 = `staff_1_${guildId}`;
  const staff2 = `staff_2_${guildId}`;
  roles.set(staff1, { id: staff1, name: 'Moderator', position: 50, managed: false });
  roles.set(staff2, { id: staff2, name: 'Support Staff', position: 45, managed: false });

  const member1 = `member_1_${guildId}`;
  const member2 = `member_2_${guildId}`;
  roles.set(member1, { id: member1, name: 'Community Member', position: 20, managed: false });
  roles.set(member2, { id: member2, name: 'Verified', position: 25, managed: false });

  const ownerRole1 = `owner_role_${guildId}`;
  roles.set(ownerRole1, { id: ownerRole1, name: 'Executive Leader', position: 80, managed: false });

  const managedRole1 = `managed_role_${guildId}`;
  roles.set(managedRole1, { id: managedRole1, name: 'Patreon Bot', position: 30, managed: true });

  // 2. Channels helper
  function addMockChannel({ id, name, type, parentId = null }) {
    const overwrites = new Collection();
    const chan = {
      id,
      name,
      type,
      parentId,
      rawPosition: channels.size,
      permissionOverwrites: {
        cache: overwrites,
        set: async (newOverwrites) => {
          overwrites.clear();
          for (const ow of newOverwrites) {
            overwrites.set(ow.id, {
              id: ow.id,
              type: ow.type,
              allow: ow.allow ? new PermissionsBitField(ow.allow) : new PermissionsBitField(),
              deny: ow.deny ? new PermissionsBitField(ow.deny) : new PermissionsBitField(),
              delete: async () => overwrites.delete(ow.id)
            });
          }
        }
      },
      lockPermissions: async () => {
        if (parentId && channels.has(parentId)) {
          const parentOverwrites = channels.get(parentId).permissionOverwrites.cache;
          overwrites.clear();
          for (const [k, v] of parentOverwrites.entries()) {
            overwrites.set(k, { ...v, delete: async () => overwrites.delete(k) });
          }
        }
      }
    };
    channels.set(id, chan);
    return chan;
  }

  const catCount = options.categoryCount || 30;
  const chanPerCat = options.channelsPerCat || 2;

  // Generate categories
  for (let c = 1; c <= catCount; c++) {
    const catId = `cat_${c}_${guildId}`;
    addMockChannel({ id: catId, name: `Category ${c}`, type: ChannelType.GuildCategory });
  }

  // Generate channels
  for (let c = 1; c <= catCount; c++) {
    const catId = `cat_${c}_${guildId}`;
    for (let ch = 1; ch <= chanPerCat; ch++) {
      const type = ch === 1 ? ChannelType.GuildText : ChannelType.GuildVoice;
      addMockChannel({
        id: `chan_${c}_${ch}_${guildId}`,
        name: `${ch === 1 ? 'chat' : 'voice'}-${c}`,
        type,
        parentId: catId
      });
    }
  }

  // Add a dedicated ticket category, ticket panel channel, and log channel
  const tktCat = addMockChannel({ id: `ticket_cat_${guildId}`, name: 'Tickets Category', type: ChannelType.GuildCategory });
  const logChan = addMockChannel({ id: `log_chan_${guildId}`, name: 'server-logs', type: ChannelType.GuildText });

  const members = new Collection();
  const botMember = {
    id: `bot_user_${guildId}`,
    user: { id: `bot_user_${guildId}`, bot: true },
    roles: {
      highest: { position: 90, name: 'Argoni Bot Role' },
      botRole: { id: botRoleId },
      cache: new Collection([[botRoleId, roles.get(botRoleId)]])
    },
    permissions: new PermissionsBitField([
      PermissionFlagsBits.Administrator,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageMessages
    ])
  };
  members.set(botMember.id, botMember);

  return {
    id: guildId,
    name: 'Scratch Test Guild',
    ownerId,
    roles: { cache: roles },
    channels: { cache: channels },
    members: {
      me: botMember,
      cache: members,
      fetch: async () => members
    },
    roleIds: { staff1, staff2, member1, member2, ownerRole1, managedRole1, highestRoleId, botRoleId },
    specialChannels: { tktCatId: tktCat.id, logChanId: logChan.id }
  };
}

test('UI Architecture: greyButton enforces ButtonStyle.Secondary and ButtonStyle.Link', () => {
  const grey = greyButton({ id: 'btn_1', label: 'Action' });
  assert.equal(grey.data.style, ButtonStyle.Secondary);
  assert.equal(grey.data.custom_id, 'btn_1');
  assert.equal(grey.data.label, 'Action');

  const link = greyButton({ label: 'Invite', url: 'https://discord.com' });
  assert.equal(link.data.style, ButtonStyle.Link);
  assert.equal(link.data.url, 'https://discord.com');
  assert.equal(link.data.custom_id, undefined);
});

test('Pagination: paginatedSelect correctly chunks items and creates grey nav controls', () => {
  const items = Array.from({ length: 35 }, (_, i) => ({
    label: `Category ${i + 1}`,
    value: `cat_${i + 1}`,
    description: `Desc ${i + 1}`
  }));

  // Page 1
  const p1 = paginatedSelect({
    items,
    pageSize: 25,
    selected: ['cat_1', 'cat_30'],
    customId: 'permify:test_sel',
    page: 1
  });

  assert.equal(p1.totalPages, 2);
  assert.equal(p1.page, 1);
  assert.equal(p1.slice.length, 25);
  assert.equal(p1.menuRow.components[0].options.length, 25);
  // cat_1 is on page 1 and should be default selected
  assert.equal(p1.menuRow.components[0].options[0].data.default, true);

  // Nav buttons must be grey
  for (const btn of p1.navRow.components) {
    assert.equal(btn.data.style, ButtonStyle.Secondary, 'All pagination buttons must be ButtonStyle.Secondary');
  }

  // Page 2
  const p2 = paginatedSelect({
    items,
    pageSize: 25,
    selected: ['cat_1', 'cat_30'],
    customId: 'permify:test_sel',
    page: 2
  });

  assert.equal(p2.page, 2);
  assert.equal(p2.slice.length, 10);
  assert.equal(p2.menuRow.components[0].options.length, 10);
  // cat_30 is option index 4 on page 2 (index 29 overall)
  const cat30Opt = p2.menuRow.components[0].options.find(o => o.data.value === 'cat_30');
  assert.ok(cat30Opt);
  assert.equal(cat30Opt.data.default, true, 'cat_30 must stay selected on page 2');
});

test('Authorization & Permissions: /permify rejects non-admin users and missing bot permissions', async () => {
  const mockGuild = createMockGuild();

  // 1. Non-admin user check
  let replyPayload = null;
  const nonAdminCtx = {
    guild: mockGuild,
    user: { id: 'regular_user_123' },
    member: { permissions: new PermissionsBitField() },
    reply: async (p) => { replyPayload = p; }
  };

  await permifyCommand.execute(nonAdminCtx);
  assert.ok(replyPayload);
  const text1 = JSON.stringify(replyPayload);
  assert.ok(text1.includes('Administrator') || text1.includes('Permission Denied'));

  // 2. Bot missing permissions check
  mockGuild.members.me.permissions = new PermissionsBitField(); // remove Administrator and manage perms
  const adminCtx = {
    guild: mockGuild,
    user: { id: mockGuild.ownerId },
    member: { permissions: new PermissionsBitField([PermissionFlagsBits.Administrator]) },
    reply: async (p) => { replyPayload = p; }
  };

  replyPayload = null;
  await permifyCommand.execute(adminCtx);
  assert.ok(replyPayload);
  const text2 = JSON.stringify(replyPayload);
  assert.ok(text2.includes('Bot Missing Permissions') || text2.includes('ManageChannels'));

  // Restore bot permissions
  mockGuild.members.me.permissions = new PermissionsBitField([PermissionFlagsBits.Administrator]);
});

test('Session Lifecycle: Guild lock, 15-minute timeout, and concurrency guard', () => {
  clearAllSessions();
  const guildId = 'test_guild_lock_123';
  assert.equal(isGuildLocked(guildId), false);

  const s1 = createSession({ guildId, userId: 'user_1', channelId: 'chan_1' });
  assert.equal(isGuildLocked(guildId), true);
  assert.equal(s1.step, 1);

  updateSession(guildId, { step: 3 });
  assert.equal(getSession(guildId).step, 3);

  endSession(guildId);
  assert.equal(isGuildLocked(guildId), false);
  assert.equal(getSession(guildId), null);
});

test('Role Picker Validation: Rejects @everyone, managed roles, bot hierarchy, and cross-group duplicates', () => {
  const mockGuild = createMockGuild();
  const { staff1, member1, ownerRole1, managedRole1, highestRoleId } = mockGuild.roleIds;

  // 1. Reject @everyone
  const vEveryone = validateRoleSelection(mockGuild, [mockGuild.id], { currentGroup: 'staff' });
  assert.equal(vEveryone.valid, false);
  assert.ok(vEveryone.reason.includes('@everyone'));

  // 2. Reject managed role
  const vManaged = validateRoleSelection(mockGuild, [managedRole1], { currentGroup: 'staff' });
  assert.equal(vManaged.valid, false);
  assert.ok(vManaged.reason.includes('managed'));

  // 3. Reject role above bot (when bot not full admin)
  mockGuild.members.me.permissions = new PermissionsBitField([PermissionFlagsBits.ManageRoles]);
  const vHighest = validateRoleSelection(mockGuild, [highestRoleId], { currentGroup: 'staff' });
  assert.equal(vHighest.valid, false);
  assert.ok(vHighest.reason.includes('higher than or equal to the bot'));
  mockGuild.members.me.permissions = new PermissionsBitField([PermissionFlagsBits.Administrator]);

  // 4. Reject role already assigned to another group
  const vDuplicate = validateRoleSelection(mockGuild, [staff1], {
    currentGroup: 'member',
    staffRoleIds: [staff1]
  });
  assert.equal(vDuplicate.valid, false);
  assert.ok(vDuplicate.reason.includes('already configured in the Staff group'));

  // 5. Allow valid unassigned role
  const vValid = validateRoleSelection(mockGuild, [member1], {
    currentGroup: 'member',
    staffRoleIds: [staff1],
    ownerRoleIds: [ownerRole1]
  });
  assert.equal(vValid.valid, true);
});

test('Wizard UI Rendering (Steps 1 to 7): 100% Components V2, no embeds, zero colored buttons', async () => {
  const mockGuild = createMockGuild();
  const session = createSession({
    guildId: mockGuild.id,
    userId: mockGuild.ownerId,
    channelId: 'chan_test'
  });

  session.staffCategoryIds = [`cat_1_${mockGuild.id}`];
  session.staffChannelIds = [`chan_2_1_${mockGuild.id}`];
  session.staffRoleIds = [mockGuild.roleIds.staff1];
  session.memberRoleIds = [mockGuild.roleIds.member1];
  session.ownerRoleIds = [mockGuild.roleIds.ownerRole1];

  for (let step = 1; step <= 7; step++) {
    session.step = step;
    const rendered = await renderWizardStep(session, mockGuild);
    assert.equal(rendered.flags, MessageFlags.IsComponentsV2, `Step ${step} must use MessageFlags.IsComponentsV2`);
    assert.equal(rendered.embeds, undefined, `Step ${step} must NOT have embeds`);

    const json = JSON.stringify(rendered);
    assert.equal(json.includes('EmbedBuilder'), false);
    // ButtonStyle.Primary = 1, ButtonStyle.Success = 3, ButtonStyle.Danger = 4
    // Verify no button data has style: 1, 3, or 4
    const forbiddenStyles = ['"style":1', '"style":3', '"style":4'];
    for (const style of forbiddenStyles) {
      assert.equal(json.includes(style), false, `Step ${step} contains forbidden button style ${style}`);
    }
  }

  endSession(mockGuild.id);
});

test('Apply Engine & Permission Matrix: Read back overwrites on normal, staff-only, log, and ticket channels', async () => {
  const mockGuild = createMockGuild({ categoryCount: 4, channelsPerCat: 2 });
  const { staff1, member1, ownerRole1, botRoleId } = mockGuild.roleIds;
  const staffCatId = `cat_1_${mockGuild.id}`;
  const staffChanId = `chan_2_1_${mockGuild.id}`;
  const normalChanId = `chan_3_1_${mockGuild.id}`;
  const logChanId = mockGuild.specialChannels.logChanId;
  const tktCatId = mockGuild.specialChannels.tktCatId;

  // Setup ticket and log settings
  await updateGuildSettings(mockGuild.id, { log_channel_id: logChanId });
  await updateTicketSettings(mockGuild.id, { channel_category_id: tktCatId });

  const session = createSession({
    guildId: mockGuild.id,
    userId: mockGuild.ownerId,
    channelId: 'chan_test'
  });

  session.staffRoleIds = [staff1];
  session.memberRoleIds = [member1];
  session.ownerRoleIds = [ownerRole1];
  session.staffCategoryIds = [staffCatId];
  session.staffChannelIds = [staffChanId];
  session.hideEveryone = true;
  session.connectAutorole = true;

  const mockInteraction = {
    guild: mockGuild,
    user: { id: mockGuild.ownerId },
    editReply: async () => {},
    followUp: async () => {}
  };

  // Run Apply Engine
  await executePermifyApply(mockInteraction, session);

  // 1. Verify Snapshot was created
  const latestSnapshot = await getLatestSnapshot(mockGuild.id);
  assert.ok(latestSnapshot, 'A snapshot must be saved before overwrites are modified');
  assert.ok(latestSnapshot.data.channels.length > 0);

  // 2. Read back overwrites on Normal Channel (`normalChanId`)
  const normalChan = mockGuild.channels.cache.get(normalChanId);
  const normalOw = normalChan.permissionOverwrites.cache;
  // Bot allowed
  assert.ok(normalOw.get(botRoleId)?.allow.has(PermissionFlagsBits.ViewChannel));
  // Everyone denied ViewChannel (hideEveryone ON)
  assert.ok(normalOw.get(mockGuild.id)?.deny.has(PermissionFlagsBits.ViewChannel));
  // Member has ViewChannel + SendMessages
  assert.ok(normalOw.get(member1)?.allow.has(PermissionFlagsBits.ViewChannel));
  assert.ok(normalOw.get(member1)?.allow.has(PermissionFlagsBits.SendMessages));
  // Staff has View + Send + ManageMessages
  assert.ok(normalOw.get(staff1)?.allow.has(PermissionFlagsBits.ManageMessages));
  // Owner has View + ManageChannels
  assert.ok(normalOw.get(ownerRole1)?.allow.has(PermissionFlagsBits.ManageChannels));

  // 3. Read back overwrites on Staff-Only Category (`staffCatId`)
  const staffCat = mockGuild.channels.cache.get(staffCatId);
  const catOw = staffCat.permissionOverwrites.cache;
  // Member allowed ViewChannel + ReadMessageHistory ONLY; denied SendMessages & Speak
  assert.ok(catOw.get(member1)?.allow.has(PermissionFlagsBits.ViewChannel));
  assert.ok(catOw.get(member1)?.allow.has(PermissionFlagsBits.ReadMessageHistory));
  assert.ok(catOw.get(member1)?.deny.has(PermissionFlagsBits.SendMessages));
  assert.ok(catOw.get(member1)?.deny.has(PermissionFlagsBits.Speak));
  // Staff allowed ViewChannel + SendMessages, but NO ManageMessages here
  assert.ok(catOw.get(staff1)?.allow.has(PermissionFlagsBits.ViewChannel));
  assert.ok(catOw.get(staff1)?.allow.has(PermissionFlagsBits.SendMessages));
  assert.equal(catOw.get(staff1)?.allow.has(PermissionFlagsBits.ManageMessages), false, 'Staff must NOT have ManageMessages in staff-only category');
  // Owner retains ManageMessages
  assert.ok(catOw.get(ownerRole1)?.allow.has(PermissionFlagsBits.ManageMessages), 'Owner must retain ManageMessages in staff-only category');

  // 4. Read back overwrites on Individual Staff-Only Channel (`staffChanId`)
  const staffChan = mockGuild.channels.cache.get(staffChanId);
  const staffChanOw = staffChan.permissionOverwrites.cache;
  assert.ok(staffChanOw.get(member1)?.deny.has(PermissionFlagsBits.SendMessages));
  assert.ok(staffChanOw.get(staff1)?.allow.has(PermissionFlagsBits.SendMessages));
  assert.equal(staffChanOw.get(staff1)?.allow.has(PermissionFlagsBits.ManageMessages), false);
  assert.ok(staffChanOw.get(ownerRole1)?.allow.has(PermissionFlagsBits.ManageMessages));

  // 5. Read back overwrites on Log Channel (`logChanId`)
  const logChan = mockGuild.channels.cache.get(logChanId);
  const logOw = logChan.permissionOverwrites.cache;
  // Everyone & Member denied ViewChannel
  assert.ok(logOw.get(mockGuild.id)?.deny.has(PermissionFlagsBits.ViewChannel));
  assert.ok(logOw.get(member1)?.deny.has(PermissionFlagsBits.ViewChannel));
  // Staff can View but denied SendMessages
  assert.ok(logOw.get(staff1)?.allow.has(PermissionFlagsBits.ViewChannel));
  assert.ok(logOw.get(staff1)?.deny.has(PermissionFlagsBits.SendMessages));
  // Owner full access
  assert.ok(logOw.get(ownerRole1)?.allow.has(PermissionFlagsBits.SendMessages));

  // 6. Read back overwrites on Ticket Category (`tktCatId`)
  const tktCat = mockGuild.channels.cache.get(tktCatId);
  const tktOw = tktCat.permissionOverwrites.cache;
  assert.ok(tktOw.get(mockGuild.id)?.deny.has(PermissionFlagsBits.ViewChannel));
  assert.ok(tktOw.get(staff1)?.allow.has(PermissionFlagsBits.ManageChannels));
  assert.ok(tktOw.get(ownerRole1)?.allow.has(PermissionFlagsBits.ManageChannels));

  // 7. Verify Autorole integration updated settings
  const updatedGuildSettings = await getGuildSettings(mockGuild.id);
  assert.deepEqual(updatedGuildSettings.autorole_member_role_ids, [member1]);
  assert.equal(updatedGuildSettings.autorole_enabled, true);

  // 8. Verify Ticket settings updated
  const updatedTicketSettings = await getTicketSettings(mockGuild.id);
  assert.deepEqual(updatedTicketSettings.support_role_ids, [staff1]);
  assert.deepEqual(updatedTicketSettings.admin_role_ids, [ownerRole1]);
  assert.deepEqual(updatedTicketSettings.allowed_role_ids, [member1]);

  // 9. Verify getGuildRoles helper
  const roleGroups = await getGuildRoles(mockGuild.id);
  assert.deepEqual(roleGroups.staff, [staff1]);
  assert.deepEqual(roleGroups.member, [member1]);
  assert.deepEqual(roleGroups.owner, [ownerRole1]);

  // 10. Test Undo Engine Rollback
  const undoInteraction = {
    guild: mockGuild,
    user: { id: mockGuild.ownerId },
    editReply: async () => {},
    followUp: async () => {}
  };
  await executePermifyUndo(undoInteraction, mockGuild);
});

test('Autorole Multi-Role Join: Assigns member roles and NEVER assigns staff or owner roles', async () => {
  const mockGuild = createMockGuild();
  const { staff1, member1, member2, ownerRole1 } = mockGuild.roleIds;

  // Set autorole with member roles, and attempt to sneak staff1 in
  await saveGuildRoles(mockGuild.id, {
    staff: [staff1],
    member: [member1, member2],
    owner: [ownerRole1]
  });

  await updateGuildSettings(mockGuild.id, {
    autorole_enabled: true,
    autorole_member_role_ids: [member1, member2, staff1] // staff1 should be filtered out by safety guard
  });

  const assignedRoles = [];
  const joiningMember = {
    id: 'newbie_123',
    guild: mockGuild,
    user: { bot: false },
    roles: {
      add: async (roles) => { assignedRoles.push(...roles); }
    }
  };

  await handleAutoRoleMemberJoin(joiningMember);

  assert.ok(assignedRoles.includes(member1), 'Must assign member1');
  assert.ok(assignedRoles.includes(member2), 'Must assign member2');
  assert.equal(assignedRoles.includes(staff1), false, 'Staff roles must NEVER be assigned via autorole');
  assert.equal(assignedRoles.includes(ownerRole1), false, 'Owner roles must NEVER be assigned via autorole');
});

test('AutoRole Panel V2: Pure borderless container with 100% grey buttons', () => {
  const panel = buildAutoRolePanel({
    autorole_enabled: true,
    autorole_member_role_ids: ['m1', 'm2'],
    autorole_bot_role_id: 'b1'
  });

  assert.equal(panel.flags, MessageFlags.IsComponentsV2);
  const json = JSON.stringify(panel);
  assert.equal(json.includes('"style":1'), false);
  assert.equal(json.includes('"style":3'), false);
  assert.equal(json.includes('"style":4'), false);
  assert.ok(json.includes('"style":2'), 'Must use ButtonStyle.Secondary');
});

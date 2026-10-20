import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, Collection, PermissionFlagsBits } from 'discord.js';
import { ticketDb } from '../src/db/tickets.js';
import { ensureDefaultCategories, checkCategoryAccess, checkStaffAccess } from '../src/modules/tickets/categories.js';
import { buildPublishedPanelCard, renderPanelManagerDashboard } from '../src/modules/tickets/panel.js';
import { buildTicketControlCard } from '../src/modules/tickets/controls.js';
import { buildTicketLogCard } from '../src/modules/tickets/logs.js';
import { renderHtmlTranscript } from '../src/modules/tickets/transcript.js';
import { sendRatingPrompt, buildRatingFeedbackModal } from '../src/modules/tickets/ratings.js';
import { renderTicketSettingsDashboard } from '../src/modules/tickets/settings.js';
import { handleTicketInteraction } from '../src/modules/tickets/router.js';
import ticketCommand from '../src/commands/tickets/ticket.js';
import claimCommand from '../src/commands/tickets/claim.js';
import closeCommand from '../src/commands/tickets/close.js';
import reopenCommand from '../src/commands/tickets/reopen.js';

test('Ticket Database: settings and caching work with default values', async () => {
  const guildId = 'test_guild_tkt_1';
  const settings = await ticketDb.getSettings(guildId);
  assert.ok(settings, 'Settings should return an object');
  assert.equal(settings.guild_id, guildId);
  assert.equal(settings.enabled, true);
  assert.equal(settings.max_open_tickets_per_user, 3);

  // Update settings
  const updated = await ticketDb.updateSettings(guildId, {
    max_open_tickets_per_user: 5,
    autoclose_hours: 48
  });
  assert.equal(updated.max_open_tickets_per_user, 5);
  assert.equal(updated.autoclose_hours, 48);

  const cached = await ticketDb.getSettings(guildId);
  assert.equal(cached.max_open_tickets_per_user, 5);
});

test('Ticket Database: sequential ticket numbers increment atomically per guild', async () => {
  const guildId = 'test_guild_seq_1';
  const num1 = await ticketDb.getNextTicketNumber(guildId);
  const num2 = await ticketDb.getNextTicketNumber(guildId);
  const num3 = await ticketDb.getNextTicketNumber(guildId);

  assert.equal(num1, 1);
  assert.equal(num2, 2);
  assert.equal(num3, 3);
});

test('Ticket Database: categories and default seeding', async () => {
  const guildId = 'test_guild_cat_1';
  const defaults = await ensureDefaultCategories(guildId);
  assert.ok(defaults.length >= 3, 'Default categories should seed General, Billing, and Report');

  const categories = await ticketDb.getCategories(guildId);
  assert.equal(categories.length, defaults.length);

  // Create custom category
  const customCat = await ticketDb.saveCategory({
    guild_id: guildId,
    name: 'Partnerships',
    emoji: '🤝',
    description: 'Server partnership requests',
    position: 3
  });
  assert.ok(customCat.id);
  assert.equal(customCat.name, 'Partnerships');

  const afterAdd = await ticketDb.getCategories(guildId);
  assert.equal(afterAdd.length, defaults.length + 1);

  // Delete category
  await ticketDb.deleteCategory(customCat.id);
  const afterDel = await ticketDb.getCategories(guildId);
  assert.equal(afterDel.length, defaults.length);
});

test('Ticket Database: panels, blacklist, macros, and notes CRUD', async () => {
  const guildId = 'test_guild_crud_1';

  // Panels
  const panel = await ticketDb.savePanel({
    guild_id: guildId,
    channel_id: '111222333',
    title: 'Argoni Support Hub',
    description: 'Select an option to get in touch with our team.',
    style: 'buttons'
  });
  assert.ok(panel.id);
  const panels = await ticketDb.getPanels(guildId);
  assert.equal(panels.length, 1);
  assert.equal(panels[0].title, 'Argoni Support Hub');

  // Blacklist
  await ticketDb.addToBlacklist({
    guild_id: guildId,
    target_id: 'bad_user_99',
    target_type: 'user',
    reason: 'Spamming tickets',
    added_by: 'staff_1'
  });
  let bl = await ticketDb.getBlacklist(guildId);
  assert.equal(bl.length, 1);
  assert.equal(bl[0].target_id, 'bad_user_99');

  await ticketDb.removeFromBlacklist(guildId, 'bad_user_99');
  bl = await ticketDb.getBlacklist(guildId);
  assert.equal(bl.length, 0);

  // Macros
  await ticketDb.saveMacro({
    guild_id: guildId,
    name: 'greeting',
    content: 'Hello! Thank you for reaching out to Argoni Support. A team member will assist you shortly.',
    created_by: 'staff_1'
  });
  const macros = await ticketDb.getMacros(guildId);
  assert.equal(macros.length, 1);
  assert.equal(macros[0].name, 'greeting');

  await ticketDb.deleteMacro(guildId, 'greeting');
  const macrosAfter = await ticketDb.getMacros(guildId);
  assert.equal(macrosAfter.length, 0);

  // Notes
  const note = await ticketDb.addStaffNote(guildId, 'tkt_mock_1', 'staff_1', 'Note content for internal staff');
  assert.ok(note);
  const notes = await ticketDb.getStaffNotes(guildId, 'tkt_mock_1');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].content, 'Note content for internal staff');
});

test('Ticket Access: role requirement and blocking logic', () => {
  const memberWithRole = {
    roles: { cache: new Collection([['role_vip', { id: 'role_vip' }]]) }
  };
  const memberBlocked = {
    roles: { cache: new Collection([['role_blocked', { id: 'role_blocked' }]]) }
  };

  const restrictedCat = {
    name: 'VIP Support',
    required_role_ids: ['role_vip'],
    blocked_role_ids: ['role_blocked']
  };

  assert.equal(checkCategoryAccess(memberWithRole, restrictedCat).allowed, true);
  assert.equal(checkCategoryAccess(memberBlocked, restrictedCat).allowed, false);
});

test('Ticket UI: Published panel renders strictly with Components V2 container and no accent color', async () => {
  const panel = {
    id: 'p1',
    title: 'Customer Help Desk',
    description: 'Welcome! Choose a department below to create a private support ticket.',
    style: 'buttons'
  };
  const categories = [
    { id: 'c1', name: 'Billing', emoji: '💳', description: 'Store orders' },
    { id: 'c2', name: 'General', emoji: '🎫', description: 'Server help' }
  ];

  const payload = await buildPublishedPanelCard({ panel, categories });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);

  const containerJson = payload.components[0].toJSON();
  assert.ok(containerJson.components.length >= 3);
  assert.equal(containerJson.accent_color, undefined, 'Containers must not have accent color');
});

test('Ticket UI: In-ticket control card renders with owner, question answers and control buttons', async () => {
  const mockTicket = {
    id: 'tkt_ui_1',
    ticket_number: 42,
    owner_id: 'user_owner_1',
    owner_username: 'Adhi',
    category_id: 'cat_gen',
    category_name: 'General Support',
    priority: 'high',
    status: 'open',
    claimed_by: null,
    created_at: new Date().toISOString(),
    question_answers: {
      'What issue are you facing?': 'Cannot access role channel',
      'Minecraft Username': 'AdhiPlays'
    }
  };

  const mockGuild = {
    id: 'guild_mock_1',
    roles: { cache: new Collection() }
  };

  const card = await buildTicketControlCard({ ticket: mockTicket, guild: mockGuild });
  assert.equal(card.flags, MessageFlags.IsComponentsV2);
  assert.equal(card.components.length, 1);

  const json = card.components[0].toJSON();
  assert.equal(json.accent_color, undefined);
  // Verify ActionRows exist for in-ticket controls
  const rows = json.components.filter(c => c.type === 1);
  assert.ok(rows.length >= 2, 'Should have control button row and tools select row');
});

test('Ticket UI: Audit log card renders formatted event without embed or color strip', () => {
  const mockTicket = {
    id: 'tkt_log_1',
    ticket_number: 101,
    owner_id: 'owner_99',
    category_name: 'Billing Support',
    priority: 'normal'
  };

  const logPayload = buildTicketLogCard({
    event: 'ticket_created',
    ticket: mockTicket,
    staff: null,
    details: [
      { label: 'Channel', value: '<#123456789>' },
      { label: 'Created By', value: '<@owner_99>' }
    ]
  });

  assert.equal(logPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(logPayload.components.length, 1);
  const json = logPayload.components[0].toJSON();
  assert.equal(json.accent_color, undefined);
});

test('Ticket Transcripts: HTML transcript renderer produces clean dark-themed HTML', () => {
  const mockMessages = [
    {
      id: 'm1',
      author: { id: 'u1', username: 'TicketOwner', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/1/a.png' },
      content: 'Hello, I need help with my server rank.',
      createdAt: new Date(),
      attachments: new Collection()
    },
    {
      id: 'm2',
      author: { id: 'u2', username: 'SupportStaff', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/avatars/2/b.png' },
      content: 'Sure! What is your transaction ID?',
      createdAt: new Date(),
      attachments: new Collection()
    }
  ];

  const mockTicket = {
    ticket_number: 10,
    owner_username: 'TicketOwner',
    category_name: 'Billing'
  };

  const html = renderHtmlTranscript({
    messages: mockMessages,
    ticket: mockTicket,
    guildName: 'Test Server',
    channelName: 'ticket-0010'
  });

  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('ticket-0010'));
  assert.ok(html.includes('Hello, I need help with my server rank.'));
  assert.ok(html.includes('Sure! What is your transaction ID?'));
});

test('Ticket Ratings: post-close rating card and modal builder', async () => {
  const mockTicket = {
    id: 'tkt_rate_1',
    ticket_number: 5,
    category_name: 'Support'
  };
  const mockGuild = { id: 'guild_r1', name: 'Test Guild' };

  const prompt = await sendRatingPrompt(mockGuild, mockTicket);
  assert.equal(prompt.flags, MessageFlags.IsComponentsV2);
  assert.equal(prompt.components.length, 1);

  const modal = buildRatingFeedbackModal('guild_r1', 'tkt_rate_1', '5');
  assert.ok(modal);
  assert.equal(modal.data.title, 'Rate Support (5 Stars)');
  assert.equal(modal.data.custom_id, 'tkt:rate_modal:guild_r1:tkt_rate_1:5');
});

test('Ticket Settings Dashboard: renders all tabs strictly with Components V2', async () => {
  const mockGuild = {
    id: 'guild_dash_1',
    name: 'Dashboard Guild',
    roles: { cache: new Collection() },
    channels: { cache: new Collection() }
  };

  const tabs = ['general', 'panels', 'categories', 'staff', 'channels', 'autoclose', 'ratings', 'blacklist', 'messages'];
  for (const tab of tabs) {
    const payload = await renderTicketSettingsDashboard({ guild: mockGuild, activeTab: tab });
    assert.equal(payload.flags, MessageFlags.IsComponentsV2, `Tab ${tab} must return MessageFlags.IsComponentsV2`);
    assert.equal(payload.components.length, 1);
    assert.equal(payload.components[0].toJSON().accent_color, undefined);
  }
});

test('Ticket Commands: definitions, subcommands, and permissions', () => {
  assert.equal(ticketCommand.name, 'ticket');
  assert.equal(ticketCommand.category, 'tickets');
  assert.ok(ticketCommand.subcommands.length >= 10, 'Must have at least 10 subcommands');

  const subNames = ticketCommand.subcommands.map(s => s.name);
  assert.ok(subNames.includes('panel'));
  assert.ok(subNames.includes('settings'));
  assert.ok(subNames.includes('stats'));
  assert.ok(subNames.includes('list'));
  assert.ok(subNames.includes('info'));
  assert.ok(subNames.includes('claim'));
  assert.ok(subNames.includes('close'));
  assert.ok(subNames.includes('reopen'));
  assert.ok(subNames.includes('blacklist'));
  assert.ok(subNames.includes('macro'));
  assert.ok(subNames.includes('reviews'));

  // Shorthand commands
  assert.equal(claimCommand.name, 'claim');
  assert.equal(closeCommand.name, 'close');
  assert.equal(reopenCommand.name, 'reopen');
});

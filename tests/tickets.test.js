import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, Collection, PermissionFlagsBits } from 'discord.js';
import { ticketDb } from '../src/db/tickets.js';
import { ensureDefaultCategories, checkCategoryAccess, checkStaffAccess } from '../src/modules/tickets/categories.js';
import {
  buildPublishedPanelCard,
  renderPanelManagerDashboard,
  renderPanelImageConfigCard,
  handleTicketImageDrop,
  pendingPanelUploads
} from '../src/modules/tickets/panel.js';
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
  const guildId = `tkt_tst_${Date.now()}_1`;
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
  const guildId = `seq_tst_${Date.now()}_2`;
  const num1 = await ticketDb.getNextTicketNumber(guildId);
  const num2 = await ticketDb.getNextTicketNumber(guildId);
  const num3 = await ticketDb.getNextTicketNumber(guildId);

  assert.equal(num1, 1);
  assert.equal(num2, 2);
  assert.equal(num3, 3);
});

test('Ticket Database: categories and default seeding', async () => {
  const guildId = `cat_tst_${Date.now()}_3`;
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
  const guildId = `crud_tst_${Date.now()}_4`;

  // Panels
  const panel = await ticketDb.savePanel({
    guild_id: guildId,
    channel_id: '111222333',
    title: 'AVA Support Hub',
    description: 'Select an option to get in touch with our team.',
    style: 'buttons'
  });
  assert.ok(panel.id);
  const panels = await ticketDb.getPanels(guildId);
  assert.equal(panels.length, 1);
  assert.equal(panels[0].title, 'AVA Support Hub');

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
    content: 'Hello! Thank you for reaching out to AVA Support. A team member will assist you shortly.',
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

test('Ticket UI: Banner, thumbnail, and dropdown select menus render properly in panels and control cards', async () => {
  const panel = {
    id: 'p_img_1',
    title: 'Support Hub',
    description: 'Select a department below',
    style: 'select',
    banner_url: 'https://images.unsplash.com/photo-banner.jpg',
    thumbnail_url: 'https://images.unsplash.com/photo-thumb.jpg'
  };

  const categories = [
    { id: 'cat_billing', name: 'Billing', emoji: '💳', description: 'Store orders' },
    { id: 'cat_tech', name: 'Technical Support', emoji: '🛠️', description: 'Server bugs' }
  ];

  // 1. Published Panel with Banner, Thumbnail, and Select Dropdown
  const panelPayload = await buildPublishedPanelCard({ panel, categories });
  assert.equal(panelPayload.flags, MessageFlags.IsComponentsV2);
  const panelJson = panelPayload.components[0].toJSON();

  // Ensure MediaGallery exists for banner
  const mediaGallery = panelJson.components.find(c => c.type === 12);
  assert.ok(mediaGallery, 'Panel should render MediaGallery for banner_url');
  assert.equal(mediaGallery.items[0].description, undefined);

  // Ensure Section with Thumbnail exists for thumbnail
  const sectionWithThumb = panelJson.components.find(c => c.type === 9 && c.accessory?.type === 11);
  assert.ok(sectionWithThumb, 'Panel should render Section with Thumbnail accessory for thumbnail_url');

  // Ensure Select Menu ActionRow exists
  const selectRow = panelJson.components.find(c => c.type === 1 && c.components?.[0]?.type === 3);
  assert.ok(selectRow, 'Panel should render StringSelectMenu row when style is select');
  assert.equal(selectRow.components[0].custom_id, `tkt:panel:sel:${panel.id}`);
  assert.equal(selectRow.components[0].options.length, 2);

  // 2. In-Ticket Control Card with Banner and Thumbnail
  const ticket = {
    id: 'tkt_img_1',
    ticket_number: 77,
    owner_id: 'user_123',
    owner_username: 'Tester',
    category_name: 'Billing Support',
    priority: 'urgent',
    status: 'open',
    claimed_by: null,
    created_at: new Date().toISOString(),
    banner_url: 'https://images.unsplash.com/ticket-banner.jpg',
    thumbnail_url: 'https://images.unsplash.com/ticket-thumb.jpg'
  };

  const controlCard = buildTicketControlCard({ ticket });
  assert.equal(controlCard.flags, MessageFlags.IsComponentsV2);
  const controlJson = controlCard.components[0].toJSON();

  const ctlMedia = controlJson.components.find(c => c.type === 12);
  assert.ok(ctlMedia, 'Control card should render MediaGallery for banner_url');

  const ctlThumb = controlJson.components.find(c => c.type === 9 && c.accessory?.type === 11);
  assert.ok(ctlThumb, 'Control card should render Section with Thumbnail accessory for thumbnail_url');

  // Verify management tools select menu
  const toolsMenuRow = controlJson.components.find(c => c.type === 1 && c.components?.[0]?.custom_id?.startsWith('tkt:ctl:tools_sel'));
  assert.ok(toolsMenuRow, 'Control card should contain tools select menu');
});

test('Ticket UI: Panel image settings card renders with Components V2 and drag & drop action buttons', async () => {
  const guild = { id: 'guild_img_test_1', name: 'Test Server' };
  const panel = await ticketDb.savePanel({
    guild_id: guild.id,
    title: 'Support Desk',
    description: 'Help panel description',
    banner_url: 'https://cdn.example.com/banner.png',
    thumbnail_url: 'https://cdn.example.com/thumb.png'
  });

  const payload = await renderPanelImageConfigCard(guild, panel.id);
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);

  const json = payload.components[0].toJSON();
  assert.equal(json.accent_color, undefined, 'Must not have accent color');

  // Verify MediaGallery for banner
  const mediaGallery = json.components.find(c => c.type === 12);
  assert.ok(mediaGallery, 'Should render banner in MediaGallery');

  // Verify Section with Thumbnail
  const thumbSection = json.components.find(c => c.type === 9 && c.accessory?.type === 11);
  assert.ok(thumbSection, 'Should render thumbnail accessory in Section');

  // Verify Drag & Drop Action buttons
  const rows = json.components.filter(c => c.type === 1);
  assert.ok(rows.length >= 2, 'Should have 2 action rows');

  const armBannerBtn = rows[0].components.find(b => b.custom_id === `tkt:mgr:arm_drop:${panel.id}:banner`);
  const armThumbBtn = rows[0].components.find(b => b.custom_id === `tkt:mgr:arm_drop:${panel.id}:thumbnail`);
  const modalBtn = rows[0].components.find(b => b.custom_id === `tkt:mgr:img_modal_open:${panel.id}`);
  const clearBtn = rows[1].components.find(b => b.custom_id === `tkt:mgr:clear_images:${panel.id}`);
  const backBtn = rows[1].components.find(b => b.custom_id === `tkt:mgr:back_dash:${panel.id}`);

  assert.ok(armBannerBtn, 'Should have Upload Banner (Drag & Drop) button');
  assert.ok(armThumbBtn, 'Should have Upload Thumbnail (Drag & Drop) button');
  assert.ok(modalBtn, 'Should have Enter URLs button');
  assert.ok(clearBtn, 'Should have Clear Images button');
  assert.ok(backBtn, 'Should have Back to Dashboard button');
});

test('Ticket Drag & Drop: handleTicketImageDrop handles user file drop and updates panel banner/thumbnail', async () => {
  const guildId = `guild_drop_${Date.now()}`;
  const channelId = `chan_drop_${Date.now()}`;
  const userId = `user_drop_${Date.now()}`;

  const panel = await ticketDb.savePanel({
    guild_id: guildId,
    title: 'Drop Test Panel',
    banner_url: null,
    thumbnail_url: null
  });

  // 1. Arm drag and drop for banner
  pendingPanelUploads.set(userId, {
    panelId: panel.id,
    type: 'banner',
    channelId,
    expiresAt: Date.now() + 60000
  });

  let deleted = false;
  let sentCard = null;

  const mockMessage = {
    author: { id: userId, bot: false },
    guild: { id: guildId, channels: { cache: new Collection() } },
    channel: {
      id: channelId,
      send: async (payload) => {
        sentCard = payload;
        return { id: 'sent_1' };
      }
    },
    attachments: new Collection([
      ['att_1', {
        name: 'header_banner.png',
        contentType: 'image/png',
        url: 'https://cdn.discordapp.com/attachments/header_banner.png'
      }]
    ]),
    delete: async () => { deleted = true; }
  };

  const handled = await handleTicketImageDrop(mockMessage);
  assert.equal(handled, true);
  assert.equal(deleted, true, 'User raw upload message should be cleaned up');
  assert.ok(sentCard, 'Should send confirmation card');
  assert.equal(sentCard.flags, MessageFlags.IsComponentsV2);

  // Verify panel record updated in DB
  const refreshedPanel = await ticketDb.getPanel(panel.id);
  assert.equal(refreshedPanel.banner_url, 'https://cdn.discordapp.com/attachments/header_banner.png');
  assert.equal(pendingPanelUploads.has(userId), false, 'Pending upload should be cleared');
});

test('Ticket Activity: updateTicketLastMessage updates timestamp and clears inactivity warning', async () => {
  const guildId = `act_guild_${Date.now()}`;
  const channelId = `act_chan_${Date.now()}`;

  const ticket = await ticketDb.createTicket({
    guildId,
    channelId,
    ticketNumber: 88,
    ownerId: 'owner_act',
    ownerUsername: 'ActOwner'
  });

  // Set stale activity and warning
  await ticketDb.updateTicket(ticket.id, {
    last_message_at: new Date(Date.now() - 36000000).toISOString(),
    warning_sent_at: new Date(Date.now() - 3600000).toISOString()
  });

  const updated = await ticketDb.updateTicketLastMessage(guildId, channelId);
  assert.ok(updated);
  assert.equal(updated.warning_sent_at, null);
  assert.ok(new Date(updated.last_message_at).getTime() > Date.now() - 5000);
});


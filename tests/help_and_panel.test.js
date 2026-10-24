import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, Collection } from 'discord.js';
import {
  buildHelpMenuPayload,
  buildCategoryHelpPayload,
  CATEGORY_DEFINITIONS
} from '../src/modules/help/panel.js';
import {
  buildDashboardPayload,
  renderModulePanelById,
  MODULE_ITEMS
} from '../src/modules/panel/index.js';
import helpCommand from '../src/commands/help/help.js';
import panelCommand from '../src/commands/panel/panel.js';
import logsCommand from '../src/commands/settings/logs.js';

test('Help Menu: builds valid Components V2 container with links and two category select menus', () => {
  const dummyUser = { id: '12345', username: 'TestUser' };
  const dummyClient = { user: { id: '99999', username: 'AVA' } };
  const payload = buildHelpMenuPayload({
    user: dummyUser,
    client: dummyClient,
    prefix: '!',
    sessionId: 'test_session_1'
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);

  const containerJson = payload.components[0].toJSON();
  assert.ok(containerJson.components.length >= 4);

  // Verify two select menus exist in action rows
  const selectMenus = containerJson.components
    .filter(c => c.type === 1) // ActionRow
    .flatMap(r => r.components.filter(comp => comp.type === 3)); // StringSelect

  assert.equal(selectMenus.length, 2, 'Must have exactly two select menus: Main & Extra categories');
  assert.ok(selectMenus[0].custom_id.includes('sel_main'));
  assert.ok(selectMenus[1].custom_id.includes('sel_extra'));
});

test('Help Category: renders category command list with back and close buttons', () => {
  const catPayload = buildCategoryHelpPayload({
    categoryId: 'automod',
    prefix: '!',
    sessionId: 'test_session_2',
    page: 1
  });

  assert.equal(catPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(catPayload.components.length, 1);

  const containerJson = catPayload.components[0].toJSON();
  const buttons = containerJson.components
    .filter(c => c.type === 1)
    .flatMap(r => r.components.filter(comp => comp.type === 2));

  assert.ok(buttons.some(b => b.custom_id.includes('back')), 'Must have Back button');
  assert.ok(buttons.some(b => b.custom_id.includes('close')), 'Must have Close button');
});

test('Dashboard: renders main panel dashboard with all modules', async () => {
  const dummyGuild = {
    id: 'guild_123',
    name: 'Mock Guild',
    ownerId: 'owner_456',
    memberCount: 50
  };
  const dummyUser = { id: 'owner_456', username: 'Owner' };
  const dummyClient = { user: { id: '99999', username: 'AVA' } };

  const dashPayload = await buildDashboardPayload({
    guild: dummyGuild,
    user: dummyUser,
    client: dummyClient,
    sessionId: 'dash_session_1'
  });

  assert.equal(dashPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(dashPayload.components.length, 1);

  const json = dashPayload.components[0].toJSON();
  const selectMenu = json.components
    .filter(c => c.type === 1)
    .flatMap(r => r.components.filter(comp => comp.type === 3))[0];

  assert.ok(selectMenu, 'Dashboard must have module selector');
  assert.ok(selectMenu.options.length >= 10, 'Must list all 10+ modules');
});

test('renderModulePanelById: resolves module IDs to valid Components V2 panels', async () => {
  const dummyGuild = {
    id: 'guild_123',
    name: 'Mock Guild',
    ownerId: 'owner_456',
    iconURL: () => null,
    roles: { cache: new Collection() },
    channels: { cache: new Collection() }
  };

  const modulesToTest = ['automod', 'autorole', 'boosts', 'sticky', 'stickyroles', 'chatlog', 'logs'];
  for (const modId of modulesToTest) {
    const res = await renderModulePanelById(modId, dummyGuild);
    assert.ok(res, `Module ${modId} must return a payload`);
    assert.equal(res.flags, MessageFlags.IsComponentsV2, `Module ${modId} must use IsComponentsV2 flag`);
    assert.equal(res.components.length, 1, `Module ${modId} must contain single ContainerBuilder`);
  }
});

test('Commands: help, panel, and logs definitions are properly structured', () => {
  assert.equal(helpCommand.name, 'help');
  assert.ok(helpCommand.aliases.includes('commands'));
  assert.equal(panelCommand.name, 'panel');
  assert.ok(panelCommand.aliases.includes('dashboard'));
  assert.equal(logsCommand.name, 'logs');
  assert.ok(logsCommand.aliases.includes('log'));
});

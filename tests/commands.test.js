import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCommands } from '../src/structures/loader.js';
import { registry } from '../src/structures/CommandRegistry.js';

test('loadCommands registers core panel commands and user-facing suggest/feedback commands', async () => {
  const count = await loadCommands();
  assert.ok(count >= 15, `Expected at least 15 commands loaded, got ${count}`);

  const helpCmd = registry.resolve('help');
  assert.ok(helpCmd, 'help command should be registered');

  const panelCmd = registry.resolve('panel');
  assert.ok(panelCmd, 'panel command should be registered');

  const logsCmd = registry.resolve('logs');
  assert.ok(logsCmd, 'logs command should be registered');

  const backupCmd = registry.resolve('backup');
  assert.ok(backupCmd, 'backup command should be registered');
  assert.equal(backupCmd.category, 'backup');

  const settingCmd = registry.resolve('setting');
  assert.ok(settingCmd, 'setting command should be registered');
  assert.equal(settingCmd.category, 'settings');

  const settingsAlias = registry.resolve('settings');
  assert.ok(settingsAlias, 'settings alias should resolve to setting command');

  const botProfileCmd = registry.resolve('botprofile');
  assert.ok(botProfileCmd, 'botprofile command should be registered');
  assert.equal(botProfileCmd.category, 'settings');
  const botIdAlias = registry.resolve('botidentity');
  assert.ok(botIdAlias, 'botidentity alias should resolve to botprofile');
  const setBotAlias = registry.resolve('setbot');
  assert.ok(setBotAlias, 'setbot alias should resolve to botprofile');
  const serverProfileAlias = registry.resolve('serverprofile');
  assert.ok(serverProfileAlias, 'serverprofile alias should resolve to botprofile');

  const componentBuilderCmd = registry.resolve('componentbuilder');
  assert.ok(componentBuilderCmd, 'componentbuilder command should be registered');
  assert.equal(componentBuilderCmd.category, 'settings');
  const cardBuilderAlias = registry.resolve('cardbuilder');
  assert.ok(cardBuilderAlias, 'cardbuilder alias should resolve to componentbuilder');
  const buildComponentAlias = registry.resolve('buildcomponent');
  assert.ok(buildComponentAlias, 'buildcomponent alias should resolve to componentbuilder');

  const automodCmd = registry.resolve('automod');
  assert.ok(automodCmd, 'automod command should be registered');
  assert.equal(automodCmd.category, 'settings');
  const amAlias = registry.resolve('am');
  assert.ok(amAlias, 'am alias should resolve to automod');
  const autoModerationAlias = registry.resolve('automoderation');
  assert.ok(autoModerationAlias, 'automoderation alias should resolve to automod');

  const boostsCmd = registry.resolve('boosts');
  assert.ok(boostsCmd, 'boosts command should be registered');
  assert.equal(boostsCmd.category, 'settings');
  const boostTrackAlias = registry.resolve('boosttrack');
  assert.ok(boostTrackAlias, 'boosttrack alias should resolve to boosts');
  const boosterAlias = registry.resolve('booster');
  assert.ok(boosterAlias, 'booster alias should resolve to boosts');

  const chatlogCmd = registry.resolve('chatlog');
  assert.ok(chatlogCmd, 'chatlog command should be registered');
  assert.equal(chatlogCmd.category, 'chatlog');

  const suggestCmd = registry.resolve('suggest');
  assert.ok(suggestCmd, 'suggest command should be registered');
  assert.equal(suggestCmd.category, 'suggestions');

  const feedbackCmd = registry.resolve('feedback');
  assert.ok(feedbackCmd, 'feedback command should be registered');
  assert.equal(feedbackCmd.category, 'feedback');

  const ttsCmd = registry.resolve('tts');
  assert.ok(ttsCmd, 'tts command should be registered');
  assert.equal(ttsCmd.category, 'voice');
  const speakAlias = registry.resolve('speak');
  assert.ok(speakAlias, 'speak alias should resolve to tts');

  const voicePanelCmd = registry.resolve('voicepanel');
  assert.ok(voicePanelCmd, 'voicepanel command should be registered');
  assert.equal(voicePanelCmd.category, 'voice');
  const vpanelAlias = registry.resolve('vpanel');
  assert.ok(vpanelAlias, 'vpanel alias should resolve to voicepanel');

  const ttsPanelCmd = registry.resolve('ttspanel');
  assert.ok(ttsPanelCmd, 'ttspanel command should be registered');
  assert.equal(ttsPanelCmd.category, 'voice');
  const ttsControlAlias = registry.resolve('ttscontrol');
  assert.ok(ttsControlAlias, 'ttscontrol alias should resolve to ttspanel');
  const speechPanelAlias = registry.resolve('speechpanel');
  assert.ok(speechPanelAlias, 'speechpanel alias should resolve to ttspanel');

  const stickyNoteCmd = registry.resolve('stickynote');
  assert.ok(stickyNoteCmd, 'stickynote command should be registered');
  assert.equal(stickyNoteCmd.category, 'settings');
  const stickyAlias = registry.resolve('sticky');
  assert.ok(stickyAlias, 'sticky alias should resolve to stickynote');

  const stickyRoleCmd = registry.resolve('stickyrole');
  assert.ok(stickyRoleCmd, 'stickyrole command should be registered');
  assert.equal(stickyRoleCmd.category, 'settings');
  const stickyRolesAlias = registry.resolve('stickyroles');
  assert.ok(stickyRolesAlias, 'stickyroles alias should resolve to stickyrole');

  const autoRoleCmd = registry.resolve('autorole');
  assert.ok(autoRoleCmd, 'autorole command should be registered');
  assert.equal(autoRoleCmd.category, 'settings');
  const autoRolesAlias = registry.resolve('autoroles');
  assert.ok(autoRolesAlias, 'autoroles alias should resolve to autorole');
  const joinRoleAlias = registry.resolve('joinrole');
  assert.ok(joinRoleAlias, 'joinrole alias should resolve to autorole');

  const slashData = registry.toSlashData();
  assert.ok(Array.isArray(slashData), 'toSlashData should return an array');
  assert.ok(slashData.some(s => s.name === 'backup'));
  assert.ok(slashData.some(s => s.name === 'setting'));
  assert.ok(slashData.some(s => s.name === 'botprofile'));
  assert.ok(slashData.some(s => s.name === 'componentbuilder'));
  assert.ok(slashData.some(s => s.name === 'automod'));
  assert.ok(slashData.some(s => s.name === 'boosts'));
  assert.ok(slashData.some(s => s.name === 'stickynote'));
  assert.ok(slashData.some(s => s.name === 'stickyrole'));
  assert.ok(slashData.some(s => s.name === 'autorole'));
  assert.ok(slashData.some(s => s.name === 'chatlog'));
  assert.ok(slashData.some(s => s.name === 'suggest'));
  assert.ok(slashData.some(s => s.name === 'feedback'));
  assert.ok(slashData.some(s => s.name === 'tts'));
  assert.ok(slashData.some(s => s.name === 'voicepanel'));
  assert.ok(slashData.some(s => s.name === 'ttspanel'));
  assert.ok(slashData.some(s => s.name === 'perf'));

  const perfCmd = registry.resolve('perf');
  assert.ok(perfCmd, 'perf command should be registered');
  assert.equal(perfCmd.category, 'owner');
  assert.equal(perfCmd.instant, true);
  assert.equal(perfCmd.ephemeral, true);
});

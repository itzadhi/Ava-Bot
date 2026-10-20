import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle } from 'discord.js';

// TTS & Voices imports
import { getVoice, listVoicesByCategory, TTS_VOICES, applyAudioFilter } from '../src/modules/voice/tts/voices.js';
import { defaultTTSProvider, GoogleTTSProvider } from '../src/modules/voice/tts/provider.js';
import { ttsEngine } from '../src/modules/voice/tts/engine.js';
import { saveUserTTSPrefs, getUserTTSPrefs } from '../src/db/voice.js';

// ComponentBuilder imports
import { ComponentBuilder } from '../src/ui/builder.js';
import componentBuilderCmd from '../src/commands/settings/componentbuilder.js';
import ttsCmd from '../src/commands/voice/tts.js';
import { handleFeedbackVoiceInteraction } from '../src/modules/router.js';

test('TTS Voices: Catalog resolves both character DSP voices and regional accents', () => {
  // Character & FX voices
  const robot = getVoice('robot');
  assert.equal(robot.id, 'robot');
  assert.ok(robot.filter, 'Robot voice must have an FFmpeg audio filter');
  assert.equal(robot.category, 'Character & FX');

  const cyborg = getVoice('cyborg');
  assert.equal(cyborg.id, 'robot', 'Alias cyborg must resolve to robot');

  const chipmunk = getVoice('chipmunk');
  assert.equal(chipmunk.id, 'chipmunk');
  assert.ok(chipmunk.filter.includes('asetrate'), 'Chipmunk filter must pitch shift audio');

  const demon = getVoice('demon');
  assert.equal(demon.id, 'deep', 'Alias demon must resolve to deep');

  const giant = getVoice('titan');
  assert.equal(giant.id, 'giant', 'Alias titan must resolve to giant');

  // Regional accents
  const uk = getVoice('uk');
  assert.equal(uk.id, 'en-uk');
  assert.equal(uk.baseLang, 'en-GB');

  const jp = getVoice('ja');
  assert.equal(jp.id, 'ja');
  assert.equal(jp.baseLang, 'ja');

  // Fallback for unknown
  const unknown = getVoice('non_existent_123');
  assert.equal(unknown.id, 'en-us', 'Unknown voice should fallback to en-us');

  // Categorized listing
  const categories = listVoicesByCategory();
  assert.ok(categories['Character & FX'].length >= 10, 'Must have at least 10 character & FX voices');
  assert.ok(categories['Accents & Languages'].length >= 15, 'Must have at least 15 regional languages');
});

test('TTS Voices: applyAudioFilter runs safely with FFmpeg', async () => {
  // Create small test buffer
  const sampleBuffer = Buffer.alloc(1024, 0);
  const filtered = await applyAudioFilter(sampleBuffer, 'volume=1.2');
  assert.ok(Buffer.isBuffer(filtered), 'applyAudioFilter must return a Buffer');

  // Safe fallback when filter is null
  const clean = await applyAudioFilter(sampleBuffer, null);
  assert.equal(clean, sampleBuffer, 'Should return original buffer if filter is null');
});

test('TTS Synthesis: Provider synthesizes with character voice options', async () => {
  const provider = new GoogleTTSProvider('en');

  // Synthesize standard voice
  const resDefault = await provider.synthesize('Hello world', { voice: 'en-us' });
  assert.ok(resDefault.stream, 'Must return audio stream');
  assert.equal(resDefault.format, 'mp3');
  assert.equal(resDefault.voice, 'en-us');

  // Synthesize robot voice with local filter
  const resRobot = await provider.synthesize('Hello robot world', { voice: 'robot' });
  assert.ok(resRobot.stream, 'Must return audio stream for filtered voice');
  assert.ok(resRobot.buffer.length > 0, 'Buffer must have content');
  assert.equal(resRobot.voice, 'robot');
});

test('TTS Command: /tts voice updates user preference and /tts list displays catalog', async () => {
  const testGuildId = `guild_tts_v_${Date.now()}`;
  const testUserId = `user_tts_v_${Date.now()}`;

  // 1. Set voice using /tts voice:chipmunk
  let replyObj = null;
  const mockSetCtx = {
    guild: { id: testGuildId, name: 'TTS Voice Guild' },
    user: { id: testUserId },
    args: { voice: 'chipmunk' },
    reply: (payload) => { replyObj = payload; }
  };

  await ttsCmd.execute(mockSetCtx);
  assert.ok(replyObj, 'Should reply to voice command');

  const prefs = await getUserTTSPrefs(testUserId, testGuildId);
  assert.equal(prefs.language, 'chipmunk', 'Preference must be saved in database');

  // 2. View catalog using /tts action:list
  let listReply = null;
  const mockListCtx = {
    guild: { id: testGuildId, name: 'TTS Voice Guild' },
    user: { id: testUserId },
    args: { action: 'list' },
    reply: (payload) => { listReply = payload; }
  };

  await ttsCmd.execute(mockListCtx);
  assert.ok(listReply, 'Should reply with voice catalog');
});

test('ComponentBuilder: Fluent chaining produces valid Discord Components V2 structure', () => {
  const builder = new ComponentBuilder();

  builder
    .setTitle('Server Community Hub', '🌐')
    .setSubtitle('Welcome to our Discord server!')
    .addSeparator()
    .addText('Read the guidelines below before chatting.')
    .addSection('Need help? Click the support button:', {
      button: { id: 'btn_support', label: 'Support', style: 'Primary' }
    })
    .setThumbnail('https://cdn.example.com/logo.png')
    .addMediaGallery(['https://cdn.example.com/banner.png'])
    .addButton({ id: 'btn_verify', label: 'Verify', style: ButtonStyle.Success })
    .addButton({ id: 'btn_rules', label: 'Rules', style: ButtonStyle.Secondary })
    .addButton({ label: 'Website', url: 'https://example.com' })
    .addStringSelect({
      id: 'sel_role',
      placeholder: 'Choose your ping role',
      options: [
        { label: 'Announcements', value: 'ann' },
        { label: 'Events', value: 'evt' }
      ]
    });

  const payload = builder.build();

  assert.equal(payload.flags, MessageFlags.IsComponentsV2, 'Must have MessageFlags.IsComponentsV2');
  assert.equal(payload.components.length, 1, 'Must contain exactly 1 top-level Container');

  const json = payload.components[0].toJSON();
  assert.ok(json.components.length <= 40, 'Container components must not exceed 40');

  // Verify ActionRows
  const actionRows = json.components.filter(c => c.type === 1);
  assert.ok(actionRows.length >= 2, 'Must have action rows for buttons and select menu');

  // Verify ComponentBuilder.quick helper
  const quickPayload = ComponentBuilder.quick({
    title: 'Quick Card',
    body: 'Quick body text',
    thumbnail: 'https://cdn.example.com/thumb.png',
    buttons: [{ id: 'quick_btn', label: 'Click Me' }]
  });

  assert.equal(quickPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(quickPayload.components.length, 1);
});

test('ComponentBuilder: Automatically chunks more than 5 buttons across multiple ActionRows', () => {
  const builder = new ComponentBuilder();

  // Add 12 buttons
  for (let i = 1; i <= 12; i++) {
    builder.addButton({ id: `btn_${i}`, label: `Option ${i}` });
  }

  const payload = builder.build();
  const json = payload.components[0].toJSON();
  const rows = json.components.filter(c => c.type === 1);

  // 12 buttons chunked as 5, 5, 2 -> 3 rows
  assert.equal(rows.length, 3, '12 buttons should be split across 3 ActionRows');
  assert.equal(rows[0].components.length, 5);
  assert.equal(rows[1].components.length, 5);
  assert.equal(rows[2].components.length, 2);
});

test('Command: /componentbuilder builds and sends component directly', async () => {
  const testGuildId = `guild_cb_${Date.now()}`;
  let sentPayload = null;

  const mockTargetChannel = {
    id: 'chan_announcements_123',
    isTextBased: () => true,
    send: async (p) => {
      sentPayload = p;
      return { id: 'msg_ann_1', url: 'https://discord.com/channels/1/2/3' };
    }
  };

  let repliedCard = null;
  const mockCtx = {
    guild: { id: testGuildId, name: 'Component Test Guild' },
    channel: { id: 'chan_current_999' },
    member: { permissions: { has: () => true } },
    args: {
      title: 'Server Rules & Information',
      body: '1. Be respectful to all members\n2. No spamming in voice or text channels',
      channel: mockTargetChannel,
      thumbnail: 'https://images.example.com/thumb.png',
      button_label: 'Official Website',
      button_url: 'https://argoni.example.com'
    },
    reply: (p) => { repliedCard = p; }
  };

  await componentBuilderCmd.execute(mockCtx);

  assert.ok(sentPayload, 'Component payload must be sent to target channel');
  assert.equal(sentPayload.flags, MessageFlags.IsComponentsV2, 'Sent payload must be Components V2');
  assert.ok(repliedCard, 'Staff user must receive a confirmation card');
});

test('Router: Intercepts fb:cb:modal and publishes component to target channel', async () => {
  let targetSentPayload = null;
  const mockTargetChannel = {
    id: 'target_chan_456',
    isTextBased: () => true,
    send: async (p) => {
      targetSentPayload = p;
      return { id: 'msg_published_1' };
    }
  };

  let modalReplied = null;
  const mockModalInteraction = {
    customId: 'fb:cb:modal:target_chan_456',
    guildId: 'guild_cb_mod_1',
    user: { id: 'staff_user_1', tag: 'admin#0001' },
    member: { permissions: { has: () => true } },
    guild: {
      id: 'guild_cb_mod_1',
      channels: {
        cache: new Map([
          ['target_chan_456', mockTargetChannel]
        ])
      }
    },
    fields: {
      getTextInputValue: (field) => {
        if (field === 'cb_title') return 'Welcome to Argoni!';
        if (field === 'cb_body') return 'High-performance Discord infrastructure.';
        if (field === 'cb_thumb') return 'https://example.com/logo.png';
        if (field === 'cb_img') return '';
        if (field === 'cb_btn') return 'Documentation | https://docs.example.com';
        return '';
      }
    },
    reply: async (p) => { modalReplied = p; }
  };

  const handled = await handleFeedbackVoiceInteraction(mockModalInteraction);
  assert.equal(handled, true, 'Router must handle fb:cb:modal interaction');
  assert.ok(targetSentPayload, 'Target channel must have received component message');
  assert.equal(targetSentPayload.flags, MessageFlags.IsComponentsV2);
  assert.ok(modalReplied.content.includes('Component Published'));
});

test('Bot Profile Panel: Renders full interactive panel with headings, subheadings, - bullets and bold formatting', async () => {
  const { buildBotProfilePanel } = await import('../src/modules/settings/botprofile.js');

  const mockGuild = {
    id: 'guild_test_bp',
    name: 'Cyberverse Alpha',
    members: {
      me: {
        nickname: 'CyberAssistant',
        avatarURL: () => 'https://example.com/avatar.png'
      }
    }
  };

  const currentSettings = {
    bot_nickname: 'CyberAssistant',
    bot_bio: 'Server infrastructure and automation bot.',
    bot_avatar_url: 'https://example.com/avatar.png',
    bot_banner_url: 'https://example.com/banner.png'
  };

  const payload = buildBotProfilePanel({
    guild: mockGuild,
    client: { user: { username: 'Argoni' } },
    currentSettings,
    note: 'Active custom profile'
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);

  const containerJson = payload.components[0].toJSON();

  // Verify text content formatting: headings, subheadings, and - bullets with bold formatting
  const textDisplays = containerJson.components.filter(c => c.type === 10);
  const fullText = textDisplays.map(t => t.content).join('\n');

  assert.ok(fullText.includes('# Server Identity'), 'Must have # heading');
  assert.ok(fullText.includes('### Bot Profile Configuration'), 'Must have ### subheading');
  assert.ok(fullText.includes('- **Guild:** Cyberverse Alpha'), 'Must use - bullet and bold for guild');
  assert.ok(fullText.includes('- **Nickname:** CyberAssistant'), 'Must use - bullet and bold for nickname');
  assert.ok(fullText.includes('- **About Me:** Server infrastructure and automation bot.'), 'Must use - bullet and bold for bio');
  assert.ok(fullText.includes('- **Server Avatar:**'), 'Must use - bullet and bold for avatar');
  assert.ok(fullText.includes('- **Server Banner:**'), 'Must use - bullet and bold for banner');
  assert.ok(fullText.includes('### Controls'), 'Must have ### Controls subheading');

  // Verify ActionRows and Buttons
  const actionRows = containerJson.components.filter(c => c.type === 1);
  assert.ok(actionRows.length >= 2, 'Must have at least 2 ActionRows for buttons');

  const allButtons = actionRows.flatMap(r => r.components);
  const buttonIds = allButtons.map(b => b.custom_id);

  assert.ok(buttonIds.includes('fb:bp:nick:0'), 'Must have Edit Nickname button');
  assert.ok(buttonIds.includes('fb:bp:bio:0'), 'Must have Edit Bio button');
  assert.ok(buttonIds.includes('fb:bp:avatar:0'), 'Must have Edit Avatar button');
  assert.ok(buttonIds.includes('fb:bp:banner:0'), 'Must have Edit Banner button');
  assert.ok(buttonIds.includes('fb:bp:edit_all:0'), 'Must have Edit All button');
  assert.ok(buttonIds.includes('fb:bp:reset:0'), 'Must have Reset Defaults button');
  assert.ok(buttonIds.includes('fb:bp:refresh:0'), 'Must have Refresh button');
});

test('Router: Intercepts fb:bp:refresh and updates bot profile panel smoothly', async () => {
  let updatedPayload = null;

  const mockInteraction = {
    customId: 'fb:bp:refresh:0',
    guildId: 'guild_test_bp_refresh',
    user: { id: 'staff_user_1', tag: 'admin#0001' },
    member: { permissions: { has: () => true } },
    guild: {
      id: 'guild_test_bp_refresh',
      name: 'Refresh Server',
      members: {
        me: { nickname: 'RefreshedBot' }
      }
    },
    client: { user: { username: 'Argoni' } },
    deferUpdate: async () => {},
    update: async (p) => { updatedPayload = p; }
  };

  const handled = await handleFeedbackVoiceInteraction(mockInteraction);
  assert.equal(handled, true, 'Router must handle fb:bp:refresh');
  assert.ok(updatedPayload, 'Panel must update smoothly in place');
  assert.equal(updatedPayload.flags, MessageFlags.IsComponentsV2);
});

test('TTS Panel: Renders interactive panel with typography, voice dropdown, and action buttons', async () => {
  const { buildTTSPanel } = await import('../src/modules/voice/tts/panel.js');

  const mockGuild = {
    id: 'guild_tts_panel_1',
    name: 'Voice Kingdom',
    channels: {
      cache: new Map([
        ['vc_active_1', {
          id: 'vc_active_1',
          name: 'General Voice',
          members: new Map([
            ['u1', { user: { bot: false } }],
            ['u2', { user: { bot: false } }]
          ])
        }]
      ])
    }
  };

  const payload = await buildTTSPanel({
    guild: mockGuild,
    client: { user: { username: 'Argoni' } },
    user: { id: 'user_listener_1' },
    session: {
      voiceChannelId: 'vc_active_1',
      textChannelId: 'chat_active_1'
    },
    userPrefs: {
      language: 'robot',
      opt_out: false
    },
    note: 'TTS Engine Active'
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.equal(payload.components.length, 1);

  const containerJson = payload.components[0].toJSON();
  const textDisplays = containerJson.components.filter(c => c.type === 10);
  const fullText = textDisplays.map(t => t.content).join('\n');

  assert.ok(fullText.includes('# Speech Synthesizer'), 'Must include # heading');
  assert.ok(fullText.includes('### Text-to-Speech Engine & Voice Reader'), 'Must include ### subheading');
  assert.ok(fullText.includes('- **Reader Status:** Active (Connected)'));
  assert.ok(fullText.includes('- **Connected Listeners:** 2 member(s)'));
  assert.ok(fullText.includes('- **Your Active Voice:** 🤖 Cyber Robot (`robot`)'));
  assert.ok(fullText.includes('- **Your TTS Status:** Opted In (Messages spoken)'));

  // Action rows
  const actionRows = containerJson.components.filter(c => c.type === 1);
  assert.ok(actionRows.length >= 3, 'Must have at least 3 ActionRows (select menu + 2 button rows)');

  // Voice selector menu
  const selectMenuRow = actionRows.find(r => r.components.some(c => c.custom_id === 'fb:tts:voice_sel:0'));
  assert.ok(selectMenuRow, 'Must include voice selector dropdown menu');

  // Buttons
  const buttons = actionRows.flatMap(r => r.components).filter(c => c.type === 2);
  const buttonIds = buttons.map(b => b.custom_id);
  assert.ok(buttonIds.includes('fb:tts:join:0'), 'Must have Join & Bind button');
  assert.ok(buttonIds.includes('fb:tts:leave:0'), 'Must have Disconnect button');
  assert.ok(buttonIds.includes('fb:tts:test_btn:0'), 'Must have Speak Test button');
  assert.ok(buttonIds.includes('fb:tts:opt_toggle:0'), 'Must have Opt Toggle button');
  assert.ok(buttonIds.includes('fb:tts:refresh:0'), 'Must have Refresh button');
});

test('Command: /ttspanel renders interactive panel in current channel', async () => {
  const ttsPanelCmd = (await import('../src/commands/voice/ttspanel.js')).default;

  const mockGuild = {
    id: `guild_ttspanel_cmd_${Date.now()}`,
    name: 'Panel Test Guild',
    channels: { cache: new Map() }
  };

  let repliedPanel = null;
  const mockCtx = {
    guild: mockGuild,
    channel: { id: 'current_chat_chan_1' },
    user: { id: 'panel_caller_1' },
    member: { permissions: { has: () => true } },
    args: {},
    reply: (p) => { repliedPanel = p; }
  };

  await ttsPanelCmd.execute(mockCtx);
  assert.ok(repliedPanel, 'Command must reply with TTS panel');
  assert.equal(repliedPanel.flags, MessageFlags.IsComponentsV2);
});

test('Router: Intercepts fb:tts:voice_sel and updates user voice smoothly', async () => {
  const testGuildId = `guild_tts_router_${Date.now()}`;
  const testUserId = `user_tts_router_${Date.now()}`;
  let updatePayload = null;

  const mockInteraction = {
    customId: 'fb:tts:voice_sel:0',
    guildId: testGuildId,
    user: { id: testUserId, username: 'VoiceSwapper' },
    values: ['chipmunk'],
    guild: {
      id: testGuildId,
      name: 'Router Test Guild',
      channels: { cache: new Map() }
    },
    client: { user: { username: 'Argoni' } },
    deferUpdate: async () => {},
    update: async (p) => { updatePayload = p; }
  };

  const handled = await handleFeedbackVoiceInteraction(mockInteraction);
  assert.equal(handled, true, 'Router must handle fb:tts:voice_sel');
  assert.ok(updatePayload, 'Must update panel smoothly');

  const { getUserTTSPrefs } = await import('../src/db/voice.js');
  const prefs = await getUserTTSPrefs(testUserId, testGuildId);
  assert.equal(prefs.language, 'chipmunk', 'Preference must be saved in database');
});



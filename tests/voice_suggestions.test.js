import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';

// Module imports
import { sanitizeTTSText, ttsEngine } from '../src/modules/voice/tts/engine.js';
import { defaultTTSProvider, GoogleTTSProvider, TTSProvider } from '../src/modules/voice/tts/provider.js';
import { buildControlCard, buildCommonControlCard } from '../src/modules/voice/control.js';
import { checkRenameRateLimit, voiceMembersTime } from '../src/modules/voice/jtc.js';
import { buildSuggestionCard } from '../src/modules/suggestions/index.js';
import { buildFeedbackCard, buildFeedbackModal, buildStars, getRatingSentiment } from '../src/modules/feedback/index.js';
import { renderStaffPanel } from '../src/modules/staff/panel.js';
import { handleFeedbackVoiceInteraction } from '../src/modules/router.js';

// Database imports
import { createSuggestion, getSuggestionById, castVote, getUserVote } from '../src/db/suggestions.js';
import { createFeedback, getFeedbackById, updateFeedback } from '../src/db/feedback.js';
import { createTempChannel, getTempChannel, getTempChannelByOwner, saveUserVoicePrefs, getUserVoicePrefs, saveUserTTSPrefs, getUserTTSPrefs } from '../src/db/voice.js';
import { savePanelState, getPanelState } from '../src/db/panels.js';
import { getGuildSettings, updateGuildSettings } from '../src/db/guilds.js';

test('TTS: text sanitization strips mentions, links, emojis, markdown, and code blocks', () => {
  const raw = '```js\nconsole.log("hello");\n``` Check out <@123456789> and <#987654321> at https://discord.gg/test <:custom_emoji:112233> with **bold** and _italics_! ||spoiler|| `inline code`';
  const clean = sanitizeTTSText(raw);

  assert.ok(!clean.includes('```js'), 'Code blocks must be removed');
  assert.ok(!clean.includes('<@123456789>'), 'User mentions must be removed');
  assert.ok(!clean.includes('<#987654321>'), 'Channel mentions must be removed');
  assert.ok(!clean.includes('https://'), 'Links must be removed');
  assert.ok(!clean.includes('<:custom_emoji'), 'Custom emojis must be removed');
  assert.ok(!clean.includes('||spoiler||'), 'Spoilers must be removed');
  assert.ok(!clean.includes('`inline code`'), 'Inline code must be removed');
  assert.ok(clean.includes('Check out'), 'Normal speech text must be preserved');
  assert.ok(clean.includes('bold and italics'), 'Clean text content must be retained');
});

test('TTS: text sanitization caps length at specified maximum', () => {
  const longText = 'a'.repeat(300);
  const capped = sanitizeTTSText(longText, 150);
  assert.equal(capped.length, 150, 'Text must be capped at 150 chars');
});

test('TTS: provider abstraction works with GoogleTTSProvider', async () => {
  assert.ok(defaultTTSProvider instanceof TTSProvider, 'defaultTTSProvider should be an instance of TTSProvider');
  assert.equal(typeof defaultTTSProvider.synthesize, 'function', 'Provider must implement synthesize()');

  // Verify speech synthesis generates audio stream
  const { stream, format } = await defaultTTSProvider.synthesize('Test speech audio', { language: 'en' });
  assert.ok(stream, 'Synthesize must return a stream');
  assert.equal(format, 'mp3', 'Google TTS returns mp3 format');
});

test('JTC: checkRenameRateLimit prevents more than 2 renames per 10 minutes', () => {
  const channelId = `test_rate_chan_${Date.now()}`;

  const first = checkRenameRateLimit(channelId);
  assert.equal(first.allowed, true, 'First rename should be permitted');

  const second = checkRenameRateLimit(channelId);
  assert.equal(second.allowed, true, 'Second rename should be permitted');

  const third = checkRenameRateLimit(channelId);
  assert.equal(third.allowed, false, 'Third rename within 10 minutes must be blocked');
  assert.ok(third.waitSeconds > 0, 'Should return remaining wait seconds');
});

test('JTC: Room Control Card strictly conforms to Components V2 standards', () => {
  const mockChannel = {
    id: '123456789012345678',
    name: "Tester's room",
    userLimit: 5,
    bitrate: 64000,
    members: new Map([
      ['111', { id: '111' }],
      ['222', { id: '222' }]
    ])
  };

  const payload = buildControlCard({
    channel: mockChannel,
    ownerId: '111',
    isLocked: false,
    isHidden: false,
    ttsEnabled: true
  });

  assert.equal(payload.flags, MessageFlags.IsComponentsV2, 'Must carry MessageFlags.IsComponentsV2');
  assert.ok(Array.isArray(payload.components), 'Components must be an array');
  assert.equal(payload.components.length, 1, 'Must contain exactly 1 top-level ContainerBuilder');

  const containerJson = payload.components[0].toJSON();
  assert.ok(containerJson.components.length <= 40, 'Total components must not exceed 40');
  assert.equal(containerJson.accent_color, undefined, 'Must not have accent color');
  assert.ok(containerJson.components.some(c => c.type === 1), 'Container must have ActionRow components');

  // Verify Voice Manager header and quote
  const textDisplays = containerJson.components.filter(c => c.type === 10);
  assert.ok(textDisplays.some(t => t.content?.includes('# Voice Manager')), 'Header must have Voice Manager title');
  assert.ok(textDisplays.some(t => t.content?.includes('> Join the creator channel')), 'Header must have creator quote');
  assert.ok(textDisplays.some(t => t.content?.includes('Member Controls')), 'Must have Member Controls heading');

  // Verify common control card builder
  const commonPayload = buildCommonControlCard();
  assert.equal(commonPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(commonPayload.components.length, 1);
  const commonJson = commonPayload.components[0].toJSON();
  const commonRows = commonJson.components.filter(c => c.type === 1);
  assert.ok(commonRows.length >= 2, 'Common panel must have multiple ActionRows (disconnect button + action dropdown)');

  // Verify Disconnect button
  const disconnectBtn = commonRows[0].components.find(b => b.custom_id?.includes(':disconnect:common'));
  assert.ok(disconnectBtn, 'Buttons must include Disconnect Users with :common');
  assert.equal(disconnectBtn.label, 'Disconnect Users');

  // Verify Action Select Menu and 8 exact options
  const actionMenu = commonRows[1].components.find(s => s.custom_id?.includes(':action_sel:common'));
  assert.ok(actionMenu, 'Must have action_sel select menu with :common');
  assert.equal(actionMenu.placeholder, 'Select an action...');
  assert.equal(actionMenu.options.length, 8, 'Must have exactly 8 action options matching screenshots');

  const expectedValues = ['lock', 'unlock', 'hide', 'reveal', 'delete', 'rename', 'bitrate', 'limit'];
  for (const val of expectedValues) {
    assert.ok(actionMenu.options.some(opt => opt.value === val), `Must have option for ${val}`);
  }

  // Verify Suggestion and Feedback are removed from both cards
  const allCardButtons = containerJson.components
    .filter(c => c.type === 1)
    .flatMap(r => r.components || []);
  assert.ok(!allCardButtons.some(b => b.custom_id?.includes(':sug:')), 'buildControlCard must not contain Suggest button');
  assert.ok(!allCardButtons.some(b => b.custom_id?.includes(':fbk:')), 'buildControlCard must not contain Feedback button');

  const allCommonButtons = commonRows.flatMap(r => r.components || []);
  assert.ok(!allCommonButtons.some(b => b.custom_id?.includes(':sug:')), 'buildCommonControlCard must not contain Suggest button');
  assert.ok(!allCommonButtons.some(b => b.custom_id?.includes(':fbk:')), 'buildCommonControlCard must not contain Feedback button');
});

test('Suggestions: Card builder, live voting toggle and switch behavior', async () => {
  const testGuildId = `guild_sug_${Date.now()}`;
  const suggestion = await createSuggestion({
    guildId: testGuildId,
    channelId: 'chan_123',
    messageId: 'msg_123',
    authorId: 'user_456',
    authorUsername: 'SuggesterUser',
    text: 'Implement custom soundboard shortcuts'
  });

  assert.ok(suggestion.id.startsWith('sug_'));
  assert.equal(suggestion.status, 'pending');

  // Verify V2 card payload (no accent color, short buttons, and no mod buttons)
  const cardPayload = buildSuggestionCard({ suggestion, upCount: 5, downCount: 2 });
  assert.equal(cardPayload.flags, MessageFlags.IsComponentsV2);
  assert.equal(cardPayload.components.length, 1);
  const containerJson = cardPayload.components[0].toJSON();
  assert.equal(containerJson.accent_color, undefined, 'Container must have no embed accent color');
  const actionRows = containerJson.components.filter(c => c.type === 1);
  assert.equal(actionRows.length, 1, 'Public suggestion card must have exactly 1 action row (no mod buttons)');
  const buttons = actionRows[0].components;
  assert.equal(buttons[0].label, 'Support (5)', 'Upvote button label must match screenshot Support (count)');
  assert.equal(buttons[1].label, 'Oppose (2)', 'Downvote button label must match screenshot Oppose (count)');

  // Cast Upvote
  const voter1 = 'voter_1';
  const vote1 = await castVote(suggestion.id, testGuildId, voter1, 'up');
  assert.equal(vote1.action, 'added');
  assert.equal(vote1.upvotes, 1);
  assert.equal(vote1.downvotes, 0);

  // Toggle same vote off
  const vote2 = await castVote(suggestion.id, testGuildId, voter1, 'up');
  assert.equal(vote2.action, 'removed');
  assert.equal(vote2.upvotes, 0);

  // Re-cast Upvote
  await castVote(suggestion.id, testGuildId, voter1, 'up');

  // Switch from Upvote to Downvote
  const vote3 = await castVote(suggestion.id, testGuildId, voter1, 'down');
  assert.equal(vote3.action, 'switched');
  assert.equal(vote3.upvotes, 0);
  assert.equal(vote3.downvotes, 1);

  const finalSug = await getSuggestionById(suggestion.id);
  assert.equal(finalSug.downvotes_count, 1);
  assert.equal(finalSug.upvotes_count, 0);
});

test('Feedback: Card builder, modals, and status resolution', async () => {
  const testGuildId = `guild_fbk_${Date.now()}`;

  // Verify modal structure
  const modal = buildFeedbackModal('room_123');
  assert.ok(modal.data.custom_id.includes('room_123'));
  assert.equal(modal.components.length, 3, 'Modal must have 3 text inputs (rating, review, image)');

  // Verify stars helper and sentiment
  assert.equal(buildStars(5), '⭐⭐⭐⭐⭐');
  assert.equal(buildStars(3), '⭐⭐⭐☆☆');
  assert.equal(buildStars(null), 'Not Rated');
  assert.equal(getRatingSentiment(5), 'Exceptional');
  assert.equal(getRatingSentiment(1), 'Critical / Poor');

  // Create feedback record
  const fb = await createFeedback({
    guildId: testGuildId,
    channelId: 'chan_fbk',
    messageId: 'msg_fbk',
    authorId: 'user_789',
    authorUsername: 'ReviewerUser',
    category: 'Bug',
    message: 'Voice channel bitrate dropped randomly',
    rating: 4,
    context: { channel_id: 'room_123', owner_id: 'user_789', member_count: 2, tts_state: 'Active', suggestion: 'Add adaptive bitrate' }
  });

  assert.ok(fb.id.startsWith('fbk_'));
  assert.equal(fb.status, 'unread');

  const cardPayload = buildFeedbackCard(fb);
  assert.equal(cardPayload.flags, MessageFlags.IsComponentsV2);

  // Update status to resolved
  const updated = await updateFeedback(fb.id, { status: 'resolved', reply: 'Fixed in audio patch' });
  assert.equal(updated.status, 'resolved');
  assert.equal(updated.reply, 'Fixed in audio patch');

  const resolvedCard = buildFeedbackCard(updated);
  assert.equal(resolvedCard.flags, MessageFlags.IsComponentsV2);
});

test('Voice DB: temporary channel and user preferences persistence', async () => {
  const channelId = `temp_vc_${Date.now()}`;
  const guildId = `guild_vc_${Date.now()}`;
  const userId = `user_vc_${Date.now()}`;

  // Temp channel record
  const tc = await createTempChannel({
    channelId,
    guildId,
    ownerId: userId,
    name: 'Voice Hangout',
    userLimit: 8,
    bitrate: 96000
  });

  assert.equal(tc.channel_id, channelId);
  const fetchedTc = await getTempChannel(channelId);
  assert.ok(fetchedTc);
  assert.equal(fetchedTc.user_limit, 8);

  // User voice preferences
  await saveUserVoicePrefs(userId, guildId, {
    preferredName: 'My Custom Lounge',
    preferredLimit: 12,
    preferredBitrate: 96000
  });

  const prefs = await getUserVoicePrefs(userId, guildId);
  assert.equal(prefs.preferred_name, 'My Custom Lounge');
  assert.equal(prefs.preferred_limit, 12);

  // User TTS preferences
  await saveUserTTSPrefs(userId, guildId, { optOut: true, language: 'es' });
  const ttsPrefs = await getUserTTSPrefs(userId, guildId);
  assert.equal(ttsPrefs.opt_out, true);
  assert.equal(ttsPrefs.language, 'es');

  // Verify getTempChannelByOwner
  const byOwner = await getTempChannelByOwner(guildId, userId);
  assert.ok(byOwner, 'Should fetch temp channel by owner ID');
  assert.equal(byOwner.channel_id, channelId);
});

test('Staff Panel: renders all 4 tabs (sug, fbk, voice, settings) with Components V2', async () => {
  const mockGuild = {
    id: `guild_panel_${Date.now()}`,
    name: 'Test Gaming Server',
    channels: { cache: new Map() },
    roles: { cache: new Map() }
  };

  const tabs = ['sug', 'fbk', 'voice', 'settings'];
  for (const tab of tabs) {
    const payload = await renderStaffPanel({
      guild: mockGuild,
      activeTab: tab,
      filterStatus: 'all',
      page: 1
    });

    assert.equal(payload.flags, MessageFlags.IsComponentsV2, `Tab ${tab} must return MessageFlags.IsComponentsV2`);
    assert.equal(payload.components.length, 1, `Tab ${tab} must contain 1 top-level Container`);
    const container = payload.components[0].toJSON();
    assert.ok(container.components.length <= 40, `Tab ${tab} must be within 40 component limit`);
    assert.equal(container.accent_color, undefined, `Tab ${tab} must have no sidebar accent color`);

    // Verify STRICTLY NO DUPLICATE custom_ids across all action rows and components in the container
    const customIds = [];
    for (const comp of container.components) {
      if (comp.custom_id) customIds.push(comp.custom_id);
      if (Array.isArray(comp.components)) {
        for (const sub of comp.components) {
          if (sub.custom_id) customIds.push(sub.custom_id);
        }
      }
    }
    const uniqueIds = new Set(customIds);
    assert.equal(uniqueIds.size, customIds.length, `Tab ${tab} must not contain duplicate custom IDs: ${customIds.join(', ')}`);
  }
});

test('Router: correctly intercepts fb:* and ignores non-fb customIds', async () => {
  const nonFbInteraction = { customId: 'owner:backup:btn' };
  const handledNonFb = await handleFeedbackVoiceInteraction(nonFbInteraction);
  assert.equal(handledNonFb, false, 'Non-fb customId should be ignored by router');

  let replied = false;
  const mockInteraction = {
    customId: 'fb:invalid:action:123',
    guildId: '123',
    user: { id: '999' },
    reply: async () => { replied = true; }
  };
  const handled = await handleFeedbackVoiceInteraction(mockInteraction);
  assert.equal(handled, false, 'Invalid module should not be handled');

  // Verify Common JTC panel routing to creator's active room
  let jtcFollowUp = null;
  const mockJtcInteraction = {
    customId: 'fb:jtc:lock:common',
    guildId: 'guild_common_test',
    user: { id: 'user_creator_1' },
    member: {
      voice: { channel: { id: 'vc_creator_1', name: 'My Lounge' } }
    },
    guild: {
      channels: {
        cache: new Map([
          ['vc_creator_1', {
            id: 'vc_creator_1',
            name: 'My Lounge',
            permissionOverwrites: { edit: async () => {} }
          }]
        ])
      },
      roles: { everyone: { id: 'everyone_role' } }
    },
    deferUpdate: async () => {},
    followUp: async (data) => { jtcFollowUp = data.content || JSON.stringify(data); }
  };

  // Seed temp channel for creator
  await createTempChannel({
    channelId: 'vc_creator_1',
    guildId: 'guild_common_test',
    ownerId: 'user_creator_1',
    name: 'My Lounge',
    isLocked: false
  });

  const jtcHandled = await handleFeedbackVoiceInteraction(mockJtcInteraction);
  assert.equal(jtcHandled, true);
  assert.ok(jtcFollowUp && jtcFollowUp.includes('My Lounge'), 'Should manage that particular voice channel from common panel');

  // Verify Voice Manager action_sel routing (Lock)
  let actionFollowUp = null;
  const mockActionInteraction = {
    customId: 'fb:jtc:action_sel:common',
    guildId: 'guild_common_test',
    user: { id: 'user_creator_1' },
    member: {
      voice: { channel: { id: 'vc_creator_1', name: 'My Lounge' } }
    },
    guild: mockJtcInteraction.guild,
    values: ['lock'],
    deferUpdate: async () => {},
    followUp: async (data) => { actionFollowUp = data.content || JSON.stringify(data); }
  };

  const actionHandled = await handleFeedbackVoiceInteraction(mockActionInteraction);
  assert.equal(actionHandled, true);
  assert.ok(actionFollowUp && actionFollowUp.includes('Locked'), 'action_sel lock must lock the channel');

  // Verify Disconnect button routing
  let disconnectReply = null;
  const mockDisconnectInteraction = {
    customId: 'fb:jtc:disconnect:common',
    guildId: 'guild_common_test',
    user: { id: 'user_creator_1' },
    member: {
      voice: { channel: { id: 'vc_creator_1', name: 'My Lounge' } }
    },
    guild: {
      channels: {
        cache: new Map([
          ['vc_creator_1', {
            id: 'vc_creator_1',
            name: 'My Lounge',
            members: new Map()
          }]
        ])
      }
    },
    reply: async (data) => { disconnectReply = data.content || JSON.stringify(data); }
  };

  const disconnectHandled = await handleFeedbackVoiceInteraction(mockDisconnectInteraction);
  assert.equal(disconnectHandled, true);
  assert.ok(disconnectReply && disconnectReply.includes('no other members'), 'Should notify if no members to disconnect');
});

test('Suggestions & Threads: postSuggestionMessage creates V2 card and starts public thread', async () => {
  const { postSuggestionMessage } = await import('../src/modules/suggestions/index.js');

  let threadStarted = false;
  let threadSlowmode = null;
  const mockMessage = {
    id: `msg_${Date.now()}`,
    startThread: async (opts) => {
      threadStarted = true;
      threadSlowmode = opts.rateLimitPerUser;
      return {
        id: `thread_${Date.now()}`,
        send: async () => ({ id: 'thread_welcome_msg' })
      };
    }
  };

  const mockChannel = {
    id: `chan_${Date.now()}`,
    send: async () => mockMessage,
    permissionsFor: () => ({
      has: () => true
    })
  };

  const mockGuild = {
    id: `guild_thread_${Date.now()}`,
    name: 'Thread Test Guild',
    client: { user: { id: 'bot_123' } },
    members: { me: { id: 'bot_123' } }
  };

  const author = {
    id: 'user_456',
    username: 'tester',
    tag: 'tester#0001',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
  };

  const { suggestion, post, thread } = await postSuggestionMessage({
    guild: mockGuild,
    channel: mockChannel,
    author,
    text: 'Please add a custom role color picker to the voice settings panel!'
  });

  assert.ok(suggestion, 'Suggestion record must be created');
  assert.ok(post, 'Post message must be returned');
  assert.ok(thread, 'Discussion thread must be created');
  assert.equal(threadStarted, true, 'startThread must have been invoked');
});

test('TTS Command: /tts validates user voice state and rejects execution when not in voice', async () => {
  const ttsCommand = (await import('../src/commands/voice/tts.js')).default;
  assert.equal(ttsCommand.name, 'tts');
  assert.equal(ttsCommand.category, 'voice');

  let errorReplied = false;
  let replyObj = null;
  const mockCtxWithoutVoice = {
    guild: { id: 'g1' },
    member: { voice: { channel: null } },
    reply: (payload) => { replyObj = payload; errorReplied = true; }
  };

  await ttsCommand.execute(mockCtxWithoutVoice);
  assert.equal(errorReplied, true);
  assert.ok(replyObj);
});

test('TTS Command: /tts joins VC, binds to chat channel, and reads upcoming chat with display name', async () => {
  const ttsCommand = (await import('../src/commands/voice/tts.js')).default;
  const testGuildId = `guild_tts_${Date.now()}`;
  const voiceChannelId = 'vc_room_101';
  const textChannelId = 'chat_chan_202';

  // Mock voice channel with listener
  const mockVc = {
    id: voiceChannelId,
    name: 'General Lounge',
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    members: new Map([
      ['user_listener', { id: 'user_listener', user: { bot: false } }]
    ])
  };

  const mockGuild = {
    id: testGuildId,
    voiceAdapterCreator: {},
    channels: {
      cache: new Map([
        [voiceChannelId, mockVc]
      ])
    },
    members: {
      me: { id: 'bot_me' }
    }
  };

  // Mock ensureConnection so it doesn't need real Discord gateway socket in unit test
  const originalEnsure = ttsEngine.ensureConnection.bind(ttsEngine);
  ttsEngine.ensureConnection = async () => ({ state: { status: 'ready' } });

  try {
    let replySuccess = false;
    let successCardObj = null;

    const mockCtx = {
      guild: mockGuild,
      user: { id: 'user_caller' },
      member: {
        voice: { channel: mockVc }
      },
      channel: { id: textChannelId },
      args: {},
      reply: (payload) => {
        replySuccess = true;
        successCardObj = payload;
      }
    };

    // 1. Run /tts to join and bind
    await ttsCommand.execute(mockCtx);
    assert.equal(replySuccess, true);
    assert.ok(successCardObj);

    const session = ttsEngine.getSession(testGuildId);
    assert.ok(session);
    assert.equal(session.voiceChannelId, voiceChannelId);
    assert.equal(session.textChannelId, textChannelId);

    // 2. Intercept queueSpeech to verify upcoming message spoken content
    let queuedSpeech = null;
    const originalQueueSpeech = ttsEngine.queueSpeech.bind(ttsEngine);
    ttsEngine.queueSpeech = async (opts) => {
      queuedSpeech = opts;
      return true;
    };

    const upcomingMessage = {
      guild: mockGuild,
      channel: { id: textChannelId },
      author: { id: 'chat_user_1', username: 'ChatUser1', bot: false },
      member: { displayName: 'Alex Cool' },
      content: 'Hey everyone, check this out!'
    };

    await ttsEngine.handleMessage(upcomingMessage);
    assert.ok(queuedSpeech, 'Incoming message in bound chat must be queued for speech');
    assert.equal(queuedSpeech.text, 'Alex Cool says, Hey everyone, check this out!');
    assert.equal(queuedSpeech.voiceChannel.id, voiceChannelId);

    // 3. Run /tts stop
    let stopReplied = false;
    const stopCtx = {
      guild: mockGuild,
      user: { id: 'user_caller' },
      channel: { id: textChannelId },
      args: { action: 'stop' },
      reply: () => { stopReplied = true; }
    };
    await ttsCommand.execute(stopCtx);
    assert.equal(stopReplied, true);
    assert.equal(ttsEngine.getSession(testGuildId), null, 'Session must be terminated after stop');

    ttsEngine.queueSpeech = originalQueueSpeech;
  } finally {
    ttsEngine.ensureConnection = originalEnsure;
    ttsEngine.stop(testGuildId);
  }
});

test('Backup: log channel setting updates guild_settings via command', async () => {
  const { backupCommand } = await import('../src/modules/backup/command.js');
  const { getGuildSettings } = await import('../src/db/guilds.js');

  const testGuildId = `guild_bk_chan_${Date.now()}`;
  let replySuccess = false;
  const mockCtx = {
    guild: { id: testGuildId, name: 'Backup Chan Guild' },
    user: { id: 'user_1' },
    args: { channel: { id: 'chan_bk_logs_999' } },
    reply: (payload) => { replySuccess = true; }
  };

  await backupCommand.execute(mockCtx);
  assert.equal(replySuccess, true);

  const settings = await getGuildSettings(testGuildId);
  assert.equal(settings.log_channel_id, 'chan_bk_logs_999');
});

test('Bot Profile: /botprofile updates guild settings and calls editMe', async () => {
  const botprofileCmd = (await import('../src/commands/settings/botprofile.js')).default;
  const { getGuildSettings } = await import('../src/db/guilds.js');

  const testGuildId = `guild_botprofile_${Date.now()}`;
  let editMeCalled = false;
  let editMePayload = null;

  const mockGuild = {
    id: testGuildId,
    name: 'Profile Guild',
    ownerId: 'owner_user_1',
    members: {
      me: {
        id: 'bot_me_1',
        nickname: 'OriginalName',
        avatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png'
      },
      editMe: async (payload) => {
        editMeCalled = true;
        editMePayload = payload;
        return mockGuild.members.me;
      }
    }
  };

  let repliedCard = null;
  const mockCtx = {
    guild: mockGuild,
    user: { id: 'owner_user_1', tag: 'owner#0001' },
    member: { permissions: { has: () => true } },
    client: { user: { username: 'AVA', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' } },
    args: {
      name: 'Custom Hedwig',
      about_me: 'I am the server assistant!',
      icon_url: 'https://images.example.com/avatar.png',
      banner_url: 'https://images.example.com/banner.png'
    },
    reply: (payload) => { repliedCard = payload; }
  };

  await botprofileCmd.execute(mockCtx);

  assert.equal(editMeCalled, true, 'guild.members.editMe should be called');
  assert.equal(editMePayload.nick, 'Custom Hedwig');
  assert.equal(editMePayload.bio, 'I am the server assistant!');
  assert.equal(editMePayload.avatar, 'https://images.example.com/avatar.png');
  assert.equal(editMePayload.banner, 'https://images.example.com/banner.png');
  assert.ok(repliedCard, 'Should send success card');

  const savedSettings = await getGuildSettings(testGuildId);
  assert.equal(savedSettings.bot_nickname, 'Custom Hedwig');
  assert.equal(savedSettings.bot_bio, 'I am the server assistant!');
  assert.equal(savedSettings.bot_avatar_url, 'https://images.example.com/avatar.png');
  assert.equal(savedSettings.bot_banner_url, 'https://images.example.com/banner.png');
});




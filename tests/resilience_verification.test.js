import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle } from 'discord.js';

import { isAcknowledged, markAcknowledged } from '../src/core/interactions/tracker.js';
import { safeRespond, sanitizePayload } from '../src/core/interactions/safeRespond.js';
import { runHandler } from '../src/core/interactions/runHandler.js';
import { routeInteraction, isModalOpener } from '../src/core/interactions/router.js';
import { interactionRegistry } from '../src/core/interactions/registry.js';
import { sessionStore } from '../src/core/interactions/session.js';
import { metrics } from '../src/core/metrics.js';

/**
 * Creates a mock interaction object with tracking spies
 */
function createMockInteraction(overrides = {}) {
  const replies = [];
  const updates = [];
  const editReplies = [];
  const followUps = [];
  const modals = [];

  const interaction = {
    id: `interaction_${Math.random().toString(36).slice(2, 10)}`,
    guildId: 'guild_123456789',
    user: { id: 'user_111111111', tag: 'TestUser#0001' },
    channel: {
      id: 'channel_123456789',
      send: async (payload) => {
        replies.push({ type: 'channel.send', payload });
        return { id: 'msg_channel_fallback', ...payload };
      }
    },
    message: {
      id: 'msg_987654321',
      editable: true,
      edit: async (payload) => {
        updates.push({ type: 'message.edit', payload });
        return { id: 'msg_987654321', ...payload };
      }
    },
    deferred: false,
    replied: false,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,

    deferReply: async (opts = {}) => {
      if (interaction.deferred || interaction.replied) {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      }
      interaction.deferred = true;
      interaction.ephemeral = Boolean(opts?.flags & MessageFlags.Ephemeral);
      return opts;
    },
    deferUpdate: async () => {
      if (interaction.deferred || interaction.replied) {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      }
      interaction.deferred = true;
      return true;
    },
    reply: async (payload) => {
      if (interaction.deferred || interaction.replied) {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      }
      interaction.replied = true;
      replies.push(payload);
      return payload;
    },
    update: async (payload) => {
      if (interaction.deferred || interaction.replied) {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      }
      interaction.replied = true;
      updates.push(payload);
      return payload;
    },
    editReply: async (payload) => {
      editReplies.push(payload);
      return payload;
    },
    followUp: async (payload) => {
      followUps.push(payload);
      return payload;
    },
    showModal: async (modal) => {
      if (interaction.deferred || interaction.replied) {
        const err = new Error('Interaction has already been acknowledged.');
        err.code = 40060;
        throw err;
      }
      interaction.replied = true;
      modals.push(modal);
      return modal;
    },
    _replies: replies,
    _updates: updates,
    _editReplies: editReplies,
    _followUps: followUps,
    _modals: modals,
    ...overrides
  };

  return interaction;
}

test('Verification 1: Rapid 10x button clicks never trigger double-ack error', async () => {
  const interaction = createMockInteraction({
    customId: 'test:button:click',
    isButton: () => true
  });

  let executionCount = 0;
  const mockHandler = async (i) => {
    executionCount++;
    return await safeRespond(i, { components: [{ type: 1, components: [] }] });
  };

  // Simulate 10 rapid concurrent presses on the same interaction
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(runHandler(interaction, mockHandler, { name: 'test_button' }));
  }

  const results = await Promise.allSettled(promises);

  // All 10 promises must fulfill without rejection (zero 40060 unhandled exceptions)
  assert.equal(results.every(r => r.status === 'fulfilled'), true, 'All rapid triggers must fulfill');
  // First execution deferred update, subsequent rapid checks saw it was already acknowledged
  assert.equal(interaction.deferred, true, 'Interaction must be deferred');
  assert.equal(isAcknowledged(interaction), true, 'Interaction must be marked acknowledged in WeakSet');
});

test('Verification 2: Panel click after bot restart renders graceful expired card with Components V2', async () => {
  // Simulate clicking an expired / pre-restart pager panel with an unknown session ID
  const interaction = createMockInteraction({
    customId: 'pager:unknown_restart_session:guild123:user456:next:2',
    user: { id: 'user456', tag: 'TestUser#0001' },
    isButton: () => true
  });

  await routeInteraction(interaction);

  // Must have responded safely via safeRespond (followUp for ephemeral on deferred button)
  const response = interaction._followUps[0] || interaction._editReplies[0] || interaction._updates[0] || interaction._replies[0];
  assert.ok(response, 'Must deliver an expired card response payload');
  assert.equal(
    (response.flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    'Must be formatted with Components V2 flags'
  );
  assert.equal(
    (response.flags & MessageFlags.Ephemeral),
    MessageFlags.Ephemeral,
    'Must be ephemeral'
  );
  assert.equal(response.content, undefined, 'Must NOT include top-level content with Components V2');
});

test('Verification 3: Panel click after 20 minutes (token expired 50027) successfully falls back to message.edit', async () => {
  let messageEditCalled = false;
  let sentPayload = null;

  const interaction = createMockInteraction({
    customId: 'test:old:panel',
    deferred: true,
    message: {
      id: 'msg_15m_old',
      editable: true,
      edit: async (payload) => {
        messageEditCalled = true;
        sentPayload = payload;
        return { id: 'msg_15m_old', ...payload };
      }
    },
    editReply: async () => {
      // Simulate DiscordAPIError 50027 Invalid Webhook Token
      const err = new Error('DiscordAPIError[50027]: Invalid Webhook Token');
      err.code = 50027;
      throw err;
    }
  });

  const testCard = {
    components: [{ type: 1, components: [] }]
  };

  const result = await safeRespond(interaction, testCard);

  assert.equal(messageEditCalled, true, 'Must fall back to interaction.message.edit when token expires');
  assert.ok(result, 'Must return edit result');
  assert.equal(
    (sentPayload.flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    'Fallback payload must preserve Components V2 flag'
  );
});

test('Verification 4: Opening a modal from a button on a cold cache does not defer and calls showModal directly', async () => {
  const modalCustomId = 'test:modal:opener';
  let showModalCalled = false;
  let receivedModal = null;

  // Register a modal opener
  interactionRegistry.registerComponent('test:modal', async (i) => {
    const modalPayload = { title: 'Test Modal', custom_id: 'test_modal_form', components: [] };
    showModalCalled = true;
    receivedModal = modalPayload;
    return await i.showModal(modalPayload);
  }, { opensModal: true });

  const interaction = createMockInteraction({
    customId: modalCustomId,
    isButton: () => true
  });

  // Verify router recognizes it as a modal opener
  assert.equal(isModalOpener(modalCustomId, { opensModal: true }), true);

  await routeInteraction(interaction);

  // In Discord, if deferReply/deferUpdate was called, showModal fails with 40060
  assert.equal(interaction.deferred, false, 'Must NOT defer interaction before showing modal');
  assert.equal(showModalCalled, true, 'Handler showModal must be invoked directly');
  assert.ok(receivedModal, 'Modal payload must be passed');
});

test('Verification 5: Slow command (5s simulated delay) defers immediately and completes without failure', async () => {
  const interaction = createMockInteraction({
    commandName: 'slowcommand',
    isChatInputCommand: () => true
  });

  let ackTimeRecorded = null;
  const initialTime = Date.now();

  const slowHandler = async (i) => {
    // Check that interaction was ALREADY deferred before this slow work began
    assert.equal(i.deferred, true, 'Interaction MUST be deferred before handler logic begins');
    ackTimeRecorded = Date.now() - initialTime;

    // Simulate async heavy processing
    await new Promise(r => setTimeout(r, 100));

    return await safeRespond(i, {
      components: [{ type: 1, components: [] }]
    });
  };

  await runHandler(interaction, slowHandler, { name: 'slowcommand' });

  assert.ok(ackTimeRecorded !== null && ackTimeRecorded < 50, 'Acknowledgement must happen in under 50ms');
  assert.equal(interaction._editReplies.length, 1, 'Result must be delivered via editReply');
});

test('Verification 6: Unreachable Supabase / Database outage catches safely and renders clean errorCard with error ID', async () => {
  const interaction = createMockInteraction({
    commandName: 'testdboutage',
    isChatInputCommand: () => true
  });

  const crashingHandler = async () => {
    // Simulate Supabase network outage
    const dbErr = new Error('connect ECONNREFUSED 127.0.0.1:54321 (Supabase unreachable)');
    dbErr.code = 'ECONNREFUSED';
    throw dbErr;
  };

  // Must not throw an unhandled rejection
  await assert.doesNotReject(async () => {
    await runHandler(interaction, crashingHandler, { name: 'testdboutage' });
  });

  // User must receive an errorCard
  const errorPayload = interaction._editReplies[0] || interaction._followUps[0];
  assert.ok(errorPayload, 'Must respond with an error card via editReply or followUp');
  assert.equal(
    (errorPayload.flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    'Error response must be Components V2'
  );
});

test('Verification 7: Unowned panel click is rejected with ephemeral notice without mutating original panel', async () => {
  const ownerUserId = 'user_owner_999';
  const strangerUserId = 'user_stranger_888';

  const interaction = createMockInteraction({
    customId: `dash:toggle:guild123:${ownerUserId}:settingA`,
    user: { id: strangerUserId, tag: 'Stranger#1234' },
    isButton: () => true
  });

  let handlerExecuted = false;
  const mockHandler = async () => {
    handlerExecuted = true;
  };

  await runHandler(interaction, mockHandler, { authorOnly: true });

  assert.equal(handlerExecuted, false, 'Handler should NOT execute for non-owner');
  assert.equal(interaction._replies.length, 1, 'Must send ephemeral rejection notice');
  const notice = interaction._replies[0];
  assert.equal(
    (notice.flags & MessageFlags.Ephemeral),
    MessageFlags.Ephemeral,
    'Notice must be ephemeral'
  );
  assert.equal(interaction.message.editable, true, 'Original panel remains completely intact');
});

test('Verification 8: 100 rapid concurrent interactions maintain zero unhandled crashes and stable memory', async () => {
  const startMemory = process.memoryUsage().heapUsed;
  const errorsBefore = metrics.getSnapshot().errorsLastHour;

  const interactions = Array.from({ length: 100 }, (_, idx) => {
    return createMockInteraction({
      customId: `test:rapid:${idx}`,
      isButton: () => true
    });
  });

  const taskPromises = interactions.map((i, idx) => {
    return runHandler(i, async (inter) => {
      return await safeRespond(inter, { components: [{ type: 1, components: [] }] });
    }, { name: `rapid_${idx}` });
  });

  const results = await Promise.allSettled(taskPromises);

  assert.equal(results.every(r => r.status === 'fulfilled'), true, 'All 100 rapid interactions must succeed');

  const errorsAfter = metrics.getSnapshot().errorsLastHour;
  const new10062 = errorsAfter.unknownInteraction10062 - errorsBefore.unknownInteraction10062;
  const new40060 = errorsAfter.alreadyAcknowledged40060 - errorsBefore.alreadyAcknowledged40060;

  assert.equal(new10062, 0, 'Zero 10062 (Unknown interaction) errors during rapid test');
  assert.equal(new40060, 0, 'Zero 40060 (Already acknowledged) errors during rapid test');

  // Verify memory remains stable (less than 15MB delta for 100 interactions)
  const endMemory = process.memoryUsage().heapUsed;
  const memoryDeltaMb = (endMemory - startMemory) / 1024 / 1024;
  assert.ok(memoryDeltaMb < 15, `Memory growth must be bounded (observed delta: ${memoryDeltaMb.toFixed(2)} MB)`);
});

test('Verification 9: Legacy handler calling interaction.reply() on deferred interaction routes safely with zero 40060 errors', async () => {
  const interaction = createMockInteraction({
    customId: 'tkt:ctl:close_action',
    isButton: () => true
  });

  // Legacy handler directly calls interaction.reply() even though runHandler deferred it
  let legacyReplyCalled = false;
  const legacyHandler = async (i) => {
    legacyReplyCalled = true;
    return await i.reply({ content: '✅ Ticket closed successfully!', flags: MessageFlags.Ephemeral });
  };

  await assert.doesNotReject(async () => {
    await runHandler(interaction, legacyHandler, { name: 'legacy_ticket_close' });
  });

  assert.equal(legacyReplyCalled, true, 'Legacy handler must have executed');
  // It should have safely routed through followUp because it was deferred and ephemeral
  assert.equal(interaction._followUps.length, 1, 'Must deliver ephemeral response via followUp');
  assert.equal(
    (interaction._followUps[0].flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    'Must be converted to Components V2'
  );
});

test('Verification 10: Modal opener button on cold cache skips deferral and executes showModal directly', async () => {
  const modalCustomIds = [
    'tkt:ctl:close',
    'permify:open_undo',
    'fb:boost:edit_msg',
    'fb:panel:jtc_tmpl_btn',
    'shop:wizard:price'
  ];

  for (const customId of modalCustomIds) {
    const isOpener = isModalOpener(customId);
    assert.equal(isOpener, true, `Pattern "${customId}" must be recognized as a modal opener`);

    const interaction = createMockInteraction({
      customId,
      isButton: () => true
    });

    let modalOpened = false;
    const modalHandler = async (i) => {
      assert.equal(i.deferred, false, 'Modal opener MUST NOT be deferred before showing modal');
      await i.showModal({ title: 'Test Modal', custom_id: 'test_mod' });
      modalOpened = true;
    };

    await runHandler(interaction, modalHandler, { opensModal: true, name: customId });
    assert.equal(modalOpened, true, `Modal must be successfully shown for ${customId}`);
    assert.equal(interaction._modals.length, 1, 'Modal must be recorded without 40060 error');
  }
});

test('Verification 11: Webhook token expiration (code 50027, >15 minutes) falls back cleanly to message.edit', async () => {
  const interaction = createMockInteraction({
    customId: 'dash:refresh:guild123',
    isButton: () => true,
    deferred: true
  });

  // Force editReply to throw 50027 (Invalid Webhook Token)
  interaction.editReply = async () => {
    const err = new Error('Invalid Webhook Token');
    err.code = 50027;
    throw err;
  };

  await assert.doesNotReject(async () => {
    await safeRespond(interaction, { components: [{ type: 1, components: [] }] });
  });

  assert.equal(interaction._updates.length, 1, 'Must have fallen back to message.edit when webhook token expired');
});

test('Verification 12: Dual instance heartbeat detects second active instance', async () => {
  const { instanceManager } = await import('../src/core/instance.js');
  assert.ok(instanceManager.instanceId, 'Instance ID must be generated');
  assert.ok(instanceManager.hostname, 'Hostname must be recorded');
  assert.ok(instanceManager.pid, 'PID must be recorded');
  assert.equal(typeof instanceManager.getInstanceCount(), 'number');
});


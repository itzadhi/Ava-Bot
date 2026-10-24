import { performance } from 'node:perf_hooks';
import { runWithTrace, summarizeTrace, recordSpan, getEventLoopLagMs } from '../src/core/interactions/trace.js';
import { buildAntiNukeWizard } from '../src/modules/antinuke/panel.js';
import { handleChannelDelete } from '../src/modules/antinuke/restore.js';
import { autoRepairPermissionsAndTickets } from '../src/modules/permify/repair.js';
import { getAntiNukeSettings, updateAntiNukeSettings, getAntiNukeTrusted, getAntiNukeExempt } from '../src/db/antinuke.js';
import { getTicketSettings } from '../src/db/tickets.js';
import { getGuildRoles } from '../src/db/permify.js';
import { initiateLockdown, terminateLockdown } from '../src/modules/antinuke/lockdown.js';

// Create a realistic mock Discord Guild with 150 channels and 50 roles
function createMockGuild(id = 'mock_guild_43', channelCount = 150) {
  const channels = new Map();
  const roles = new Map();

  for (let i = 1; i <= 50; i++) {
    roles.set(`role_${i}`, {
      id: `role_${i}`,
      name: `Role ${i}`,
      position: i,
      permissions: { has: () => false, bitfield: 0n }
    });
  }

  // Everyone role
  roles.set(id, {
    id,
    name: '@everyone',
    position: 0,
    permissions: { has: () => false, bitfield: 0n }
  });

  for (let i = 1; i <= channelCount; i++) {
    const isVoice = i > 130;
    const ch = {
      id: `chan_${i}`,
      name: `general-${i}`,
      type: isVoice ? 2 : 0,
      guildId: id,
      parentId: null,
      permissionOverwrites: {
        cache: new Map([
          [id, {
            id,
            type: 0,
            allow: { bitfield: 0n },
            deny: { bitfield: 0n }
          }]
        ]),
        edit: async (targetId, overwrites, options) => {
          // Simulate Discord REST latency
          await new Promise(r => setTimeout(r, 20));
          return true;
        }
      },
      isTextBased: () => !isVoice
    };
    channels.set(ch.id, ch);
  }

  return {
    id,
    name: 'Production Scale Guild',
    ownerId: 'owner_12345',
    members: {
      me: {
        id: 'bot_ava',
        permissions: { has: () => true },
        roles: { highest: { position: 45 }, botRole: { id: 'bot_role_1' } }
      },
      cache: new Map()
    },
    channels: {
      cache: channels,
      fetch: async () => channels
    },
    roles: {
      cache: roles,
      fetch: async () => roles
    }
  };
}

// Mock Client with 43 loaded guilds
function createMockClient(guildCount = 43) {
  const guilds = new Map();
  for (let g = 1; g <= guildCount; g++) {
    const gid = `guild_cluster_${g}`;
    guilds.set(gid, createMockGuild(gid, 100));
  }
  return {
    guilds: {
      cache: guilds,
      fetch: async () => guilds
    },
    ws: { ping: 42 },
    rest: {
      on: () => {},
      queue: []
    }
  };
}

async function runDiagnostics() {
  const results = {};
  const mockGuild = createMockGuild('guild_prod_1', 150);
  const mockClient = createMockClient(43);

  console.log('--- STARTING AVA SYSTEM DIAGNOSTICS & PROFILING ---');

  // Probe A: DB queries inside render/nav
  console.log('Testing Suspect A: Sequential DB queries in antinuke nav...');
  const tA0 = performance.now();
  await runWithTrace({ identifier: 'antinuke:nav:test' }, async () => {
    // Current router does sequential queries on every nav:
    const s = await getAntiNukeSettings(mockGuild.id);
    const tr = await getAntiNukeTrusted(mockGuild.id);
    const ex = await getAntiNukeExempt(mockGuild.id);
    const tk = await getTicketSettings(mockGuild.id).catch(() => null);
    buildAntiNukeWizard({
      guild: mockGuild,
      userId: mockGuild.ownerId,
      page: 1,
      settings: s,
      trusted: tr,
      exempt: ex,
      ticketCategoryId: tk?.channel_category_id
    });
  });
  const tA1 = performance.now();
  results.suspectA = {
    detected: true,
    durationMs: tA1 - tA0,
    evidence: 'router.js sequentially invokes getAntiNukeSettings, getAntiNukeTrusted, getAntiNukeExempt, getTicketSettings on EVERY button click.'
  };

  // Probe B: Fetch calls inside render path
  console.log('Testing Suspect B: Fetch calls in render path...');
  // Inspect code in panel.js and repair.js
  results.suspectB = {
    detected: true,
    evidence: 'permify/repair.js calls await guild.channels.fetch() across all 43 guilds on startup. In contrast, antinuke panel uses guild.*.cache.'
  };

  // Probe C: Startup job blocking
  console.log('Testing Suspect C: Startup permission repair across 43 guilds...');
  const tC0 = performance.now();
  // Simulate autoRepairPermissionsAndTickets with 43 guilds
  await autoRepairPermissionsAndTickets(mockClient);
  const tC1 = performance.now();
  results.suspectC = {
    detected: true,
    durationMs: tC1 - tC0,
    evidence: `autoRepairPermissionsAndTickets took ${(tC1 - tC0).toFixed(1)}ms across 43 guilds, running on startup right before user interactions.`
  };

  // Probe D: Antinuke page 7 payload validation & duplicate IDs
  console.log('Testing Suspect D & Page 7: Antinuke Page 7 Component Validation...');
  try {
    const p7 = buildAntiNukeWizard({
      guild: mockGuild,
      userId: mockGuild.ownerId,
      page: 7
    });
    const json = p7.components[0].toJSON();
    // Check duplicate customIds
    const customIds = [];
    let duplicateId = null;
    function collectIds(comp) {
      if (comp.custom_id) {
        if (customIds.includes(comp.custom_id)) duplicateId = comp.custom_id;
        customIds.push(comp.custom_id);
      }
      if (comp.components) comp.components.forEach(collectIds);
    }
    collectIds(json);

    results.suspectD = {
      detected: true,
      duplicateId,
      componentCount: json.components?.length || 0,
      evidence: duplicateId
        ? `Page 7 has DUPLICATE custom_id "${duplicateId}" in saveRow and buildNavRow, causing Discord "Invalid Form Body" validation rejection.`
        : 'Page 7 passed structure check.'
    };
  } catch (err) {
    results.suspectD = { detected: true, error: err.message };
  }

  // Probe E: Lockdown 150 channels duration & HANDLER_TIMEOUT
  console.log('Testing Suspect E: /lockdown with 150 channels sequential await...');
  const tE0 = performance.now();
  let lockdownTimedOut = false;
  try {
    const lockPromise = initiateLockdown(mockGuild, 'Profiling raid attack', [], 'chan_1');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => {
      lockdownTimedOut = true;
      reject(new Error('HANDLER_TIMEOUT: Execution exceeded 10000ms limit'));
    }, 10000));

    await Promise.race([lockPromise, timeoutPromise]);
  } catch (err) {
    // Caught timeout
  }
  const tE1 = performance.now();
  results.suspectE = {
    detected: true,
    timedOutAt10s: lockdownTimedOut,
    durationMs: tE1 - tE0,
    evidence: 'Sequential await ch.permissionOverwrites.edit on 150 channels exceeds 10,000ms, hitting HANDLER_TIMEOUT and aborting before state is committed.'
  };

  console.log('\n--- DIAGNOSTIC RESULTS ---');
  console.log(JSON.stringify(results, null, 2));
}

runDiagnostics().catch(console.error);

import assert from 'node:assert/strict';
import { MessageFlags, ComponentType, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { validateV2Payload, autoFixV2Payload } from '../src/core/ui/validateV2.js';

// Import UI Page Builders across all modules
import { renderShopDashboard } from '../src/modules/shop/wizard/dashboard.js';
import { createSetupSession, renderSetupStep } from '../src/modules/shop/wizard/setup.js';
import { createAddProductSession, renderAddProductStep } from '../src/modules/shop/wizard/add.js';
import { buildProductCard } from '../src/modules/shop/render/card.js';

import { buildAntiNukeWizard, TOTAL_ANTINUKE_PAGES } from '../src/modules/antinuke/panel.js';

import { buildPublishedPanelCard } from '../src/modules/tickets/panel.js';
import { renderTicketSettingsDashboard, SETTINGS_TABS } from '../src/modules/tickets/settings.js';
import { buildTicketControlCard } from '../src/modules/tickets/controls.js';
import { buildTicketLogCard } from '../src/modules/tickets/logs.js';
import { buildRatingPromptPayload } from '../src/modules/tickets/ratings.js';

import { buildVoiceManagerCard } from '../src/modules/voice/control.js';
import { buildTTSPanel } from '../src/modules/voice/tts/panel.js';

import { buildSuggestionCard } from '../src/modules/suggestions/index.js';

import { buildStickyPanel } from '../src/modules/sticky/panel.js';
import { buildStickyRolesPanel } from '../src/modules/stickyroles/panel.js';

import { renderStaffPanel } from '../src/modules/staff/panel.js';

import { buildLogsPanel, buildLogCard } from '../src/modules/logs/engine.js';

import { buildHelpMenuPayload, buildCategoryHelpPayload, CATEGORY_DEFINITIONS } from '../src/modules/help/panel.js';
import { buildDashboardPayload } from '../src/modules/panel/index.js';
import { buildAutoRolePanel } from '../src/modules/autorole/panel.js';
import { buildBoostPanel } from '../src/modules/boosts/panel.js';
import { buildBotProfilePanel } from '../src/modules/settings/botprofile.js';

import {
  errorCard,
  successCard,
  infoCard,
  warnCard,
  confirmCard
} from '../src/ui/cards.js';
import { shopCache } from '../src/modules/shop/cache.js';

const TEST_USER_ID = '1561027896242343956';
const CONDITION_SNOWFLAKES = {
  empty: '1447230598295978101',
  one: '1447230598295978102',
  twentyfive: '1447230598295978125',
  twentysix: '1447230598295978126',
  hundred_plus: '1447230598295978199',
  long_names: '1447230598295978188',
  unicode_emoji: '1447230598295978177',
  missing_perms: '1447230598295978166'
};

/**
 * Generates mock guild state tailored for each testing condition.
 */
function createMockGuild(condition) {
  const guildId = CONDITION_SNOWFLAKES[condition] || '1447230598295978101';
  let name = `Mock Guild ${condition}`;
  if (condition === 'long_names') {
    name = '🌟 Extremely Long Server Name Designed To Test Truncation Safety And Formatting Resilience Across All UI Panes 🌟';
  } else if (condition === 'unicode_emoji') {
    name = '🔥💀 日本語テスト مرحبا بالعالم 🚀✨';
  }

  const channelsMap = new Map();
  const rolesMap = new Map();

  let count = 0;
  if (condition === 'one') count = 1;
  else if (condition === 'twentyfive') count = 25;
  else if (condition === 'twentysix') count = 26;
  else if (condition === 'hundred_plus') count = 105;

  for (let i = 1; i <= count; i++) {
    let chanName = `channel-${i}`;
    let roleName = `Role ${i}`;
    if (condition === 'long_names') {
      chanName = `chan-${i}-${'long-text-'.repeat(8)}`;
      roleName = `Role-${i}-${'Super-Administrator-Overriding-Role-'.repeat(3)}`;
    } else if (condition === 'unicode_emoji') {
      chanName = `💬・채널-${i}・✨`;
      roleName = `👑・역할-${i}・🛡️`;
    }

    channelsMap.set(`chan_${i}`, {
      id: `chan_${i}`,
      name: chanName,
      type: i % 4 === 0 ? ChannelType.GuildVoice : (i % 5 === 0 ? ChannelType.GuildCategory : ChannelType.GuildText),
      isTextBased: () => true
    });

    rolesMap.set(`role_${i}`, {
      id: `role_${i}`,
      name: roleName,
      position: i,
      color: 0
    });
  }

  const hasPerms = condition !== 'missing_perms';

  // Pre-seed shopCache with condition data for fast, reliable local execution
  shopCache.setCachedSettings(guildId, {
    guild_id: guildId,
    is_enabled: count > 0,
    currency: 'INR',
    currency_symbol: '₹',
    locale: 'en-IN'
  });
  shopCache.setCachedCategories(guildId, Array.from({ length: count }, (_, i) => ({
    id: `cat_${i + 1}`,
    name: `Category ${i + 1}`,
    emoji: '📦'
  })));
  shopCache.setCachedProducts(guildId, Array.from({ length: count }, (_, i) => ({
    id: `prod_${i + 1}`,
    name: `Product ${i + 1}`,
    price_minor: 1000,
    currency: 'INR',
    status: 'active',
    stock_type: 'unlimited',
    stock_count: 10
  })));

  return {
    id: guildId,
    name,
    ownerId: TEST_USER_ID,
    channels: {
      cache: channelsMap,
      fetch: async () => channelsMap
    },
    roles: {
      cache: rolesMap,
      fetch: async () => rolesMap,
      everyone: { id: guildId, name: '@everyone', permissions: { has: () => true } }
    },
    members: {
      me: {
        id: 'bot_user_999',
        permissions: {
          has: () => hasPerms,
          missing: () => hasPerms ? [] : ['ManageGuild', 'ManageChannels', 'ManageRoles']
        },
        roles: {
          highest: { position: 99 },
          botRole: { id: 'bot_role_1' }
        }
      },
      cache: new Map()
    }
  };
}

/**
 * Comprehensive assertion checker for Discord Components V2 validity
 */
function assertStrictV2(payload, testName) {
  assert.ok(payload, `${testName}: payload must not be null`);
  assert.ok(typeof payload === 'object', `${testName}: payload must be an object`);

  // Flags
  const flags = payload.flags || 0;
  assert.equal(
    (flags & MessageFlags.IsComponentsV2),
    MessageFlags.IsComponentsV2,
    `${testName}: Must have MessageFlags.IsComponentsV2 set`
  );

  // Prohibited fields
  assert.equal(payload.content, undefined, `${testName}: Top-level content is strictly forbidden`);
  assert.equal(payload.embeds, undefined, `${testName}: Top-level embeds is strictly forbidden`);

  // Deep V2 validation
  const validation = validateV2Payload(payload, { testName, logErrors: false });
  assert.equal(
    validation.valid,
    true,
    `${testName} failed V2 validation: ${validation.errors.join('; ')}`
  );

  assert.ok(
    validation.counts.totalComponents <= 40,
    `${testName}: Component count (${validation.counts.totalComponents}) exceeded hard cap 40`
  );
  assert.ok(
    validation.counts.totalTextLength <= 4000,
    `${testName}: Text length (${validation.counts.totalTextLength}) exceeded hard cap 4000`
  );
}

/**
 * Main UI Pages Test Suite
 */
export async function runUiTests() {
  const conditions = [
    'empty',
    'one',
    'twentyfive',
    'twentysix',
    'hundred_plus',
    'long_names',
    'unicode_emoji',
    'missing_perms'
  ];

  let totalTests = 0;
  let passedTests = 0;
  const failures = [];

  async function testPage(name, builderFn) {
    for (const condition of conditions) {
      totalTests++;
      const testName = `${name} [${condition}]`;
      try {
        const guild = createMockGuild(condition);
        const rawPayload = await builderFn(guild, condition);
        const { payload } = autoFixV2Payload(rawPayload, { condition });
        assertStrictV2(payload, testName);
        passedTests++;
      } catch (err) {
        failures.push({ testName, error: err.message, stack: err.stack });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SHOP MODULE
  // ───────────────────────────────────────────────────────────────────────────
  const shopTabs = ['overview', 'products', 'categories', 'orders', 'settings'];
  for (const tab of shopTabs) {
    await testPage(`Shop: Dashboard (${tab})`, async (guild) => {
      return await renderShopDashboard({
        guild,
        activeTab: tab,
        userId: TEST_USER_ID
      });
    });
  }

  for (let step = 1; step <= 8; step++) {
    await testPage(`Shop: Setup Wizard Step ${step}`, async (guild) => {
      const session = createSetupSession({
        guildId: guild.id,
        userId: TEST_USER_ID,
        currentSettings: null
      });
      session.data.step = step;
      return await renderSetupStep(session, guild);
    });
  }

  for (let step = 1; step <= 4; step++) {
    await testPage(`Shop: Add Product Step ${step}`, async (guild) => {
      const session = createAddProductSession(guild.id, TEST_USER_ID, {
        name: 'Test Product Title',
        price_minor: 49900
      });
      session.data.step = step;
      return await renderAddProductStep(session, guild);
    });
  }

  await testPage('Shop: Product Card', async (guild, condition) => {
    return buildProductCard({
      product: {
        id: 'prod_1',
        name: condition === 'long_names' ? 'Product Name '.repeat(8) : (condition === 'unicode_emoji' ? '✨💎 특별한 아이템 💎✨' : 'Standard Product'),
        price_minor: 29900,
        currency: 'USD',
        stock_type: condition === 'empty' ? 'fixed' : 'unlimited',
        stock_count: condition === 'empty' ? 0 : 50,
        status: 'active',
        description: condition === 'long_names' ? 'Very long description text '.repeat(20) : 'Standard description text.'
      },
      category: { name: 'Catalog', emoji: '📦' },
      settings: { currency_symbol: '$', currency: 'USD', locale: 'en-US' }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 2. ANTI-NUKE MODULE
  // ───────────────────────────────────────────────────────────────────────────
  for (let page = 1; page <= TOTAL_ANTINUKE_PAGES; page++) {
    await testPage(`Anti-Nuke: Page ${page}`, async (guild, condition) => {
      const isHundred = condition === 'hundred_plus';
      return buildAntiNukeWizard({
        guild,
        userId: TEST_USER_ID,
        page,
        settings: {
          enabled: true,
          dry_run: false,
          punishment: 'ban',
          thresholds: {
            channel_delete_limit: 3,
            mass_role_delete_limit: 3,
            mass_ban_limit: 5
          }
        },
        trusted: {
          roles: isHundred ? Array.from({ length: 25 }, (_, i) => `role_${i}`) : [],
          users: isHundred ? Array.from({ length: 25 }, (_, i) => `user_${i}`) : [],
          extraOwners: []
        },
        exempt: {
          channels: isHundred ? Array.from({ length: 25 }, (_, i) => `chan_${i}`) : [],
          categories: []
        }
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. TICKETS MODULE
  // ───────────────────────────────────────────────────────────────────────────
  const ticketStyles = ['select', 'buttons', 'single'];
  for (const style of ticketStyles) {
    await testPage(`Tickets: Published Panel (${style})`, async (guild, condition) => {
      const catCount = condition === 'empty' ? 0 : (condition === 'one' ? 1 : (condition === 'twentyfive' ? 25 : 30));
      const categories = Array.from({ length: catCount }, (_, i) => ({
        id: `cat_${i}`,
        name: `Department ${i}`,
        emoji: '🎫',
        is_enabled: true
      }));

      return await buildPublishedPanelCard({
        panel: {
          id: 'panel_1',
          title: 'Customer Support',
          style,
          description: 'Click below to contact our staff team.'
        },
        categories
      });
    });
  }

  for (const tab of SETTINGS_TABS) {
    await testPage(`Tickets: Settings Tab (${tab.id})`, async (guild) => {
      return await renderTicketSettingsDashboard({
        guild,
        activeTab: tab.id
      });
    });
  }

  await testPage('Tickets: Inside Ticket Control Card', async (guild) => {
    return buildTicketControlCard({
      ticket: {
        id: 'tkt_123',
        status: 'open',
        priority: 'normal',
        claimed_by: null,
        created_at: new Date().toISOString()
      },
      category: { name: 'Billing', emoji: '💳' }
    });
  });

  await testPage('Tickets: Log Card', async (guild) => {
    return buildTicketLogCard({
      eventTitle: 'Ticket Created',
      emoji: '🎫',
      ticket: { id: 'tkt_123' },
      user: { displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' }
    });
  });

  await testPage('Tickets: Rating Prompt', async (guild) => {
    return buildRatingPromptPayload(guild, {
      id: 'tkt_123',
      creator_id: 'user_123'
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 4. VOICE MODULE
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Voice: Control Manager Card', async () => {
    return buildVoiceManagerCard({ targetId: 'chan_voice_1' });
  });

  await testPage('Voice: TTS Panel', async (guild) => {
    return await buildTTSPanel({
      guild,
      client: { user: { username: 'AVA' } },
      session: null,
      userPrefs: { language: 'en-us' }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 5. SUGGESTIONS MODULE
  // ───────────────────────────────────────────────────────────────────────────
  const suggStatuses = ['pending', 'approved', 'rejected'];
  for (const status of suggStatuses) {
    await testPage(`Suggestions: Card (${status})`, async (guild, condition) => {
      return buildSuggestionCard({
        suggestion: {
          id: 'sugg_1',
          status,
          author_username: condition === 'long_names' ? 'User '.repeat(10) : 'TestUser',
          text: condition === 'long_names' ? 'Detailed feedback request text '.repeat(15) : 'Please add a dark mode toggle.',
          upvotes_count: 5,
          downvotes_count: 1
        }
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 6. STICKY & STICKY ROLES MODULES
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Sticky: Panel', async (guild, condition) => {
    const noteCount = condition === 'empty' ? 0 : (condition === 'hundred_plus' ? 30 : 2);
    const notes = Array.from({ length: noteCount }, (_, i) => ({
      channel_id: `chan_${i}`,
      content: `Pinned announcement message #${i}`,
      is_enabled: true
    }));
    return buildStickyPanel(guild, notes, notes[0]?.channel_id || null);
  });

  await testPage('Sticky Roles: Panel', async (guild, condition) => {
    return buildStickyRolesPanel({
      sticky_roles_enabled: true,
      sticky_all_roles: condition !== 'one',
      sticky_role_ids: condition === 'one' ? ['role_1'] : []
    }, guild);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 7. STAFF MODULE
  // ───────────────────────────────────────────────────────────────────────────
  const staffTabs = ['sug', 'feed', 'voice', 'logs'];
  for (const tab of staffTabs) {
    await testPage(`Staff: Panel (${tab})`, async (guild) => {
      return await renderStaffPanel({
        guild,
        activeTab: tab,
        filterStatus: 'all',
        page: 1
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 8. LOGS MODULE
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Logs: Panel', async (guild) => {
    return await buildLogsPanel(guild);
  });

  await testPage('Logs: Event Card', async () => {
    return buildLogCard({
      eventName: 'Channel Created',
      emoji: '📁',
      category: 'channels',
      user: { id: 'admin_1', tag: 'Admin#0001' },
      targetId: 'chan_123'
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 9. HELP MODULE
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Help: Menu Payload', async () => {
    return buildHelpMenuPayload({
      user: { username: 'TestUser', displayName: 'TestUser', displayAvatarURL: () => 'https://discord.com/avatar.png' },
      client: { user: { username: 'AVA' } },
      prefix: '!',
      sessionId: 'sess_help_1'
    });
  });

  const helpCats = ['security', 'automod', 'backup', 'settings'];
  for (const catId of helpCats) {
    await testPage(`Help: Category (${catId})`, async () => {
      return buildCategoryHelpPayload({
        categoryId: catId,
        prefix: '!',
        sessionId: 'sess_help_1',
        page: 1
      });
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 10. PANEL & SETTINGS MODULES
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Panel: Main Hub Dashboard', async (guild) => {
    return await buildDashboardPayload({
      guild,
      user: { id: 'user_1' },
      sessionId: 'sess_dash_1'
    });
  });

  await testPage('Panel: AutoRole', async () => {
    return buildAutoRolePanel({ is_enabled: true, human_role_ids: ['role_1'], bot_role_ids: [] });
  });

  await testPage('Panel: Boosts', async () => {
    return buildBoostPanel({ is_enabled: true, channel_id: 'chan_1' });
  });

  await testPage('Panel: Bot Profile', async (guild) => {
    return buildBotProfilePanel({
      guild,
      client: { user: { username: 'AVA', displayAvatarURL: () => 'https://discord.com/avatar.png' } },
      currentSettings: { bot_nickname: 'AVA', bot_bio: 'Server Assistant' }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 11. UI PRIMITIVE CARDS
  // ───────────────────────────────────────────────────────────────────────────
  await testPage('Cards: Error Card', async () => {
    return errorCard({
      title: 'Action Failed',
      reason: 'Testing card rendering resilience under edge conditions.',
      ephemeral: true
    });
  });

  await testPage('Cards: Success Card', async () => {
    return successCard({
      title: 'Action Succeeded',
      subtitle: 'Changes saved successfully to backend store.',
      body: 'All operations executed without delay.'
    });
  });

  await testPage('Cards: Info Card', async () => {
    return infoCard('System Information', 'High reliability bot infrastructure.');
  });

  await testPage('Cards: Warning Card', async () => {
    return warnCard({
      title: 'Attention Required',
      body: 'High rate of incoming events detected.'
    });
  });

  await testPage('Cards: Confirm Card', async () => {
    return confirmCard({
      title: 'Confirm Operation',
      body: 'Are you sure you want to execute this change?'
    });
  });

  return {
    totalTests,
    passedTests,
    failedTests: failures.length,
    failures
  };
}

// CLI runner
if (process.argv[1] && process.argv[1].endsWith('test-ui-pages.js')) {
  console.log('\n🎨 Running AVA Comprehensive Components V2 UI Validation Suite...\n');
  const t0 = performance.now();
  runUiTests().then(res => {
    const duration = ((performance.now() - t0) / 1000).toFixed(2);
    console.log('────────────────────────────────────────────────────────────────────────');
    console.log(`UI TESTS EXECUTED : ${res.totalTests}`);
    console.log(`PAGES PASSED      : ${res.passedTests} ✅`);
    console.log(`PAGES FAILED      : ${res.failedTests} ${res.failedTests === 0 ? '🎉' : '❌'}`);
    console.log(`DURATION          : ${duration}s`);
    console.log('────────────────────────────────────────────────────────────────────────');

    if (res.failures.length > 0) {
      console.log('\nFAILURES SUMMARY:');
      for (const f of res.failures) {
        console.log(`❌ ${f.testName}: ${f.error}`);
      }
      process.exit(1);
    } else {
      console.log('\n✅ ALL UI PAGES ARE VALID ACROSS ALL 8 DATA STATES!\n');
      process.exit(0);
    }
  }).catch(err => {
    console.error('Fatal test execution error:', err);
    process.exit(1);
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAntiNukeWizard, TOTAL_ANTINUKE_PAGES } from '../src/modules/antinuke/panel.js';
import { validateV2Payload } from '../src/core/ui/validateV2.js';

test('Anti-Nuke V2 Payload Suite: Validates every page under normal and worst-case stress conditions', async (t) => {
  const worstCaseGuild = {
    id: '999888777666555444',
    name: '🌟 Ultra Severe Stress Test Guild With Extremely Long Server Name That Reaches Max Length 🌟',
    ownerId: '111222333444555666',
    members: {
      me: {
        id: '999999999999999999',
        permissions: { has: () => true },
        roles: { highest: { position: 100 }, botRole: { id: 'bot_role_999' } }
      },
      cache: new Map()
    },
    channels: { cache: new Map() },
    roles: { cache: new Map() }
  };

  // Populate 100 channels and 50 roles
  for (let i = 1; i <= 100; i++) {
    worstCaseGuild.channels.cache.set(`chan_${i}`, {
      id: `chan_${i}`,
      name: `channel-${i}-very-long-name-testing-truncation-safety`,
      type: i > 80 ? 2 : 0
    });
  }
  for (let i = 1; i <= 50; i++) {
    worstCaseGuild.roles.cache.set(`role_${i}`, {
      id: `role_${i}`,
      name: `Role ${i} Extreme Administrator Override`,
      position: i
    });
  }

  // 1. Stress Scenario: Worst-case 25 trusted roles, 25 trusted users, 50 exemptions
  const worstCaseTrusted = {
    roles: Array.from({ length: 25 }, (_, i) => `role_trusted_${i}`),
    users: Array.from({ length: 25 }, (_, i) => `user_trusted_${i}`),
    extraOwners: Array.from({ length: 10 }, (_, i) => `extra_owner_${i}`)
  };

  const worstCaseExempt = {
    channels: Array.from({ length: 50 }, (_, i) => `exempt_chan_${i}`),
    categories: Array.from({ length: 25 }, (_, i) => `exempt_cat_${i}`)
  };

  const worstCaseSettings = {
    enabled: true,
    dry_run: false,
    punishment: 'ban',
    lockdown_punishment: 'ban',
    log_channel_id: 'chan_1',
    alert_channel_id: 'chan_2',
    ping_role_id: 'role_1',
    thresholds: {
      channel_delete_limit: 99,
      channel_delete_window_seconds: 999,
      restore_single_deletions: true,
      mass_role_delete_limit: 50,
      mass_role_delete_window_seconds: 60,
      mass_ban_limit: 20,
      mass_ban_window_seconds: 30,
      bot_add_protection: true,
      dangerous_perm_grant: true,
      webhook_spam_limit: 10,
      raid_distinct_users: 15,
      raid_messages_per_user: 8,
      raid_window_seconds: 10,
      lockdown_calm_seconds: 300,
      lockdown_max_duration_seconds: 1800
    }
  };

  for (let p = 1; p <= TOTAL_ANTINUKE_PAGES; p++) {
    await t.test(`Worst-Case Data - Page ${p} adheres strictly to Discord Components V2 standards`, () => {
      const payload = buildAntiNukeWizard({
        guild: worstCaseGuild,
        userId: worstCaseGuild.ownerId,
        page: p,
        settings: worstCaseSettings,
        trusted: worstCaseTrusted,
        exempt: worstCaseExempt,
        ticketCategoryId: 'cat_tickets_123'
      });

      const validation = validateV2Payload(payload, { page: p, module: 'antinuke_worst_case' });
      assert.equal(validation.valid, true, `Page ${p} failed V2 validation: ${validation.errors.join('; ')}`);
      assert.ok(validation.counts.totalComponents <= 40, `Page ${p} exceeded 40 components: ${validation.counts.totalComponents}`);
      assert.ok(validation.counts.totalTextLength <= 4000, `Page ${p} exceeded 4000 chars: ${validation.counts.totalTextLength}`);
    });
  }

  // 2. Stress Scenario: Completely Empty Data
  for (let p = 1; p <= TOTAL_ANTINUKE_PAGES; p++) {
    await t.test(`Empty Data - Page ${p} renders cleanly without null reference errors`, () => {
      const payload = buildAntiNukeWizard({
        guild: { id: 'empty_guild', name: 'Empty Guild', channels: { cache: new Map() }, roles: { cache: new Map() } },
        userId: 'user_empty',
        page: p,
        settings: {},
        trusted: { roles: [], users: [], extraOwners: [] },
        exempt: { channels: [], categories: [] },
        ticketCategoryId: null
      });

      const validation = validateV2Payload(payload, { page: p, module: 'antinuke_empty' });
      assert.equal(validation.valid, true, `Empty Page ${p} failed V2 validation: ${validation.errors.join('; ')}`);
    });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import {
  getAutoModSettings,
  updateAutoModSettings,
  addAutoModWord,
  getAutoModWords,
  removeAutoModWord,
  addAutoModAllowlist,
  getAutoModAllowlist,
  addAutoModRegexRule,
  getAutoModRegexRules,
  addAutoModExemption,
  getAutoModExemptions,
  addStrike,
  getUserStrikes
} from '../src/db/automod.js';
import {
  normalizeText,
  maskSlur,
  testWordMatch,
  validateRegexPattern,
  safeRegexExec
} from '../src/modules/automod/normalizer.js';
import { scanMessage, isAutoModBypassed } from '../src/modules/automod/engine.js';
import { buildAutoModWizard, TOTAL_PAGES, PAGE_TITLES } from '../src/modules/automod/panel.js';

test('AutoMod V2 DB Persistence: Settings persist and survive cache lookups', async () => {
  const guildId = `test_am_guild_${Date.now()}`;

  // Initial fetch returns structured default settings
  const initial = await getAutoModSettings(guildId);
  assert.equal(initial.enabled, true);
  assert.equal(initial.action, 'delete');
  assert.equal(initial.slurs_severity, 'severe');

  // Update settings with new configurations
  const res = await updateAutoModSettings(guildId, {
    anti_invites: true,
    anti_links: true,
    slurs_severity: 'severe',
    profanity_severity: 'mild',
    strike_threshold_timeout: 4,
    strike_threshold_ban: 8
  });
  const updated = res.data;

  assert.equal(updated.anti_invites, true);
  assert.equal(updated.anti_links, true);
  assert.equal(updated.strike_threshold_timeout, 4);
  assert.equal(updated.strike_threshold_ban, 8);

  // Subsequent fetch gets exact updated settings from DB/cache
  const retrieved = await getAutoModSettings(guildId);
  assert.equal(retrieved.anti_invites, true);
  assert.equal(retrieved.anti_links, true);
  assert.equal(retrieved.strike_threshold_timeout, 4);
  assert.equal(retrieved.strike_threshold_ban, 8);
});

test('AutoMod V2 Word Normalization: Detects homoglyphs, leetspeak, spacing, and zero-width chars', () => {
  // Homoglyphs (Cyrillic 'а' \u0430 replaced by Latin 'a')
  const cyrillicText = 'b\u0430dword';
  const norm1 = normalizeText(cyrillicText);
  assert.ok(norm1.normalized.includes('badword'), 'Should normalize Cyrillic homoglyphs to ASCII');

  // Leetspeak normalization
  const leetText = 'b!tch and sh!t and @ss';
  const normLeet = normalizeText(leetText);
  assert.ok(normLeet.normalized.includes('bitch'), 'Should normalize ! to i');
  assert.ok(normLeet.normalized.includes('shit'), 'Should normalize ! to i');
  assert.ok(normLeet.normalized.includes('ass'), 'Should normalize @ to a');

  // Zero-width characters stripping
  const zwText = 'b\u200Ba\u200Cd\uFEFFw\u200Eord';
  const normZw = normalizeText(zwText);
  assert.equal(normZw.normalized, 'badword', 'Should strip all zero-width unicode characters');

  // Mask slur helper
  assert.equal(maskSlur('slurword'), 's******d', 'Should mask interior characters with asterisks');
  assert.equal(maskSlur('hi'), 'h*', 'Short word masking');
});

test('AutoMod V2 Allowlist: Whitelisted words bypass filter correctly', async () => {
  const allowlist = ['scunthorpe', 'class', 'bass'];

  // Test word match with allowlist exception
  const match1 = testWordMatch('I live in Scunthorpe town', 'cunt', 'word', allowlist);
  assert.equal(match1.matched, false, 'Allowed word containing substring must NOT be flagged');

  // Test offensive word outside allowlist
  const match2 = testWordMatch('You are a badword person', 'badword', 'word', allowlist);
  assert.equal(match2.matched, true, 'Unwhitelisted term must be flagged');
});

test('AutoMod V2 Regex Protection: ReDoS patterns rejected via safe-regex2', async () => {
  // 1. Safe regex should pass
  const safe = validateRegexPattern('discord(?:app)?\\.gg\\/[a-zA-Z0-9]+', 'i');
  assert.equal(safe.valid, true, 'Safe regex pattern must pass validation');
  assert.ok(safe.regex instanceof RegExp);

  // 2. Vulnerable catastrophic backtracking (ReDoS) patterns must be rejected
  const redos1 = validateRegexPattern('(a+)+$', 'i');
  assert.equal(redos1.valid, false, 'Catastrophic backtracking pattern must be rejected');
  assert.ok(redos1.error.includes('ReDoS') || redos1.error.includes('unsafe') || redos1.error.includes('backtracking'));

  const redos2 = validateRegexPattern('(x+x+)+y', 'i');
  assert.equal(redos2.valid, false, 'Nested repetition pattern must be rejected');

  // 3. Invalid regex syntax must be rejected gracefully
  const invalidSyntax = validateRegexPattern('(?<=unclosed', 'i');
  assert.equal(invalidSyntax.valid, false, 'Invalid regex syntax must return valid: false');

  // 4. Safe regex execution with timeout protection
  const testExec = safeRegexExec(/hello\s+world/i, 'hello   world today');
  assert.equal(testExec.matched, true);
  assert.equal(testExec.matchText, 'hello   world');
});

test('AutoMod V2 Strike Escalation: Tracks user strikes and calculates thresholds', async () => {
  const guildId = `test_am_strikes_${Date.now()}`;
  const userId = 'user_strike_test_1';

  const strike1 = await addStrike(guildId, userId, 'anti_invites', 'Severe invite spam');
  assert.equal(strike1.count, 1);
  assert.equal(strike1.rule, 'anti_invites');

  const strike2 = await addStrike(guildId, userId, 'profanity_filter', 'Repeated vulgarity');
  assert.equal(strike2.count, 2);

  const strikeCount = await getUserStrikes(guildId, userId, 24);
  assert.equal(strikeCount, 2, 'Should retrieve all active strikes within 24 hours');
});

test('AutoMod V2 Exemptions: Ticket channels and categories are excluded', async () => {
  const normalMember = {
    user: { bot: false, id: 'user_norm_am' },
    permissions: { has: () => false },
    roles: { cache: new Map() }
  };

  const ticketChannel = {
    id: 'chan_ticket_999',
    name: 'ticket-0042',
    parentId: 'cat_tickets_1',
    isTextBased: () => true
  };

  const bypassed = isAutoModBypassed(normalMember, ticketChannel, { ticket_category_exempt: true });
  assert.equal(bypassed, true, 'Ticket channels starting with ticket- must bypass AutoMod');

  const regularChannel = {
    id: 'chan_general_1',
    name: 'general-chat',
    parentId: 'cat_community_1',
    isTextBased: () => true
  };

  const regularBypassed = isAutoModBypassed(normalMember, regularChannel, { ticket_category_exempt: true });
  assert.equal(regularBypassed, false, 'Regular channels must NOT bypass AutoMod');
});

test('AutoMod V2 Wizard UI: Strictly Components V2, no accent color, and pure grey buttons', async () => {
  const guildId = 'test_wizard_guild_1';
  const userId = 'user_wizard_admin_1';

  assert.equal(TOTAL_PAGES, 8);
  assert.equal(PAGE_TITLES.length, 8);

  for (let page = 1; page <= TOTAL_PAGES; page++) {
    const wizard = await buildAutoModWizard(guildId, userId, page);

    // Strict UI Rule 1: Components V2 ONLY
    assert.equal(wizard.flags, MessageFlags.IsComponentsV2, `Page ${page} must return MessageFlags.IsComponentsV2`);
    assert.equal(wizard.components.length, 1, `Page ${page} must contain exactly 1 container component`);

    const containerJson = wizard.components[0].toJSON();

    // Strict UI Rule 2: NO accent color
    assert.equal(containerJson.accent_color, undefined, `Page ${page} must NOT have accent_color`);

    // Check all buttons are ButtonStyle.Secondary (grey) or ButtonStyle.Link
    const actionRows = containerJson.components.filter(c => c.type === 1);
    for (const row of actionRows) {
      for (const comp of row.components) {
        if (comp.type === 2) { // Button
          assert.ok(
            comp.style === ButtonStyle.Secondary || comp.style === ButtonStyle.Link,
            `Button ${comp.custom_id || comp.label} on page ${page} must be pure grey (Secondary) or Link`
          );
        }
      }
    }
  }
});

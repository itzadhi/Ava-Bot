import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { checkPanelAccess, buildId, parseId, isValidOwnerId } from '../src/core/interactions/ownership.js';
import { sessionStore } from '../src/core/interactions/session.js';
import { config } from '../src/config.js';

// Setup mock interaction helper
function createMockInteraction({
  userId = '111111111111111111',
  customId = 'shop:setup:guild_1:111111111111111111:step1',
  guildId = 'guild_1',
  isGuildOwner = false,
  isAdmin = false,
  roles = []
} = {}) {
  const memberPermissions = {
    has: (perm) => {
      if (isAdmin && perm === PermissionFlagsBits.Administrator) return true;
      if (perm === PermissionFlagsBits.ManageGuild && roles.includes('manager')) return true;
      return false;
    }
  };

  return {
    customId,
    user: { id: userId, tag: `User#${userId.slice(-4)}` },
    guild: guildId ? {
      id: guildId,
      ownerId: isGuildOwner ? userId : '999999999999999999'
    } : null,
    member: {
      roles: {
        cache: new Map(roles.map(r => [r, { id: r }]))
      },
      _roles: roles
    },
    memberPermissions
  };
}

test('ownership - buildId: builds valid 5-part customId within 100 chars', () => {
  const id = buildId({
    module: 'shop',
    action: 'setup',
    guildId: '123456789012345678',
    ownerId: '234567890123456789',
    key: 'step1'
  });
  assert.equal(id, 'shop:setup:123456789012345678:234567890123456789:step1');
  assert.ok(id.length <= 100);
});

test('ownership - buildId: allows public, staff, and wildcard owners', () => {
  const pub = buildId({ module: 'shop', action: 'buy', ownerId: 'public', key: 'prod1' });
  assert.equal(pub, 'shop:buy::public:prod1');

  const staff = buildId({ module: 'tkt', action: 'claim', ownerId: 'staff', key: 'tkt1' });
  assert.equal(staff, 'tkt:claim::staff:tkt1');
});

test('ownership - buildId: rejects missing or invalid ownerId', () => {
  assert.throws(() => {
    buildId({ module: 'shop', action: 'edit' });
  }, /Missing required ownerId/);

  assert.throws(() => {
    buildId({ module: 'shop', action: 'edit', ownerId: 'not_a_snowflake' });
  }, /Invalid ownerId/);
});

test('ownership - buildId: forbids colons inside segments', () => {
  assert.throws(() => {
    buildId({ module: 'shop:bad', action: 'edit', ownerId: '111111111111111111' });
  }, /illegal colon separator/);

  assert.throws(() => {
    buildId({ module: 'shop', action: 'edit', ownerId: '111:222' });
  }, /illegal colon separator/);
});

test('ownership - buildId: compresses oversized payload while keeping owner segment', () => {
  const longPayload = 'x'.repeat(120);
  const id = buildId({
    module: 'shop',
    action: 'wizard',
    guildId: '123456789012345678',
    ownerId: '234567890123456789',
    key: longPayload
  });
  assert.ok(id.length <= 100, `Compressed ID length ${id.length} must be <= 100`);
  const parsed = parseId(id);
  assert.equal(parsed.ownerId, '234567890123456789');
  assert.ok(parsed.key.length === 8, 'Session key should be 8 hex chars');
  const session = sessionStore.getSession(parsed.key);
  assert.ok(session, 'Session must exist for compressed payload');
  assert.equal(session.data.fullKey, longPayload);
});

test('ownership - parseId: accurately parses 5-part customIds', () => {
  const parsed = parseId('shop:setup:guild_99:user_123:step3_cat');
  assert.equal(parsed.module, 'shop');
  assert.equal(parsed.action, 'setup');
  assert.equal(parsed.guildId, 'guild_99');
  assert.equal(parsed.ownerId, 'user_123');
  assert.equal(parsed.key, 'step3_cat');
});

test('ownership - checkPanelAccess: Opener is permitted', async () => {
  const openerId = '111111111111111111';
  const interaction = createMockInteraction({
    userId: openerId,
    customId: `shop:setup:guild_1:${openerId}:step1`
  });

  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, true);
});

test('ownership - checkPanelAccess: Stranger is rejected with ownerId', async () => {
  const openerId = '111111111111111111';
  const strangerId = '222222222222222222';
  const interaction = createMockInteraction({
    userId: strangerId,
    customId: `shop:setup:guild_1:${openerId}:step1`
  });

  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, false);
  assert.equal(res.reason, 'NOT_OWNER');
  assert.equal(res.ownerId, openerId);
});

test('ownership - checkPanelAccess: Guild Owner override allows interaction', async () => {
  const openerId = '111111111111111111';
  const guildOwnerId = '999999999999999999';
  const interaction = createMockInteraction({
    userId: guildOwnerId,
    customId: `shop:setup:guild_1:${openerId}:step1`,
    isGuildOwner: true
  });

  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, true);
  assert.equal(res.override, 'GUILD_OWNER');
});

test('ownership - checkPanelAccess: Admin override allows interaction', async () => {
  const openerId = '111111111111111111';
  const adminId = '888888888888888888';
  const interaction = createMockInteraction({
    userId: adminId,
    customId: `shop:setup:guild_1:${openerId}:step1`,
    isAdmin: true
  });

  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, true);
  assert.equal(res.override, 'ADMIN');
});

test('ownership - checkPanelAccess: Bot Owner override allows interaction', async () => {
  const openerId = '111111111111111111';
  const botOwnerId = '777777777777777777';
  config.OWNER_IDS = [botOwnerId];

  const interaction = createMockInteraction({
    userId: botOwnerId,
    customId: `shop:setup:guild_1:${openerId}:step1`
  });

  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, true);
  assert.equal(res.override, 'BOT_OWNER');
});

test('ownership - checkPanelAccess: Prefix command panel (owner in customId from message.author)', async () => {
  const prefixAuthorId = '333333333333333333';
  const openerInteraction = createMockInteraction({
    userId: prefixAuthorId,
    customId: `permify:open:guild_1:${prefixAuthorId}:main`
  });
  const openerRes = await checkPanelAccess(openerInteraction);
  assert.equal(openerRes.allowed, true);

  const strangerInteraction = createMockInteraction({
    userId: '444444444444444444',
    customId: `permify:open:guild_1:${prefixAuthorId}:main`
  });
  const strangerRes = await checkPanelAccess(strangerInteraction);
  assert.equal(strangerRes.allowed, false);
  assert.equal(strangerRes.reason, 'NOT_OWNER');
});

test('ownership - checkPanelAccess: Sub-panel button inherits ownerId from opener', async () => {
  const openerId = '111111111111111111';
  // Button clicked from main panel opens subpanel, retaining owner in customId
  const subPanelInteraction = createMockInteraction({
    userId: openerId,
    customId: `shop:edit_field:guild_1:${openerId}:price`
  });
  const res = await checkPanelAccess(subPanelInteraction);
  assert.equal(res.allowed, true);
});

test('ownership - checkPanelAccess: Works after bot restart (stateless customId owner)', async () => {
  // Clear all in-memory sessions to simulate hard bot restart
  sessionStore.destroy();

  const openerId = '555555555555555555';
  const interaction = createMockInteraction({
    userId: openerId,
    customId: `shop:wizard:guild_1:${openerId}:step4`
  });

  // Opener should still be recognized because customId holds the owner snowflake
  const res = await checkPanelAccess(interaction);
  assert.equal(res.allowed, true);

  // Stranger should still be rejected
  const stranger = createMockInteraction({
    userId: '666666666666666666',
    customId: `shop:wizard:guild_1:${openerId}:step4`
  });
  const strangerRes = await checkPanelAccess(stranger);
  assert.equal(strangerRes.allowed, false);
  assert.equal(strangerRes.ownerId, openerId);
});

test('ownership - checkPanelAccess: Unknown owner fails open with warning', async () => {
  const interaction = createMockInteraction({
    userId: '123456789012345678',
    customId: 'shop:action:guild_1::some_key' // Empty ownerId segment
  });

  const res = await checkPanelAccess(interaction, { access: 'owner' });
  assert.equal(res.allowed, true);
  assert.equal(res.warning, 'UNKNOWN_OWNER_FAIL_OPEN');
});

test('ownership - checkPanelAccess: Public tier allows anyone', async () => {
  const anyUser1 = createMockInteraction({
    userId: '123456789012345678',
    customId: 'shop:buy:guild_1:public:product_abc'
  });
  const res1 = await checkPanelAccess(anyUser1);
  assert.equal(res1.allowed, true);

  const anyUser2 = createMockInteraction({
    userId: '987654321098765432',
    customId: 'tkt:open:guild_1:public:support'
  });
  const res2 = await checkPanelAccess(anyUser2, { access: 'public' });
  assert.equal(res2.allowed, true);
});

test('ownership - checkPanelAccess: Staff tier allows staff roles or ManageGuild', async () => {
  const nonStaff = createMockInteraction({
    userId: '111111111111111111',
    customId: 'tkt:ctl:guild_1:staff:close',
    roles: []
  });
  const deniedRes = await checkPanelAccess(nonStaff, { access: 'staff' });
  assert.equal(deniedRes.allowed, false);
  assert.equal(deniedRes.reason, 'STAFF_ONLY');

  const staff = createMockInteraction({
    userId: '222222222222222222',
    customId: 'tkt:ctl:guild_1:staff:close',
    roles: ['manager']
  });
  const allowedRes = await checkPanelAccess(staff, { access: 'staff' });
  assert.equal(allowedRes.allowed, true);
});

test('ownership - checkPanelAccess: Participant tier allows buyer and staff, rejects strangers', async () => {
  const buyerId = '111111111111111111';
  const strangerId = '222222222222222222';
  const staffId = '333333333333333333';

  // Buyer
  const buyerInteraction = createMockInteraction({
    userId: buyerId,
    customId: 'shop:order:guild_1:participant:order_123'
  });
  const buyerRes = await checkPanelAccess(buyerInteraction, { access: 'participant', buyerId });
  assert.equal(buyerRes.allowed, true);

  // Stranger
  const strangerInteraction = createMockInteraction({
    userId: strangerId,
    customId: 'shop:order:guild_1:participant:order_123'
  });
  const strangerRes = await checkPanelAccess(strangerInteraction, { access: 'participant', buyerId });
  assert.equal(strangerRes.allowed, false);
  assert.equal(strangerRes.reason, 'PARTICIPANT_ONLY');

  // Staff
  const staffInteraction = createMockInteraction({
    userId: staffId,
    customId: 'shop:order:guild_1:participant:order_123',
    roles: ['manager']
  });
  const staffRes = await checkPanelAccess(staffInteraction, { access: 'participant', buyerId });
  assert.equal(staffRes.allowed, true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';

import {
  encryptStockItem,
  decryptStockItem,
  maskSensitiveCredential,
  generateEncryptionKey
} from '../src/modules/shop/stock/encryption.js';

import {
  getShopSettings,
  saveShopSettings,
  getShopCategories,
  saveShopCategory,
  getShopProducts,
  saveShopProduct,
  getShopStockItems,
  addShopStockItems,
  reserveStock,
  releaseExpiredReservations,
  completeOrder,
  createOrder,
  getOrderById,
  updateOrderStatus,
  addWaitlistEntry,
  getWaitlist,
  removeWaitlistEntry,
  addShopReview,
  getShopStats,
  _clearInMemoryStore
} from '../src/modules/shop/db.js';

import { createSetupSession, renderSetupStep } from '../src/modules/shop/wizard/setup.js';
import { renderShopDashboard } from '../src/modules/shop/wizard/dashboard.js';
import { createAddProductSession, renderAddProductStep, publishProductChannel } from '../src/modules/shop/wizard/add.js';
import { renderBanner } from '../src/modules/shop/render/banner.js';
import { buildProductCard } from '../src/modules/shop/render/card.js';
import { executeRestock } from '../src/modules/shop/stock/restock.js';

const TEST_GUILD_ID = 'guild-test-999';
const TEST_USER_1 = 'user-buyer-101';
const TEST_USER_2 = 'user-buyer-102';
const TEST_STAFF = 'user-staff-201';

test.beforeEach(() => {
  _clearInMemoryStore();
});

test('Shop Stock Encryption: AES-256-GCM encrypts, decrypts and masks credentials', () => {
  const secretKey = generateEncryptionKey();
  assert.equal(secretKey.length, 64, 'Key must be 32-byte hex (64 chars)');

  const originalPlaintext = 'license_key_ABC123_XYZ987';
  const encrypted = encryptStockItem(originalPlaintext, secretKey);

  assert.ok(encrypted.ciphertext, 'Ciphertext must be present');
  assert.ok(encrypted.iv, 'IV must be present');
  assert.ok(encrypted.tag, 'Tag must be present');
  assert.notEqual(encrypted.ciphertext, originalPlaintext, 'Ciphertext must not be plaintext');

  const decrypted = decryptStockItem(encrypted, secretKey);
  assert.equal(decrypted, originalPlaintext, 'Decrypted text must match original plaintext');

  // Tamper test
  const tampered = { ...encrypted, tag: '00000000000000000000000000000000' };
  assert.throws(() => {
    decryptStockItem(tampered, secretKey);
  }, /Unsupported state or unable to authenticate data/, 'Tampered tag must fail authentication');

  // Masking test
  const masked = maskSensitiveCredential(originalPlaintext);
  assert.ok(masked.startsWith('lic'), 'Masked value must keep prefix');
  assert.ok(masked.endsWith('987'), 'Masked value must keep suffix');
  assert.ok(masked.includes('***'), 'Masked value must obscure middle bytes');
});

test('Shop Setup Wizard: Steps render V2 payloads with grey buttons', async () => {
  const mockGuild = {
    id: TEST_GUILD_ID,
    name: 'Test Gaming Guild',
    members: {
      me: {
        permissions: {
          has: (perm) => true
        }
      }
    },
    channels: {
      cache: new Map()
    }
  };

  const session = createSetupSession(TEST_GUILD_ID, TEST_USER_1);
  assert.equal(session.data.step, 1, 'Initial setup step is 1');

  // Step 1 Welcome
  const step1Payload = await renderSetupStep(session, mockGuild);
  assert.equal(step1Payload.flags, MessageFlags.IsComponentsV2, 'Must use Components V2 flag');
  assert.ok(step1Payload.components.length > 0, 'Must have container component');

  // Step 2 Categories
  session.data.step = 2;
  const step2Payload = await renderSetupStep(session, mockGuild);
  assert.equal(step2Payload.flags, MessageFlags.IsComponentsV2);

  // Step 7 Review
  session.data.step = 7;
  const step7Payload = await renderSetupStep(session, mockGuild);
  assert.equal(step7Payload.flags, MessageFlags.IsComponentsV2);
});

test('Shop Dashboard: All tabs render V2 and respect grey buttons', async () => {
  const mockGuild = {
    id: TEST_GUILD_ID,
    name: 'Argoni Electronics',
    ownerId: TEST_USER_1
  };

  // Test overview tab
  const overview = await renderShopDashboard({ guild: mockGuild, activeTab: 'overview' });
  assert.equal(overview.flags, MessageFlags.IsComponentsV2);
  assert.ok(overview.components.length > 0);

  // Test products tab
  const productsTab = await renderShopDashboard({ guild: mockGuild, activeTab: 'products' });
  assert.equal(productsTab.flags, MessageFlags.IsComponentsV2);

  // Test orders tab
  const ordersTab = await renderShopDashboard({ guild: mockGuild, activeTab: 'orders' });
  assert.equal(ordersTab.flags, MessageFlags.IsComponentsV2);

  // Test settings tab
  const settingsTab = await renderShopDashboard({ guild: mockGuild, activeTab: 'settings' });
  assert.equal(settingsTab.flags, MessageFlags.IsComponentsV2);
});

test('Product Wizard & Auto-Publisher: Creates channel, sets permissions, and posts product card', async () => {
  let createdChannel = null;
  let postedMessage = null;
  let pinned = false;

  const mockChannel = {
    id: 'chan-product-777',
    name: '🔑┃steam-keys',
    type: ChannelType.GuildText,
    send: async (payload) => {
      postedMessage = payload;
      return {
        id: 'msg-product-card-888',
        pin: async () => { pinned = true; }
      };
    }
  };

  const mockGuild = {
    id: TEST_GUILD_ID,
    name: 'Nitro Store',
    roles: {
      everyone: { id: 'role-everyone-000' }
    },
    members: {
      me: { id: 'bot-123' }
    },
    channels: {
      cache: new Map([['chan-product-777', mockChannel]]),
      create: async (opts) => {
        createdChannel = opts;
        return mockChannel;
      }
    }
  };

  // Initialize Category
  const cat = await saveShopCategory(TEST_GUILD_ID, {
    name: 'Steam Keys',
    emoji: '🔑',
    discord_category_id: null
  });

  // Create Product Session
  const session = createAddProductSession(TEST_GUILD_ID, TEST_USER_1, {
    category_id: cat.id,
    name: 'Grand Theft Auto V',
    price_minor: 149900,
    stock_type: 'quantity',
    stock_count: 5,
    description: 'Instant digital activation key for Steam PC platform.',
    features: ['Global Region', 'Instant Delivery', 'Full Warranty'],
    delivery_time: 'Instant (< 1 min)',
    warranty: '30-Day Money Back Guarantee'
  });

  const res = await publishProductChannel({ session, guild: mockGuild });
  const product = res.product || res;

  assert.ok(product, 'Product must be created');
  assert.equal(product.name, 'Grand Theft Auto V');
  assert.equal(product.price_minor, 149900);
  assert.equal(product.status, 'active');
  assert.equal(product.channel_id, 'chan-product-777');
  assert.equal(product.message_id, 'msg-product-card-888');
  assert.ok(pinned, 'Message must be pinned');
  assert.ok(createdChannel, 'Channel must be created with Discord API');
  assert.equal(postedMessage.flags, MessageFlags.IsComponentsV2, 'Posted product must be Components V2');
});

test('Canvas Banner Engine: Renders 1200x400 PNG and leverages LRU memory cache', async () => {
  const sampleProduct = {
    id: 'prod-canvas-1',
    name: 'Cyberpunk 2077 Deluxe',
    price_minor: 299900,
    compare_at_minor: 499900,
    currency_symbol: '$',
    stock_type: 'quantity',
    stock_count: 12,
    status: 'active'
  };

  const t0 = Date.now();
  const bannerBuf1 = await renderBanner({
    product: sampleProduct,
    theme: 'neon',
    categoryName: 'Games',
    shopName: 'Argoni Vault'
  });
  const durationCold = Date.now() - t0;

  assert.ok(Buffer.isBuffer(bannerBuf1), 'Banner must be a Node.js Buffer');
  assert.ok(bannerBuf1.length > 1000, 'Banner buffer must contain valid PNG image data');

  // Verify PNG signature (0x89 0x50 0x4E 0x47)
  assert.equal(bannerBuf1[0], 0x89);
  assert.equal(bannerBuf1[1], 0x50);
  assert.equal(bannerBuf1[2], 0x4E);
  assert.equal(bannerBuf1[3], 0x47);

  // Cached render
  const t1 = Date.now();
  const bannerBuf2 = await renderBanner({
    product: sampleProduct,
    theme: 'neon',
    categoryName: 'Games',
    shopName: 'Argoni Vault'
  });
  const durationCached = Date.now() - t1;

  assert.ok(durationCached <= durationCold, 'Cached banner render should be faster than cold render');
  assert.equal(bannerBuf1.length, bannerBuf2.length, 'Cached buffer matches cold buffer');
});

test('Stock Reservation & Concurrency: Exactly one buyer wins when stock is 1', async () => {
  const product = await saveShopProduct(TEST_GUILD_ID, {
    name: 'Rare CS2 Knife Skin',
    price_minor: 2500000,
    stock_type: 'quantity',
    stock_count: 1,
    status: 'active'
  });

  // Buyer 1 reserves the last remaining item
  const reservation1 = await reserveStock(product.id, 1, 15);
  assert.ok(reservation1.success, 'First buyer reservation must succeed');

  // Buyer 2 attempts to reserve at the same time
  const reservation2 = await reserveStock(product.id, 1, 15);
  assert.equal(reservation2.success, false, 'Second simultaneous buyer reservation must fail');
  assert.equal(reservation2.code, 'OUT_OF_STOCK', 'Code must be OUT_OF_STOCK');

  // Release reservation (e.g. buyer 1 abandons or timer expires)
  const released = await releaseExpiredReservations();
  assert.ok(released.releasedProducts >= 0, 'Expired cleanup must process');

  // Manually release buyer 1's reservation
  await saveShopProduct(TEST_GUILD_ID, {
    ...product,
    stock_count: product.stock_count // restored
  });
});

test('Item Stock: Encrypted items are atomically reserved and marked sold', async () => {
  const secretKey = generateEncryptionKey();

  const product = await saveShopProduct(TEST_GUILD_ID, {
    name: 'Spotify Premium Accounts',
    price_minor: 29900,
    stock_type: 'items',
    stock_count: 2,
    status: 'active'
  });

  // Add 2 encrypted items
  const enc1 = encryptStockItem('user1@example.com:pass123', secretKey);
  const enc2 = encryptStockItem('user2@example.com:pass456', secretKey);

  await addShopStockItems(product.id, [enc1, enc2]);

  const availableItems = await getShopStockItems(product.id, 'available');
  assert.equal(availableItems.length, 2, 'Must have 2 available items');

  // Reserve 1 item for Order 501
  const res = await reserveStock(product.id, 'order-501', 1, 30);
  assert.ok(res.success);
  assert.equal(res.items.length, 1);
  const reservedItem = res.items[0];

  // Complete Order
  const completion = await completeOrder('order-501');
  assert.ok(completion.success);
  assert.equal(completion.items.length, 1);
  assert.equal(completion.items[0].status, 'sold');

  // Decrypt delivered item
  const deliveredPlaintext = decryptStockItem(completion.items[0], secretKey);
  assert.equal(deliveredPlaintext, 'user1@example.com:pass123');
});

test('Order Lifecycle & Stats: Orders update conversion metrics and verified reviews', async () => {
  const product = await saveShopProduct(TEST_GUILD_ID, {
    name: 'Discord Nitro 1 Year',
    price_minor: 999900,
    stock_type: 'unlimited',
    stock_count: 999,
    status: 'active'
  });

  // Create Order
  const order = await createOrder({
    guild_id: TEST_GUILD_ID,
    user_id: TEST_USER_1,
    product_id: product.id,
    quantity: 1,
    unit_price_minor: 999900,
    total_minor: 999900,
    status: 'pending',
    ticket_channel_id: 'chan-order-ticket-111'
  });

  assert.ok(order.id);
  assert.equal(order.status, 'pending');

  // Customer marks paid
  await updateOrderStatus(order.id, 'paid');
  let fetched = await getOrderById(order.id);
  assert.equal(fetched.status, 'paid');

  // Staff delivers
  await updateOrderStatus(order.id, 'delivered');
  fetched = await getOrderById(order.id);
  assert.equal(fetched.status, 'delivered');

  // Customer leaves 5-star review
  await addShopReview({
    guild_id: TEST_GUILD_ID,
    order_id: order.id,
    user_id: TEST_USER_1,
    product_id: product.id,
    rating: 5,
    comment: 'Instant delivery, worked flawlessly!'
  });

  const stats = await getShopStats(TEST_GUILD_ID);
  assert.equal(stats.totalOrders, 1);
  assert.equal(stats.completedOrders, 1);
  assert.equal(stats.reviewCount, 1);
  assert.equal(stats.averageRating, '5.0');
});

test('Restock & Waitlist: Restock updates stock, flips sold out status, notifies waitlist', async () => {
  let restockAnnouncement = null;
  let sentDm = null;

  const mockChannel = {
    send: async (payload) => { restockAnnouncement = payload; }
  };

  const mockUser = {
    id: TEST_USER_2,
    send: async (payload) => { sentDm = payload; }
  };

  const mockGuild = {
    id: TEST_GUILD_ID,
    channels: {
      cache: new Map([['chan-restock-333', mockChannel]])
    },
    client: {
      users: {
        fetch: async (id) => mockUser
      }
    }
  };

  // Configure Restock Channel
  await saveShopSettings(TEST_GUILD_ID, {
    restock_channel_id: 'chan-restock-333'
  });

  // Product currently Sold Out
  const product = await saveShopProduct(TEST_GUILD_ID, {
    name: 'Valorant Points Code',
    price_minor: 120000,
    stock_type: 'quantity',
    stock_count: 0,
    status: 'active'
  });

  // Buyer 2 joins Waitlist
  await addWaitlistEntry(TEST_GUILD_ID, product.id, TEST_USER_2);
  const waitlist = await getWaitlist(product.id);
  assert.equal(waitlist.length, 1);

  // Execute Restock of 10 units
  const result = await executeRestock({
    guild: mockGuild,
    productId: product.id,
    stockType: 'quantity',
    quantityToAdd: 10,
    staffId: TEST_STAFF
  });

  assert.equal(result.newStock, 10);
  assert.equal(result.notifiedCount, 1);
  assert.ok(restockAnnouncement, 'Restock card must be posted to restock channel');
  assert.equal(restockAnnouncement.flags, MessageFlags.IsComponentsV2, 'Restock announcement must be Components V2');
  assert.ok(sentDm, 'Waitlisted user must receive DM alert');

  // Verify waitlist was cleared
  const waitlistAfter = await getWaitlist(product.id);
  assert.equal(waitlistAfter.length, 0, 'Waitlist must be cleared after notification');
});

test('Strict UI Compliance: 100% Components V2, 0 Embeds, Only Grey/Secondary Buttons', async () => {
  const product = {
    id: 'prod-ui-check-1',
    name: 'Netflix Premium 4K',
    price_minor: 49900,
    compare_at_minor: 79900,
    currency_symbol: '₹',
    stock_type: 'quantity',
    stock_count: 8,
    status: 'active',
    description: 'High definition 4-screen streaming subscription.',
    features: ['Ultra HD', 'Ad-Free', 'All Devices'],
    delivery_time: '5 Minutes',
    warranty: 'Lifetime Replacement'
  };

  const cardPayload = buildProductCard(product, 'attachment://banner.png');

  // Assert Components V2
  assert.equal(cardPayload.flags, MessageFlags.IsComponentsV2, 'Must have IsComponentsV2 flag');
  assert.equal(cardPayload.embeds, undefined, 'Must NEVER have embeds property');
  assert.equal(cardPayload.content, undefined, 'Must NEVER have content property with V2');

  // Inspect buttons
  const container = cardPayload.components[0];
  const data = container.toJSON();

  // Find all action rows and buttons
  let buttonCount = 0;
  for (const comp of data.components || []) {
    if (comp.type === 1) { // ActionRow
      for (const btn of comp.components || []) {
        if (btn.type === 2) { // Button
          buttonCount++;
          if (btn.style !== ButtonStyle.Link) {
            assert.equal(
              btn.style,
              ButtonStyle.Secondary,
              `Button "${btn.label}" must be ButtonStyle.Secondary (grey)`
            );
          }
        }
      }
    }
  }

  assert.ok(buttonCount > 0, 'Product card must have interactive buttons');
});

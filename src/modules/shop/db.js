import crypto from 'node:crypto';
import { db, memoryDb } from '../../db/client.js';
import { logger } from '../../utils/logger.js';
import { shopCache } from './cache.js';

// Memory DB tables fallback if SQL migration is pending or Supabase is down
function getMemTable(tableName) {
  if (!memoryDb.tables) memoryDb.tables = {};
  if (!memoryDb.tables[tableName]) {
    memoryDb.tables[tableName] = new Map();
  }
  return memoryDb.tables[tableName];
}

const localCounters = new Map();

/**
 * Returns default shop settings for a guild
 * @param {string} guildId
 * @returns {object}
 */
export function getDefaultShopSettings(guildId) {
  return {
    guild_id: guildId,
    is_enabled: false,
    currency: 'INR',
    currency_symbol: '₹',
    locale: 'en-IN',
    payment_methods: [
      { id: 'upi', name: 'UPI', instructions: 'Pay via UPI and send the transaction screenshot in this ticket.' },
      { id: 'paypal', name: 'PayPal', instructions: 'Send payment via Friends & Family to our PayPal and paste transaction ID.' }
    ],
    ticket_category_id: null,
    support_role_ids: [],
    manager_role_ids: [],
    buyer_role_id: null,
    max_open_orders_per_user: 3,
    orders_channel_id: null,
    delivery_channel_id: null,
    vouch_channel_id: null,
    restock_channel_id: null,
    restock_ping_role_id: null,
    banner_theme: 'dark',
    banner_font: 'Inter',
    stock_display_mode: 'exact',
    low_stock_threshold: 3
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SHOP SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

export async function getShopSettings(guildId) {
  const cached = shopCache.getCachedSettings(guildId);
  if (cached) return cached;

  try {
    const { data, error } = await db
      .from('shop_settings')
      .select('*')
      .eq('guild_id', guildId)
      .maybeSingle();

    if (!error && data) {
      shopCache.setCachedSettings(guildId, data);
      return data;
    }
  } catch (_) { }

  const mem = getMemTable('shop_settings').get(guildId);
  const result = mem || getDefaultShopSettings(guildId);
  shopCache.setCachedSettings(guildId, result);
  return result;
}

export async function updateShopSettings(guildId, updates) {
  const current = await getShopSettings(guildId);
  const updated = {
    ...current,
    ...updates,
    guild_id: guildId,
    updated_at: new Date().toISOString()
  };

  shopCache.setCachedSettings(guildId, updated);
  getMemTable('shop_settings').set(guildId, updated);

  try {
    await db
      .from('shop_settings')
      .upsert(updated, { onConflict: 'guild_id' });
  } catch (err) {
    logger.debug({ err: err.message }, 'Failed to persist shop settings to DB, memory updated');
  }

  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SHOP CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────

export async function getShopCategories(guildId) {
  const cached = shopCache.getCachedCategories(guildId);
  if (cached) return cached;

  try {
    const { data, error } = await db
      .from('shop_categories')
      .select('*')
      .eq('guild_id', guildId)
      .order('position', { ascending: true });

    if (!error && Array.isArray(data)) {
      shopCache.setCachedCategories(guildId, data);
      return data;
    }
  } catch (_) { }

  const mem = Array.from(getMemTable('shop_categories').values()).filter(c => c.guild_id === guildId);
  shopCache.setCachedCategories(guildId, mem);
  return mem;
}

export async function saveShopCategory(category) {
  const cat = {
    id: category.id || crypto.randomUUID(),
    guild_id: category.guild_id,
    discord_category_id: category.discord_category_id || null,
    name: category.name,
    emoji: category.emoji || '📦',
    accent_color: category.accent_color || '#6366F1',
    position: category.position ?? 0,
    updated_at: new Date().toISOString()
  };

  getMemTable('shop_categories').set(cat.id, cat);
  shopCache.invalidateCategories(cat.guild_id);

  try {
    await db.from('shop_categories').upsert(cat, { onConflict: 'id' });
  } catch (_) { }

  return cat;
}

export async function deleteShopCategory(categoryId, guildId) {
  getMemTable('shop_categories').delete(categoryId);
  shopCache.invalidateCategories(guildId);

  try {
    await db.from('shop_categories').delete().eq('id', categoryId);
  } catch (_) { }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SHOP PRODUCTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getShopProducts(guildId, { status = null, categoryId = null } = {}) {
  try {
    let query = db.from('shop_products').select('*').eq('guild_id', guildId);
    if (status) query = query.eq('status', status);
    if (categoryId) query = query.eq('category_id', categoryId);

    const { data, error } = await query.order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) {
      shopCache.setCachedProducts(guildId, data);
      return data;
    }
  } catch (_) { }

  let mem = Array.from(getMemTable('shop_products').values()).filter(p => p.guild_id === guildId);
  if (status) mem = mem.filter(p => p.status === status);
  if (categoryId) mem = mem.filter(p => p.category_id === categoryId);
  return mem;
}

export async function getShopProductById(productId) {
  const cached = shopCache.getCachedProductById(productId);
  if (cached) return cached;

  try {
    const { data, error } = await db
      .from('shop_products')
      .select('*')
      .eq('id', productId)
      .maybeSingle();

    if (!error && data) {
      shopCache.setCachedProduct(data);
      return data;
    }
  } catch (_) { }

  return getMemTable('shop_products').get(productId) || null;
}

export async function getShopProductByChannel(channelId) {
  const cached = shopCache.getCachedProductByChannel(channelId);
  if (cached) return cached;

  try {
    const { data, error } = await db
      .from('shop_products')
      .select('*')
      .eq('channel_id', channelId)
      .maybeSingle();

    if (!error && data) {
      shopCache.setCachedProduct(data);
      return data;
    }
  } catch (_) { }

  const mem = Array.from(getMemTable('shop_products').values()).find(p => p.channel_id === channelId);
  return mem || null;
}

export async function saveShopProduct(product) {
  const prod = {
    id: product.id || crypto.randomUUID(),
    guild_id: product.guild_id,
    category_id: product.category_id || null,
    name: product.name,
    slug: product.slug || product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    description: product.description || '',
    features: product.features || [],
    price_minor: product.price_minor || 0,
    compare_at_minor: product.compare_at_minor || null,
    currency: product.currency || 'INR',
    stock_type: product.stock_type || 'unlimited',
    stock_count: product.stock_count || 0,
    low_stock_threshold: product.low_stock_threshold || 3,
    status: product.status || 'active',
    channel_id: product.channel_id || null,
    message_id: product.message_id || null,
    banner_path: product.banner_path || null,
    banner_hash: product.banner_hash || null,
    version: (product.version || 1),
    sale_start: product.sale_start || null,
    sale_end: product.sale_end || null,
    max_per_order: product.max_per_order || 1,
    per_user_limit: product.per_user_limit || null,
    delivery_mode: product.delivery_mode || 'automatic',
    warranty_text: product.warranty_text || '24 Hours Warranty',
    delivery_time_text: product.delivery_time_text || 'Instant Delivery',
    notes: product.notes || '',
    needs_sync: Boolean(product.needs_sync),
    created_at: product.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  getMemTable('shop_products').set(prod.id, prod);
  shopCache.setCachedProduct(prod);

  try {
    await db.from('shop_products').upsert(prod, { onConflict: 'id' });
  } catch (_) { }

  return prod;
}

export async function archiveShopProduct(productId, guildId) {
  const prod = await getShopProductById(productId);
  if (!prod) return false;

  prod.status = 'archived';
  prod.updated_at = new Date().toISOString();
  return saveShopProduct(prod);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. STOCK ITEMS & RESTOCKING
// ─────────────────────────────────────────────────────────────────────────────

export async function addEncryptedStockItems(productId, encryptedItems, guildId = null) {
  const records = encryptedItems.map(item => ({
    id: crypto.randomUUID(),
    product_id: productId,
    ciphertext: item.ciphertext,
    iv: item.iv,
    tag: item.tag,
    status: 'available',
    reserved_order_id: null,
    reserved_until: null,
    sold_order_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const memTable = getMemTable('shop_stock_items');
  for (const r of records) {
    memTable.set(r.id, r);
  }

  try {
    await db.from('shop_stock_items').insert(records);
  } catch (_) { }

  // Update product stock count
  const product = await getShopProductById(productId);
  if (product) {
    product.stock_count = (product.stock_count || 0) + records.length;
    await saveShopProduct(product);
  }

  return records.length;
}

export async function getReservedItemsForOrder(orderId) {
  try {
    const { data, error } = await db
      .from('shop_stock_items')
      .select('*')
      .eq('reserved_order_id', orderId);

    if (!error && Array.isArray(data) && data.length > 0) {
      return data;
    }
  } catch (_) { }

  return Array.from(getMemTable('shop_stock_items').values())
    .filter(i => i.reserved_order_id === orderId);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ATOMIC RPC FUNCTIONS (Stock Reservation & Lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

export async function reserveStock(productId, orderId, quantity = 1, ttlMinutes = 30) {
  try {
    const { data, error } = await db.rpc('shop_reserve_stock', {
      p_product_id: productId,
      p_order_id: orderId,
      p_quantity: quantity,
      p_ttl_minutes: ttlMinutes
    });

    if (!error && data) {
      return data;
    }
  } catch (_) { }

  // In-memory atomic fallback
  const product = await getShopProductById(productId);
  if (!product || product.status !== 'active') {
    return { success: false, error: 'PRODUCT_NOT_ACTIVE' };
  }

  const expiry = new Date(Date.now() + ttlMinutes * 60000).toISOString();

  if (product.stock_type === 'unlimited') {
    return { success: true, stock_type: 'unlimited', quantity, reserved_until: expiry };
  }

  if (product.stock_type === 'quantity') {
    if (product.stock_count < quantity) {
      return { success: false, error: 'OUT_OF_STOCK', available: product.stock_count };
    }
    product.stock_count -= quantity;
    await saveShopProduct(product);
    return { success: true, stock_type: 'quantity', quantity, remaining_stock: product.stock_count, reserved_until: expiry };
  }

  if (product.stock_type === 'items') {
    const available = Array.from(getMemTable('shop_stock_items').values())
      .filter(i => i.product_id === productId && i.status === 'available')
      .slice(0, quantity);

    if (available.length < quantity) {
      return { success: false, error: 'OUT_OF_STOCK', available: available.length };
    }

    for (const item of available) {
      item.status = 'reserved';
      item.reserved_order_id = orderId;
      item.reserved_until = expiry;
      item.updated_at = new Date().toISOString();
    }

    product.stock_count -= quantity;
    await saveShopProduct(product);

    return { success: true, stock_type: 'items', quantity, item_ids: available.map(i => i.id), reserved_until: expiry };
  }

  return { success: false, error: 'INVALID_STOCK_TYPE' };
}

export async function releaseExpiredOrders() {
  try {
    const { data, error } = await db.rpc('shop_release_expired');
    if (!error && data) {
      return data;
    }
  } catch (_) { }

  // In-memory fallback
  const now = new Date();
  let count = 0;
  for (const order of getMemTable('shop_orders').values()) {
    if (['pending', 'awaiting_payment'].includes(order.status) && order.reserved_until && new Date(order.reserved_until) < now) {
      order.status = 'expired';
      order.updated_at = new Date().toISOString();

      // Release items
      for (const item of getMemTable('shop_stock_items').values()) {
        if (item.reserved_order_id === order.id && item.status === 'reserved') {
          item.status = 'available';
          item.reserved_order_id = null;
          item.reserved_until = null;
        }
      }

      // Restore quantity if applicable
      const product = await getShopProductById(order.product_id);
      if (product && product.stock_type === 'quantity') {
        product.stock_count += order.quantity;
        await saveShopProduct(product);
      }
      count++;
    }
  }

  return { released_orders: count };
}

export async function completeOrder(orderId) {
  try {
    const { data, error } = await db.rpc('shop_complete_order', {
      p_order_id: orderId
    });
    if (!error && data) return data;
  } catch (_) { }

  // In-memory fallback
  const order = getMemTable('shop_orders').get(orderId);
  if (order) {
    order.status = 'completed';
    order.updated_at = new Date().toISOString();

    for (const item of getMemTable('shop_stock_items').values()) {
      if (item.reserved_order_id === orderId) {
        item.status = 'sold';
        item.sold_order_id = orderId;
        item.reserved_order_id = null;
        item.reserved_until = null;
      }
    }
    return { success: true };
  }
  return { success: false, error: 'ORDER_NOT_FOUND' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SHOP ORDERS & SEQUENCES
// ─────────────────────────────────────────────────────────────────────────────

export async function getNextOrderNumber(guildId) {
  try {
    const { data, error } = await db.rpc('shop_next_order_number', {
      p_guild_id: guildId
    });
    if (!error && data) {
      return Number(data);
    }
  } catch (_) { }

  const current = localCounters.get(guildId) || 1000;
  const next = current + 1;
  localCounters.set(guildId, next);
  return next;
}

export async function createShopOrder(orderData) {
  const number = await getNextOrderNumber(orderData.guild_id);
  const order = {
    id: orderData.id || crypto.randomUUID(),
    guild_id: orderData.guild_id,
    number,
    user_id: orderData.user_id,
    product_id: orderData.product_id,
    product_name_snapshot: orderData.product_name_snapshot,
    quantity: orderData.quantity || 1,
    unit_price_minor: orderData.unit_price_minor,
    total_minor: orderData.total_minor,
    currency: orderData.currency || 'INR',
    coupon_id: orderData.coupon_id || null,
    status: orderData.status || 'pending',
    ticket_channel_id: orderData.ticket_channel_id || null,
    reserved_until: orderData.reserved_until || null,
    notes: orderData.notes || null,
    delivered_payload: orderData.delivered_payload || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  getMemTable('shop_orders').set(order.id, order);

  try {
    await db.from('shop_orders').insert(order);
  } catch (_) { }

  return order;
}

export async function getShopOrder(orderId) {
  try {
    const { data, error } = await db
      .from('shop_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (!error && data) return data;
  } catch (_) { }

  return getMemTable('shop_orders').get(orderId) || null;
}

export async function getShopOrderByTicket(ticketChannelId) {
  try {
    const { data, error } = await db
      .from('shop_orders')
      .select('*')
      .eq('ticket_channel_id', ticketChannelId)
      .maybeSingle();

    if (!error && data) return data;
  } catch (_) { }

  return Array.from(getMemTable('shop_orders').values())
    .find(o => o.ticket_channel_id === ticketChannelId) || null;
}

export async function getShopOrders(guildId, { status = null, userId = null, limit = 50 } = {}) {
  try {
    let query = db.from('shop_orders').select('*').eq('guild_id', guildId);
    if (status) query = query.eq('status', status);
    if (userId) query = query.eq('user_id', userId);

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
    if (!error && Array.isArray(data)) return data;
  } catch (_) { }

  let mem = Array.from(getMemTable('shop_orders').values()).filter(o => o.guild_id === guildId);
  if (status) mem = mem.filter(o => o.status === status);
  if (userId) mem = mem.filter(o => o.user_id === userId);
  return mem.slice(0, limit);
}

export async function updateShopOrder(orderId, updates) {
  const order = await getShopOrder(orderId);
  if (!order) return null;

  const updated = {
    ...order,
    ...updates,
    updated_at: new Date().toISOString()
  };

  getMemTable('shop_orders').set(orderId, updated);

  try {
    await db.from('shop_orders').update(updated).eq('id', orderId);
  } catch (_) { }

  return updated;
}

export async function addShopOrderEvent(orderId, eventType, actorId, data = {}) {
  const event = {
    id: crypto.randomUUID(),
    order_id: orderId,
    event_type: eventType,
    actor_id: actorId,
    data,
    created_at: new Date().toISOString()
  };

  getMemTable('shop_order_events').set(event.id, event);

  try {
    await db.from('shop_order_events').insert(event);
  } catch (_) { }

  return event;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. COUPONS & WAITLIST & BLACKLIST & REVIEWS
// ─────────────────────────────────────────────────────────────────────────────

export async function getShopCoupon(guildId, code) {
  if (!code) return null;
  const upperCode = code.trim().toUpperCase();

  try {
    const { data, error } = await db
      .from('shop_coupons')
      .select('*')
      .eq('guild_id', guildId)
      .ilike('code', upperCode)
      .eq('is_active', true)
      .maybeSingle();

    if (!error && data) return data;
  } catch (_) { }

  return Array.from(getMemTable('shop_coupons').values())
    .find(c => c.guild_id === guildId && c.code.toUpperCase() === upperCode && c.is_active !== false) || null;
}

export async function saveShopCoupon(coupon) {
  const c = {
    id: coupon.id || crypto.randomUUID(),
    guild_id: coupon.guild_id,
    code: coupon.code.toUpperCase().trim(),
    discount_type: coupon.discount_type || 'percent',
    value_minor: coupon.value_minor,
    min_order_minor: coupon.min_order_minor || 0,
    max_uses: coupon.max_uses || null,
    uses_count: coupon.uses_count || 0,
    per_user_limit: coupon.per_user_limit || 1,
    expires_at: coupon.expires_at || null,
    is_active: coupon.is_active !== false,
    product_ids: coupon.product_ids || [],
    category_ids: coupon.category_ids || [],
    created_at: coupon.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  getMemTable('shop_coupons').set(c.id, c);
  try {
    await db.from('shop_coupons').upsert(c, { onConflict: 'id' });
  } catch (_) { }

  return c;
}

export async function recordCouponUse(couponId, guildId, userId, orderId) {
  const use = {
    id: crypto.randomUUID(),
    coupon_id: couponId,
    guild_id: guildId,
    user_id: userId,
    order_id: orderId,
    created_at: new Date().toISOString()
  };

  getMemTable('shop_coupon_uses').set(use.id, use);

  // Increment coupon uses count
  const coupon = getMemTable('shop_coupons').get(couponId);
  if (coupon) {
    coupon.uses_count = (coupon.uses_count || 0) + 1;
  }

  try {
    await db.from('shop_coupon_uses').insert(use);
    await db.from('shop_coupons').update({
      uses_count: (coupon?.uses_count || 1),
      updated_at: new Date().toISOString()
    }).eq('id', couponId);
  } catch (_) { }

  return use;
}

export async function addToWaitlist(guildId, productId, userId) {
  const entry = {
    id: crypto.randomUUID(),
    guild_id: guildId,
    product_id: productId,
    user_id: userId,
    created_at: new Date().toISOString()
  };

  getMemTable('shop_waitlist').set(`${productId}:${userId}`, entry);
  try {
    await db.from('shop_waitlist').upsert(entry, { onConflict: 'product_id,user_id' });
  } catch (_) { }

  return entry;
}

export async function getWaitlist(productId) {
  try {
    const { data, error } = await db
      .from('shop_waitlist')
      .select('user_id')
      .eq('product_id', productId);

    if (!error && Array.isArray(data)) {
      return data.map(d => d.user_id);
    }
  } catch (_) { }

  return Array.from(getMemTable('shop_waitlist').values())
    .filter(w => w.product_id === productId)
    .map(w => w.user_id);
}

export async function clearWaitlist(productId) {
  for (const [key, val] of getMemTable('shop_waitlist').entries()) {
    if (val.product_id === productId) {
      getMemTable('shop_waitlist').delete(key);
    }
  }
  try {
    await db.from('shop_waitlist').delete().eq('product_id', productId);
  } catch (_) { }
}

export async function isUserBlacklisted(guildId, userId) {
  const cached = shopCache.isUserBlacklisted(guildId, userId);
  if (cached !== null) return cached;

  try {
    const { data, error } = await db
      .from('shop_blacklist')
      .select('*')
      .eq('guild_id', guildId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!error && data) {
      const active = !data.expires_at || new Date(data.expires_at) > new Date();
      shopCache.setCachedBlacklist(guildId, userId, active);
      return active;
    }
  } catch (_) { }

  const mem = getMemTable('shop_blacklist').get(`${guildId}:${userId}`);
  const active = Boolean(mem && (!mem.expires_at || new Date(mem.expires_at) > new Date()));
  shopCache.setCachedBlacklist(guildId, userId, active);
  return active;
}

export async function addBlacklist(guildId, userId, reason, expiresAt, createdBy) {
  const bl = {
    id: crypto.randomUUID(),
    guild_id: guildId,
    user_id: userId,
    reason: reason || 'Blacklisted from shop',
    expires_at: expiresAt || null,
    created_by: createdBy,
    created_at: new Date().toISOString()
  };

  getMemTable('shop_blacklist').set(`${guildId}:${userId}`, bl);
  shopCache.setCachedBlacklist(guildId, userId, true);

  try {
    await db.from('shop_blacklist').upsert(bl, { onConflict: 'guild_id,user_id' });
  } catch (_) { }

  return bl;
}

export async function removeBlacklist(guildId, userId) {
  getMemTable('shop_blacklist').delete(`${guildId}:${userId}`);
  shopCache.setCachedBlacklist(guildId, userId, false);

  try {
    await db.from('shop_blacklist').delete().eq('guild_id', guildId).eq('user_id', userId);
  } catch (_) { }
}

export async function createShopReview(reviewData) {
  const review = {
    id: crypto.randomUUID(),
    guild_id: reviewData.guild_id,
    order_id: reviewData.order_id || null,
    product_id: reviewData.product_id || null,
    user_id: reviewData.user_id,
    stars: Math.max(1, Math.min(5, reviewData.stars || 5)),
    comment: reviewData.comment || '',
    vouch_message_id: reviewData.vouch_message_id || null,
    created_at: new Date().toISOString()
  };

  getMemTable('shop_reviews').set(review.id, review);

  try {
    await db.from('shop_reviews').insert(review);
  } catch (_) { }

  return review;
}

export async function getShopStats(guildId) {
  const orders = await getShopOrders(guildId, { limit: 1000 });
  const completed = orders.filter(o => o.status === 'completed' || o.status === 'delivered');

  const totalRevenue = completed.reduce((sum, o) => sum + BigInt(o.total_minor || 0), 0n);
  const totalOrders = orders.length;
  const completedOrders = completed.length;
  const conversionRate = totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(1) : '0.0';

  // Average rating
  const reviews = Array.from(getMemTable('shop_reviews').values()).filter(r => r.guild_id === guildId);
  const avgRating = reviews.length > 0
    ? (reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length).toFixed(1)
    : 'N/A';

  return {
    totalRevenueMinor: totalRevenue,
    totalOrders,
    completedOrders,
    conversionRate: `${conversionRate}%`,
    averageRating: avgRating,
    reviewCount: reviews.length
  };
}

export default {
  getDefaultShopSettings,
  getShopSettings,
  updateShopSettings,
  getShopCategories,
  saveShopCategory,
  deleteShopCategory,
  getShopProducts,
  getShopProductById,
  getShopProductByChannel,
  saveShopProduct,
  archiveShopProduct,
  addEncryptedStockItems,
  getReservedItemsForOrder,
  reserveStock,
  releaseExpiredOrders,
  completeOrder,
  getNextOrderNumber,
  createShopOrder,
  getShopOrder,
  getShopOrderByTicket,
  getShopOrders,
  updateShopOrder,
  addShopOrderEvent,
  getShopCoupon,
  saveShopCoupon,
  recordCouponUse,
  addToWaitlist,
  getWaitlist,
  clearWaitlist,
  isUserBlacklisted,
  addBlacklist,
  removeBlacklist,
  createShopReview,
  getShopStats
};

/**
 * Shop In-Memory Write-Through Cache Layer
 * Provides sub-millisecond lookups for shop settings, categories, products,
 * channels, and blacklists.
 */

const SETTINGS_TTL = 300_000; // 5 minutes
const CATEGORIES_TTL = 300_000; // 5 minutes
const PRODUCTS_TTL = 180_000; // 3 minutes
const BLACKLIST_TTL = 300_000; // 5 minutes

class ShopCache {
  constructor() {
    this.settings = new Map();
    this.categories = new Map();
    this.products = new Map();
    this.productById = new Map();
    this.productByChannel = new Map();
    this.blacklist = new Map();
  }

  // ── Settings ──
  getCachedSettings(guildId) {
    const entry = this.settings.get(guildId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > SETTINGS_TTL) {
      this.settings.delete(guildId);
      return null;
    }
    return entry.data;
  }

  setCachedSettings(guildId, data) {
    this.settings.set(guildId, { data, timestamp: Date.now() });
  }

  invalidateSettings(guildId) {
    this.settings.delete(guildId);
  }

  // ── Categories ──
  getCachedCategories(guildId) {
    const entry = this.categories.get(guildId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CATEGORIES_TTL) {
      this.categories.delete(guildId);
      return null;
    }
    return entry.data;
  }

  setCachedCategories(guildId, data) {
    this.categories.set(guildId, { data, timestamp: Date.now() });
  }

  invalidateCategories(guildId) {
    this.categories.delete(guildId);
  }

  // ── Products ──
  getCachedProducts(guildId) {
    const entry = this.products.get(guildId);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > PRODUCTS_TTL) {
      this.products.delete(guildId);
      return null;
    }
    return entry.data;
  }

  setCachedProducts(guildId, data) {
    this.products.set(guildId, { data, timestamp: Date.now() });
    if (Array.isArray(data)) {
      for (const p of data) {
        if (p.id) this.productById.set(p.id, p);
        if (p.channel_id) this.productByChannel.set(p.channel_id, p.id);
      }
    }
  }

  getCachedProductById(productId) {
    return this.productById.get(productId) || null;
  }

  getCachedProductByChannel(channelId) {
    const prodId = this.productByChannel.get(channelId);
    if (prodId) {
      return this.productById.get(prodId) || null;
    }
    return null;
  }

  setCachedProduct(product) {
    if (!product || !product.id) return;
    this.productById.set(product.id, product);
    if (product.channel_id) {
      this.productByChannel.set(product.channel_id, product.id);
    }
    // Update product in guild array if cached
    if (product.guild_id && this.products.has(product.guild_id)) {
      const entry = this.products.get(product.guild_id);
      const list = entry.data || [];
      const idx = list.findIndex(p => p.id === product.id);
      if (idx >= 0) {
        list[idx] = product;
      } else {
        list.push(product);
      }
    }
  }

  invalidateProducts(guildId) {
    this.products.delete(guildId);
  }

  invalidateProduct(productId, channelId = null) {
    this.productById.delete(productId);
    if (channelId) this.productByChannel.delete(channelId);
  }

  // ── Blacklist ──
  isUserBlacklisted(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const entry = this.blacklist.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > BLACKLIST_TTL) {
      this.blacklist.delete(key);
      return null;
    }
    return entry.isBlacklisted;
  }

  setCachedBlacklist(guildId, userId, isBlacklisted) {
    const key = `${guildId}:${userId}`;
    this.blacklist.set(key, { isBlacklisted, timestamp: Date.now() });
  }

  invalidateBlacklist(guildId, userId = null) {
    if (userId) {
      this.blacklist.delete(`${guildId}:${userId}`);
    } else {
      for (const key of this.blacklist.keys()) {
        if (key.startsWith(`${guildId}:`)) {
          this.blacklist.delete(key);
        }
      }
    }
  }

  clear() {
    this.settings.clear();
    this.categories.clear();
    this.products.clear();
    this.productById.clear();
    this.productByChannel.clear();
    this.blacklist.clear();
  }
}

export const shopCache = new ShopCache();
export default shopCache;

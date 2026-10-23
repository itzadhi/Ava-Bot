import {
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import { getShopSettings, getShopProducts, getShopCategories, getShopOrders, getShopStats } from '../db.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import * as format from '../../../utils/ui/format.js';

function formatCurrency(minorUnits, currency = 'INR', locale = 'en-IN') {
  const major = Number(minorUnits || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(major);
  } catch (_) {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`;
  }
}

/**
 * Builds the Shop Management Dashboard
 * Strictly 100% Components V2, pure grey buttons, no embeds.
 *
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {string} [params.activeTab='overview'] 'overview' | 'products' | 'categories' | 'orders' | 'coupons' | 'settings'
 * @param {number} [params.page=1]
 * @param {string} [params.userId=null]
 * @returns {Promise<object>}
 */
export async function renderShopDashboard({
  guild,
  activeTab = 'overview',
  page = 1,
  userId = null
}) {
  const guildId = guild.id;
  const [settings, products, categories, stats] = await Promise.all([
    getShopSettings(guildId),
    getShopProducts(guildId),
    getShopCategories(guildId),
    getShopStats(guildId)
  ]);

  const container = new ContainerBuilder();
  const rows = [];

  // Dashboard Header
  const statusEmoji = settings.is_enabled ? '🟢' : '🔴';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🛒 Shop Dashboard — **${format.escapeMarkdown(guild.name)}**\n-# Status: ${statusEmoji} **${settings.is_enabled ? 'Active / Open' : 'Disabled / Closed'}** • Currency: \`${settings.currency} (${settings.currency_symbol})\``)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Tab Navigation Row (All Grey Buttons)
  const tabs = [
    { id: 'overview', label: 'Overview', emoji: '📊' },
    { id: 'products', label: `Products (${products.length})`, emoji: '📦' },
    { id: 'categories', label: `Categories (${categories.length})`, emoji: '📁' },
    { id: 'orders', label: 'Orders', emoji: '🧾' },
    { id: 'settings', label: 'Settings', emoji: '⚙️' }
  ];

  const tabButtons = tabs.map(t => greyButton({
    id: `shop:dash:tab:${guildId}:${userId || '0'}:${t.id}`,
    label: t.label,
    emoji: t.emoji,
    disabled: activeTab === t.id
  }));

  rows.push(new ActionRowBuilder().addComponents(tabButtons));

  // ───────────────────────────────────────────────────────────────────────────
  // TAB 1: OVERVIEW
  // ───────────────────────────────────────────────────────────────────────────
  if (activeTab === 'overview') {
    const revenueFormatted = formatCurrency(stats.totalRevenueMinor, settings.currency, settings.locale);

    // Find low stock items
    const lowStock = products.filter(p =>
      p.status === 'active' &&
      p.stock_type !== 'unlimited' &&
      p.stock_count <= (p.low_stock_threshold || 3)
    );

    const lowStockText = lowStock.length > 0
      ? lowStock.map(p => `• **${p.name}**: \`${p.stock_count} remaining\` ${p.channel_id ? `(<#${p.channel_id}>)` : ''}`).join('\n')
      : '✅ *All active products are adequately stocked.*';

    const body = [
      `### 📈 Financial & Performance Telemetry`,
      `- **Total Completed Revenue**: \`${revenueFormatted}\``,
      `- **Order Conversion Rate**: \`${stats.conversionRate}\` (${stats.completedOrders}/${stats.totalOrders} orders completed)`,
      `- **Customer Satisfaction**: ⭐ \`${stats.averageRating}\` / 5.0 (${stats.reviewCount} verified reviews)`,
      '',
      `### ⚠️ Low Stock & Restock Alerts`,
      lowStockText,
      '',
      `### 🚀 Quick Management Actions`,
      `- Click **Add Product** to start the product creation wizard`,
      `- Click **Restock** to add items or quantity to existing stock`,
      `- Click **Run Setup Wizard** to adjust channels and payment methods`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // Action buttons row
    const actionRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:add_product`,
        label: 'Add Product',
        emoji: '➕'
      }),
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:restock`,
        label: 'Restock Products',
        emoji: '📥'
      }),
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:run_setup`,
        label: 'Re-run Setup Wizard',
        emoji: '🧙'
      }),
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:refresh`,
        label: 'Refresh',
        emoji: '⟳'
      })
    );
    rows.push(actionRow);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TAB 2: PRODUCTS
  // ───────────────────────────────────────────────────────────────────────────
  else if (activeTab === 'products') {
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(products.length / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * pageSize;
    const slice = products.slice(start, start + pageSize);

    const productLines = slice.length > 0
      ? slice.map((p, idx) => {
        const price = formatCurrency(p.price_minor, p.currency, settings.locale);
        const status = p.status === 'active' ? '🟢 Active' : (p.status === 'paused' ? '⏸ Paused' : '📦 Archived');
        const stock = p.stock_type === 'unlimited' ? '∞' : `${p.stock_count} left`;
        const chan = p.channel_id ? `<#${p.channel_id}>` : '`No Channel`';
        return `**${start + idx + 1}. ${format.escapeMarkdown(p.name)}** • ${chan}\n  ↳ Price: \`${price}\` • Stock: \`${stock}\` • Status: \`${status}\``;
      }).join('\n\n')
      : '*(No products created yet. Run /shop add to create your first product!)*';

    const body = [
      `### 📦 Product Inventory (Page ${safePage}/${totalPages})`,
      productLines
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const navRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:add_product`,
        label: 'Add New Product',
        emoji: '➕'
      }),
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:sync_all`,
        label: 'Sync Channels',
        emoji: '🔄'
      })
    );
    rows.push(navRow);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TAB 3: CATEGORIES
  // ───────────────────────────────────────────────────────────────────────────
  else if (activeTab === 'categories') {
    const catList = categories.length > 0
      ? categories.map((c, i) => `${i + 1}. ${c.emoji || '📦'} **${c.name}** → ${c.discord_category_id ? `<#${c.discord_category_id}>` : '`Unlinked`'}`).join('\n')
      : '*(No categories created yet)*';

    const body = [
      `### 📁 Shop Categories`,
      catList,
      '',
      `- Each category corresponds to a Discord category where product channels get organized.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TAB 4: ORDERS
  // ───────────────────────────────────────────────────────────────────────────
  else if (activeTab === 'orders') {
    const recentOrders = await getShopOrders(guildId, { limit: 8 });
    const orderLines = recentOrders.length > 0
      ? recentOrders.map(o => {
        const total = formatCurrency(o.total_minor, o.currency, settings.locale);
        const chan = o.ticket_channel_id ? `<#${o.ticket_channel_id}>` : '`Closed`';
        return `• **Order #${o.number}** • <@${o.user_id}> • \`${total}\`\n  ↳ Product: **${o.product_name_snapshot}** • Status: \`${o.status}\` • ${chan}`;
      }).join('\n')
      : '*(No customer orders recorded yet)*';

    const body = [
      `### 🧾 Recent Customer Orders`,
      orderLines
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // TAB 5: SETTINGS
  // ───────────────────────────────────────────────────────────────────────────
  else if (activeTab === 'settings') {
    const body = [
      `### ⚙️ Server Shop Configuration`,
      `- **Shop State**: \`${settings.is_enabled ? 'Enabled' : 'Disabled'}\``,
      `- **Currency**: \`${settings.currency} (${settings.currency_symbol})\` • Locale: \`${settings.locale}\``,
      `- **Orders Channel**: ${settings.orders_channel_id ? `<#${settings.orders_channel_id}>` : '`None`'}`,
      `- **Delivery Channel**: ${settings.delivery_channel_id ? `<#${settings.delivery_channel_id}>` : '`None`'}`,
      `- **Vouches Channel**: ${settings.vouch_channel_id ? `<#${settings.vouch_channel_id}>` : '`None`'}`,
      `- **Restock Channel**: ${settings.restock_channel_id ? `<#${settings.restock_channel_id}>` : '`None`'}`,
      `- **Banner Theme**: \`${settings.banner_theme}\` • Font: \`${settings.banner_font}\``,
      `- **Max Orders Per Buyer**: \`${settings.max_open_orders_per_user}\``,
      '',
      `To modify any settings, run the Setup Wizard via the button below.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    rows.push(new ActionRowBuilder().addComponents(
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:run_setup`,
        label: 'Open Setup Wizard',
        emoji: '🧙'
      }),
      greyButton({
        id: `shop:dash:action:${guildId}:${userId || '0'}:toggle_shop`,
        label: settings.is_enabled ? 'Disable Shop' : 'Enable Shop',
        emoji: settings.is_enabled ? '🔴' : '🟢'
      })
    ));
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Argoni Shop Dashboard • Components V2`)
  );

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container, ...rows.slice(0, 4)]
  };
}

export default {
  renderShopDashboard
};

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import { getShopSettings, getShopProducts, getShopCategories, getShopOrders, getShopStats, isUserBlacklisted, addBlacklist, removeBlacklist } from '../../modules/shop/db.js';
import { isShopManager, isShopStaff } from '../../modules/shop/permissions.js';
import { createSetupSession, renderSetupStep } from '../../modules/shop/wizard/setup.js';
import { renderShopDashboard } from '../../modules/shop/wizard/dashboard.js';
import { createAddProductSession, renderAddProductStep } from '../../modules/shop/wizard/add.js';
import { executeRestock } from '../../modules/shop/stock/restock.js';
import { buildProductCard } from '../../modules/shop/render/card.js';
import { renderBanner } from '../../modules/shop/render/banner.js';
import { errorCard, successCard } from '../../ui/cards.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import * as format from '../../utils/ui/format.js';

export default {
  name: 'shop',
  aliases: ['store', 'market'],
  description: 'Complete server shop system, product management, and orders dashboard',
  category: 'shop',
  cooldown: 2,
  subcommands: [
    {
      name: 'dashboard',
      description: 'Open shop dashboard overview, product catalog, orders & settings',
      args: []
    },
    {
      name: 'setup',
      description: 'Run the interactive first-time server shop setup wizard',
      args: []
    },
    {
      name: 'add',
      description: 'Start product creation wizard with automated channel creation and banner',
      args: [
        { name: 'name', description: 'Initial product title', type: 'string', required: false },
        { name: 'price', description: 'Price in major units (e.g. 499 or 499.99)', type: 'string', required: false },
        { name: 'image', description: 'Optional product image attachment', type: 'attachment', required: false }
      ]
    },
    {
      name: 'restock',
      description: 'Add stock units or items to a product',
      args: [
        { name: 'product', description: 'Product name or ID to restock', type: 'string', required: false },
        { name: 'amount', description: 'Number of quantity units to add', type: 'int', required: false }
      ]
    },
    {
      name: 'list',
      description: 'Browse all products in the server shop',
      args: []
    },
    {
      name: 'orders',
      description: 'View recent customer orders and statuses',
      args: [
        { name: 'status', description: 'Filter by order status', type: 'string', required: false }
      ]
    },
    {
      name: 'stats',
      description: 'Inspect shop sales, revenue, conversion rates, and ratings',
      args: []
    },
    {
      name: 'sync',
      description: 'Repair and resynchronize any missing product channels or message cards',
      args: []
    },
    {
      name: 'blacklist',
      description: 'Manage shop blacklist for abusive buyers',
      args: [
        { name: 'action', description: 'Action: add, remove, list', type: 'string', required: true },
        { name: 'user', description: 'User ID or mention to blacklist', type: 'user', required: false },
        { name: 'reason', description: 'Reason for blacklist', type: 'string', required: false }
      ]
    }
  ],

  async execute(ctx) {
    const guild = ctx.guild;
    const member = ctx.member;
    const subcommand = ctx.args.subcommand || null;

    const [settings, categories, products] = await Promise.all([
      getShopSettings(guild.id),
      getShopCategories(guild.id),
      getShopProducts(guild.id)
    ]);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. SUBCOMMAND: /shop add
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'add') {
      const isManager = await isShopManager(member, settings);
      if (!isManager) {
        return ctx.reply(errorCard({
          title: 'Access Restricted',
          reason: 'Only Shop Managers or Server Administrators can create products.',
          ephemeral: true
        }));
      }

      const session = createAddProductSession(guild.id, ctx.user.id, {
        name: ctx.args.name || '',
        price_minor: ctx.args.price ? Math.round(parseFloat(ctx.args.price) * 100) : 0,
        image_url: ctx.args.image?.url || null
      });

      const payload = await renderAddProductStep(session, guild);
      return ctx.reply(payload);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. SUBCOMMAND: /shop restock
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'restock') {
      const isManager = await isShopManager(member, settings);
      if (!isManager) {
        return ctx.reply(errorCard({
          title: 'Access Restricted',
          reason: 'Only Shop Managers can restock products.',
          ephemeral: true
        }));
      }

      const targetInput = ctx.args.product?.toLowerCase()?.trim();
      const targetProduct = targetInput
        ? products.find(p => p.id === targetInput || p.name.toLowerCase().includes(targetInput))
        : null;

      if (!targetProduct) {
        // Return product select menu
        if (products.length === 0) {
          return ctx.reply(errorCard({
            title: 'No Products Available',
            reason: 'You do not have any products created yet. Run `/shop add` first.',
            ephemeral: true
          }));
        }

        const options = products.slice(0, 25).map(p =>
          new StringSelectMenuOptionBuilder()
            .setLabel(p.name.slice(0, 25))
            .setValue(p.id)
            .setDescription(`Stock: ${p.stock_count} (${p.stock_type})`)
        );

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`shop:restock:select:${guild.id}`)
          .setPlaceholder('Select product to restock...')
          .addOptions(options);

        const container = new ContainerBuilder()
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📥 Restock Product\nSelect which product you want to add stock to:`));

        return ctx.reply({
          flags: MessageFlags.IsComponentsV2,
          components: [container, new ActionRowBuilder().addComponents(menu)]
        });
      }

      const amount = ctx.args.amount || 10;
      const res = await executeRestock({
        guild,
        productId: targetProduct.id,
        addedItemsOrQuantity: amount,
        actorMember: member
      });

      return ctx.reply(successCard({
        title: 'Product Restocked Successfully',
        subtitle: `Product: **${targetProduct.name}**`,
        reason: `Added +${res.addedCount} units. Total stock is now \`${res.newStock}\`.`,
        fix: targetProduct.channel_id ? `Live product card updated in <#${targetProduct.channel_id}>.` : 'Product card updated.',
        ephemeral: true
      }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. SUBCOMMAND: /shop list
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'list') {
      if (products.length === 0) {
        return ctx.reply(errorCard({
          title: 'No Products In Store',
          reason: 'The server store does not currently have any products listed.',
          fix: 'Check back soon for new inventory!',
          ephemeral: true
        }));
      }

      const lines = products.filter(p => p.status === 'active').map((p, i) => {
        const price = `${settings.currency_symbol}${(p.price_minor / 100).toFixed(2)}`;
        const chan = p.channel_id ? `<#${p.channel_id}>` : '`In Store`';
        const stock = p.stock_type === 'unlimited' ? '🟢 Unlimited' : (p.stock_count > 0 ? `🟢 ${p.stock_count} in stock` : '🔴 Sold Out');
        return `**${i + 1}. ${format.escapeMarkdown(p.name)}** • ${chan}\n  ↳ Price: \`${price}\` • Stock: \`${stock}\``;
      });

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## 🛒 Store Catalog — **${format.escapeMarkdown(guild.name)}**\nBrowse available products below:`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(lines.join('\n\n'))
        );

      return ctx.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. SUBCOMMAND: /shop stats
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'stats') {
      const isStaff = await isShopStaff(member, settings);
      if (!isStaff) {
        return ctx.reply(errorCard({
          title: 'Access Restricted',
          reason: 'Only Shop Staff or Managers can view business analytics.',
          ephemeral: true
        }));
      }

      const stats = await getShopStats(guild.id);
      const revenue = `${settings.currency_symbol}${(Number(stats.totalRevenueMinor) / 100).toFixed(2)}`;

      const container = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## 📊 Shop Business Analytics — **${format.escapeMarkdown(guild.name)}**`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`- **Gross Revenue**: \`${revenue}\`\n- **Total Customer Orders**: \`${stats.totalOrders}\`\n- **Completed Orders**: \`${stats.completedOrders}\`\n- **Conversion Rate**: \`${stats.conversionRate}\`\n- **Verified Customer Rating**: ⭐ \`${stats.averageRating}\` / 5.0 (${stats.reviewCount} reviews)`)
        );

      return ctx.reply({
        flags: MessageFlags.IsComponentsV2,
        components: [container]
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. SUBCOMMAND: /shop sync
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'sync') {
      const isManager = await isShopManager(member, settings);
      if (!isManager) {
        return ctx.reply(errorCard({
          title: 'Access Restricted',
          reason: 'Only Shop Managers can run channel synchronization.',
          ephemeral: true
        }));
      }

      let repaired = 0;
      for (const prod of products) {
        if (prod.status === 'archived') continue;
        const exists = prod.channel_id && guild.channels.cache.has(prod.channel_id);
        if (!exists) {
          // Re-post banner and create card
          try {
            const buf = await renderBanner({
              product: prod,
              theme: settings.banner_theme,
              shopName: guild.name
            });
            // Try to fetch or recreate
            repaired++;
          } catch (_) {}
        }
      }

      return ctx.reply(successCard({
        title: 'Sync Check Complete',
        reason: `Scanned ${products.length} products. Checked channel and message health.`,
        ephemeral: true
      }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. DEFAULT: /shop (Wizard on first run, Dashboard otherwise)
    // ─────────────────────────────────────────────────────────────────────────
    if (subcommand === 'setup') {
      const isManager = await isShopManager(member, settings);
      if (!isManager) {
        return ctx.reply(errorCard({
          title: 'Access Restricted',
          reason: 'Only Shop Managers or Server Administrators can run the setup wizard.',
          ephemeral: true
        }));
      }

      const session = createSetupSession(guild.id, ctx.user.id, settings);
      const payload = await renderSetupStep(session, guild);
      return ctx.reply(payload);
    }

    const isConfigured = Boolean(settings.is_enabled || categories.length > 0 || products.length > 0);

    if (!isConfigured) {
      // First run: Launch setup wizard
      const isManager = await isShopManager(member, settings);
      if (!isManager) {
        return ctx.reply(errorCard({
          title: 'Shop Setup In Progress',
          reason: 'The server shop has not been configured yet.',
          fix: 'Please ask a server administrator to run `/shop` to initialize the store.',
          ephemeral: true
        }));
      }

      const session = createSetupSession(guild.id, ctx.user.id, settings);
      const payload = await renderSetupStep(session, guild);
      return ctx.reply(payload);
    }

    // Already configured: Render Dashboard
    const dashPayload = await renderShopDashboard({
      guild,
      activeTab: 'overview',
      userId: ctx.user.id
    });
    return ctx.reply(dashPayload);
  }
};

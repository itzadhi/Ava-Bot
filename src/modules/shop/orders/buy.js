import {
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';
import crypto from 'node:crypto';
import {
  getShopSettings,
  getShopProductById,
  isUserBlacklisted,
  getShopOrders,
  reserveStock,
  createShopOrder,
  addShopOrderEvent,
  updateShopOrder
} from '../db.js';
import { safeRespond } from '../../../core/interactions/safeRespond.js';
import { errorCard, successCard } from '../../../ui/cards.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import * as format from '../../../utils/ui/format.js';
import { logger } from '../../../utils/logger.js';

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
 * Handles the "Buy Now" button click on a product card
 */
export async function handleBuyNowClick(interaction, guildId, productId, requestedQuantity = 1) {
  const user = interaction.user;
  const guild = interaction.guild;

  // 1. Cached Pre-Flight Checks
  const [settings, product] = await Promise.all([
    getShopSettings(guildId),
    getShopProductById(productId)
  ]);

  if (!settings || !settings.is_enabled) {
    return safeRespond(interaction, errorCard({
      title: 'Shop Currently Closed',
      reason: 'The server shop is currently closed by the administration.',
      fix: 'Please check back later or contact server staff.',
      ephemeral: true
    }), { ephemeral: true });
  }

  if (!product || product.status !== 'active') {
    return safeRespond(interaction, errorCard({
      title: 'Product Unavailable',
      reason: 'This product is paused, out of stock, or archived.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // Check blacklist
  const isBlacklisted = await isUserBlacklisted(guildId, user.id);
  if (isBlacklisted) {
    return safeRespond(interaction, errorCard({
      title: 'Purchase Restricted',
      reason: 'You are restricted from placing orders in this shop.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // Check max open orders per user
  const userOrders = await getShopOrders(guildId, { userId: user.id });
  const openOrders = userOrders.filter(o => ['pending', 'awaiting_payment', 'paid'].includes(o.status));

  // Check if user already has an open order for this exact product
  const existingOrder = openOrders.find(o => o.product_id === productId);
  if (existingOrder && existingOrder.ticket_channel_id) {
    return safeRespond(interaction, errorCard({
      title: 'Active Order Exists',
      subtitle: `Order #${existingOrder.number}`,
      reason: `You already have an open order ticket for **${product.name}**.`,
      fix: `Please continue your purchase in <#${existingOrder.ticket_channel_id}>.`,
      ephemeral: true
    }), { ephemeral: true });
  }

  if (openOrders.length >= (settings.max_open_orders_per_user || 3)) {
    return safeRespond(interaction, errorCard({
      title: 'Order Limit Reached',
      reason: `You already have ${openOrders.length} active orders pending payment or delivery.`,
      fix: 'Please complete or cancel your existing orders before placing new ones.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // 2. Quantity Selection if product allows multiple units
  const maxPerOrder = Math.min(product.max_per_order || 1, product.stock_type === 'unlimited' ? 10 : (product.stock_count || 1));
  if (maxPerOrder > 1 && requestedQuantity === 1 && !interaction.customId?.includes(':qty_done:')) {
    const qtyOptions = [];
    for (let q = 1; q <= maxPerOrder; q++) {
      qtyOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`Quantity: ${q}`)
          .setValue(String(q))
          .setDescription(`Total: ${formatCurrency(product.price_minor * q, product.currency, settings.locale)}`)
      );
    }

    const qtyMenu = new StringSelectMenuBuilder()
      .setCustomId(`shop:buy_qty:${guildId}:${productId}`)
      .setPlaceholder('Select Quantity to Buy...')
      .addOptions(qtyOptions);

    const qtyContainer = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛒 Select Quantity: **${format.escapeMarkdown(product.name)}**\nChoose how many units you wish to purchase:`));

    return safeRespond(interaction, {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [qtyContainer, new ActionRowBuilder().addComponents(qtyMenu)]
    }, { ephemeral: true });
  }

  const quantity = Math.max(1, Math.min(requestedQuantity, maxPerOrder));
  const tempOrderId = crypto.randomUUID();

  // 3. Atomic Stock Reservation (Row lock FOR UPDATE SKIP LOCKED)
  const ttlMinutes = 30;
  const reserveResult = await reserveStock(productId, tempOrderId, quantity, ttlMinutes);

  if (!reserveResult || !reserveResult.success) {
    // Out of stock
    const outContainer = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🔴 Just Sold Out!\n**${format.escapeMarkdown(product.name)}** just ran out of available stock.`))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Click **Notify Me** below to receive an instant direct message when this product is restocked.`));

    const notifyBtn = greyButton({
      id: `shop:waitlist:${guildId}:${productId}`,
      label: 'Notify Me On Restock',
      emoji: '🔔'
    });

    return safeRespond(interaction, {
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      components: [outContainer, new ActionRowBuilder().addComponents(notifyBtn)]
    }, { ephemeral: true });
  }

  // 4. Create Order Record
  const unitPrice = BigInt(product.price_minor);
  const totalMinor = unitPrice * BigInt(quantity);
  const expiryDate = reserveResult.reserved_until || new Date(Date.now() + ttlMinutes * 60000).toISOString();

  const order = await createShopOrder({
    id: tempOrderId,
    guild_id: guildId,
    user_id: user.id,
    product_id: productId,
    product_name_snapshot: product.name,
    quantity,
    unit_price_minor: Number(unitPrice),
    total_minor: Number(totalMinor),
    currency: product.currency || settings.currency,
    status: 'awaiting_payment',
    reserved_until: expiryDate
  });

  await addShopOrderEvent(order.id, 'order_created', user.id, {
    quantity,
    totalMinor: Number(totalMinor)
  });

  // 5. Create Order Ticket Channel
  let ticketChannel = null;
  const me = guild.members.me;

  const overwrites = [
    // @everyone: No access
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    // Buyer: View & chat
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    // Bot: Full manage rights
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    }
  ];

  // Staff roles
  const staffRoles = [...(settings.manager_role_ids || []), ...(settings.support_role_ids || [])];
  for (const roleId of staffRoles) {
    if (guild.roles.cache.has(roleId)) {
      overwrites.push({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }
  }

  try {
    ticketChannel = await guild.channels.create({
      name: `order-${order.number}`,
      type: ChannelType.GuildText,
      parent: settings.ticket_category_id || null,
      permissionOverwrites: overwrites,
      topic: `Shop Order #${order.number} • Buyer: ${user.tag} (${user.id}) • Total: ${formatCurrency(totalMinor, order.currency, settings.locale)}`
    });
  } catch (chanErr) {
    logger.error({ err: chanErr.message }, 'Failed to create order ticket channel under category, retrying at root');
    ticketChannel = await guild.channels.create({
      name: `order-${order.number}`,
      type: ChannelType.GuildText,
      permissionOverwrites: overwrites
    });
  }

  // Update order with ticket channel ID
  await updateShopOrder(order.id, { ticket_channel_id: ticketChannel.id });

  // 6. Post Order Management Card into Ticket Channel
  await renderOrderTicketCard(ticketChannel, order, product, settings, user);

  // 7. Ephemeral confirmation to buyer
  return safeRespond(interaction, successCard({
    title: `Order #${order.number} Initialized!`,
    subtitle: `Product: **${format.escapeMarkdown(product.name)}** (x${quantity})`,
    reason: `Your private order ticket has been opened in <#${ticketChannel.id}>.`,
    fix: `Click <#${ticketChannel.id}> to view payment details and receive your items.`,
    ephemeral: true
  }), { ephemeral: true });
}

/**
 * Renders the official V2 Order Card inside the ticket channel
 */
export async function renderOrderTicketCard(ticketChannel, order, product, settings, buyer) {
  const container = new ContainerBuilder();
  const expiryUnix = Math.floor(new Date(order.reserved_until || Date.now() + 1800000).getTime() / 1000);
  const totalFormatted = formatCurrency(order.total_minor, order.currency, settings?.locale || 'en-IN');

  const paymentMethods = settings?.payment_methods || [];
  const paymentInstructions = paymentMethods.length > 0
    ? paymentMethods.map(m => `• **${m.name}**: \`${m.instructions}\``).join('\n')
    : '*(Please wait for staff to provide payment details below)*';

  const body = [
    `## 🧾 Order #${order.number} — **${format.escapeMarkdown(product.name)}**`,
    `- **Buyer**: <@${order.user_id}> (${buyer?.tag || order.user_id})`,
    `- **Quantity**: \`${order.quantity}\``,
    `- **Total Due**: **${totalFormatted}**`,
    `- **Status**: 🟡 \`${order.status.toUpperCase()}\``,
    `- **Stock Reserved Until**: <t:${expiryUnix}:R> *(expires automatically if unpaid)*`,
    '',
    `### 💳 Manual Payment Instructions`,
    paymentInstructions,
    '',
    `### 📌 Instructions`,
    `1. Complete the payment using one of the methods above.`,
    `2. Send your transaction screenshot / reference ID in this channel.`,
    `3. Click **I Have Paid** below to notify staff.`,
    `4. Staff will verify payment and click **Deliver** to send your purchase.`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  container.addSeparatorComponents(new SeparatorBuilder());

  // Buttons Row 1 (Buyer & Staff Actions)
  const row1 = new ActionRowBuilder().addComponents(
    greyButton({
      id: `shop:order:apply_coupon:${order.id}`,
      label: 'Apply Coupon',
      emoji: '🏷️'
    }),
    greyButton({
      id: `shop:order:i_paid:${order.id}`,
      label: 'I Have Paid',
      emoji: '💸'
    }),
    greyButton({
      id: `shop:order:mark_paid:${order.id}`,
      label: 'Mark Paid',
      emoji: '✅'
    }),
    greyButton({
      id: `shop:order:deliver:${order.id}`,
      label: 'Deliver Items',
      emoji: '📦'
    })
  );

  // Buttons Row 2 (Order Control & Cancel)
  const row2 = new ActionRowBuilder().addComponents(
    greyButton({
      id: `shop:order:cancel:${order.id}`,
      label: 'Cancel Order',
      emoji: '✖'
    }),
    greyButton({
      id: `shop:order:close:${order.id}`,
      label: 'Close Ticket',
      emoji: '🔒'
    })
  );

  return ticketChannel.send({
    content: `<@${order.user_id}> Your order ticket is ready!`,
    flags: MessageFlags.IsComponentsV2,
    components: [container, row1, row2]
  });
}

export default {
  handleBuyNowClick,
  renderOrderTicketCard
};

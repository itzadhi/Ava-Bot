import {
  ActionRowBuilder,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import crypto from 'node:crypto';
import { sessionStore } from '../../../core/interactions/session.js';
import { getShopSettings, getShopCategories, saveShopProduct, addEncryptedStockItems } from '../db.js';
import { encryptItem } from '../stock/encryption.js';
import { renderBanner } from '../render/banner.js';
import { buildProductCard } from '../render/card.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import * as format from '../../../utils/ui/format.js';
import { logger } from '../../../utils/logger.js';
import { perm } from '../../../core/permissions/permApply.js';

function parsePriceToMinor(priceStr) {
  if (!priceStr) return 0;
  const clean = String(priceStr).replace(/[^0-9.]/g, '');
  const val = parseFloat(clean);
  if (isNaN(val) || val <= 0) return 0;
  return Math.round(val * 100);
}

export function createAddProductSession(guildId, userId, initialData = {}) {
  const sessionData = {
    step: 1,
    category_id: initialData.category_id || null,
    name: initialData.name || '',
    price_minor: initialData.price_minor || 0,
    compare_at_minor: initialData.compare_at_minor || null,
    description: initialData.description || '',
    features: initialData.features || [],
    delivery_time_text: initialData.delivery_time_text || 'Instant Automated Delivery',
    warranty_text: initialData.warranty_text || '24 Hours Replacement Warranty',
    stock_type: initialData.stock_type || 'unlimited',
    stock_count: initialData.stock_count || 0,
    items: initialData.items || [],
    delivery_mode: initialData.delivery_mode || 'automatic',
    theme: initialData.theme || 'dark',
    image_url: initialData.image_url || null,
    previewBanner: false
  };

  return sessionStore.createSession({
    module: 'shop_add',
    guildId,
    userId,
    data: sessionData,
    ttlMs: 30 * 60 * 1000
  });
}

/**
 * Renders the product creation wizard step
 */
export async function renderAddProductStep(session, guild) {
  const step = session.data.step || 1;
  const sessionId = session.id;
  const guildId = session.guildId;

  const [settings, categories] = await Promise.all([
    getShopSettings(guildId),
    getShopCategories(guildId)
  ]);

  const container = new ContainerBuilder();
  const rows = [];
  let files = null;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 📦 Create New Product Wizard\n-# Step ${step} of 7 • Session \`${sessionId}\``)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: CATEGORY SELECTION
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    const selectedCat = categories.find(c => c.id === session.data.category_id);
    const body = [
      `### 1. Choose Product Category`,
      `Select which shop category this product belongs to. A dedicated Discord channel will be auto-created under this category.`,
      '',
      `- **Selected Category**: ${selectedCat ? `${selectedCat.emoji} **${selectedCat.name}**` : '*(None selected yet)*'}`,
      '',
      categories.length === 0
        ? '⚠️ *No shop categories exist yet! Please run `/shop` to configure categories first.*'
        : 'Select an option from the menu below:'
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    if (categories.length > 0) {
      const catOptions = categories.slice(0, 25).map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.name.slice(0, 25))
          .setValue(c.id)
          .setEmoji(c.emoji || '📦')
          .setDefault(c.id === session.data.category_id)
      );

      const menu = new StringSelectMenuBuilder()
        .setCustomId(`shop:add:${sessionId}:set_cat`)
        .setPlaceholder('Select Shop Category...')
        .addOptions(catOptions);

      rows.push(new ActionRowBuilder().addComponents(menu));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: PRODUCT NAME
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 2) {
    const body = [
      `### 2. Product Name & Identity`,
      `Enter the title for your product (1 to 80 characters).`,
      '',
      `- **Current Name**: ${session.data.name ? `**${format.escapeMarkdown(session.data.name)}**` : '*(Not entered)*'}`,
      '',
      `Click **Set Product Name** to open the input modal.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const nameBtn = greyButton({
      id: `shop:wizard:name:${sessionId}`,
      label: session.data.name ? 'Edit Name' : 'Set Product Name',
      emoji: '✏️'
    });
    rows.push(new ActionRowBuilder().addComponents(nameBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3: PRICE & SALE
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 3) {
    const priceFormatted = (session.data.price_minor / 100).toFixed(2);
    const compareFormatted = session.data.compare_at_minor
      ? (session.data.compare_at_minor / 100).toFixed(2)
      : null;

    const body = [
      `### 3. Product Pricing`,
      `Configure the sale price in \`${settings.currency}\`.`,
      '',
      `- **Sale Price**: \`${settings.currency_symbol}${priceFormatted}\``,
      `- **Original / Compare-At Price**: ${compareFormatted ? `\`${settings.currency_symbol}${compareFormatted}\` *(Discounts & strikethrough will be shown)*` : '`None`'}`,
      '',
      `Click **Set Price** to enter the amounts.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const priceBtn = greyButton({
      id: `shop:wizard:price:${sessionId}`,
      label: 'Set Price & Compare-At',
      emoji: '🏷️'
    });
    rows.push(new ActionRowBuilder().addComponents(priceBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4: CARD DETAILS & FEATURES
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 4) {
    const featuresList = session.data.features?.length > 0
      ? session.data.features.map(f => `  • ${f}`).join('\n')
      : '*(No bullets added)*';

    const body = [
      `### 4. Product Card Description & Features`,
      `Configure the short overview description, bullet points, delivery time, and warranty.`,
      '',
      `- **Description**: ${session.data.description || '*(None)*'}`,
      `- **Delivery Tagline**: \`${session.data.delivery_time_text}\``,
      `- **Warranty**: \`${session.data.warranty_text}\``,
      `**Features / Bullets:**\n${featuresList}`,
      '',
      `Click **Edit Card Content** below to fill in details.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const contentBtn = greyButton({
      id: `shop:wizard:content:${sessionId}`,
      label: 'Edit Card Content',
      emoji: '📝'
    });
    rows.push(new ActionRowBuilder().addComponents(contentBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5: STOCK TYPE, DELIVERY & LIMITS (DROPDOWNS)
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 5) {
    const stockType = session.data.stock_type || 'unlimited';
    const deliveryMode = session.data.delivery_mode || 'automatic';
    const limit = session.data.max_per_order || 'unlimited';

    const body = [
      `### 5. Stock Mode & Fulfillment Settings`,
      `Select how inventory is tracked, customer purchase limits, and delivery fulfillment.`,
      '',
      `- **Stock Type**: \`${stockType.toUpperCase()}\` (${session.data.stock_count || 0} units)`,
      `- **Delivery**: \`${deliveryMode.toUpperCase()}\` *(automated in ticket or manual by staff)*`,
      `- **Max per Order**: \`${limit}\``,
      '',
      `Select settings using the dropdowns below:`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // 1. Stock Type Select
    const stockSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:add:${sessionId}:set_stock_type`)
      .setPlaceholder('Select Stock Management Type...')
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Unlimited').setDescription('Always available for purchase (e.g. services, subscriptions)').setValue('unlimited').setDefault(stockType === 'unlimited'),
        new StringSelectMenuOptionBuilder().setLabel('Quantity Slots').setDescription('Fixed stock count (e.g. 50 slots)').setValue('quantity').setDefault(stockType === 'quantity'),
        new StringSelectMenuOptionBuilder().setLabel('Unique Items / Keys').setDescription('Encrypted account credentials or product keys').setValue('items').setDefault(stockType === 'items')
      ]);

    // 2. Delivery Mode Select
    const deliverySelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:add:${sessionId}:set_delivery_mode`)
      .setPlaceholder('Select Delivery Mode...')
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Automated Delivery').setDescription('Bot instantly delivers items in order ticket after payment').setValue('automatic').setDefault(deliveryMode === 'automatic'),
        new StringSelectMenuOptionBuilder().setLabel('Manual Staff Delivery').setDescription('Staff manually delivers orders in order ticket').setValue('manual').setDefault(deliveryMode === 'manual')
      ]);

    // 3. Max Per Order Select
    const limitSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:add:${sessionId}:set_limit`)
      .setPlaceholder('Select Maximum Items Per Order...')
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('1 item per order').setValue('1').setDefault(String(limit) === '1'),
        new StringSelectMenuOptionBuilder().setLabel('2 items per order').setValue('2').setDefault(String(limit) === '2'),
        new StringSelectMenuOptionBuilder().setLabel('3 items per order').setValue('3').setDefault(String(limit) === '3'),
        new StringSelectMenuOptionBuilder().setLabel('5 items per order').setValue('5').setDefault(String(limit) === '5'),
        new StringSelectMenuOptionBuilder().setLabel('10 items per order').setValue('10').setDefault(String(limit) === '10'),
        new StringSelectMenuOptionBuilder().setLabel('Unlimited items').setValue('unlimited').setDefault(String(limit) === 'unlimited')
      ]);

    rows.push(new ActionRowBuilder().addComponents(stockSelect));
    rows.push(new ActionRowBuilder().addComponents(deliverySelect));
    rows.push(new ActionRowBuilder().addComponents(limitSelect));

    if (stockType === 'items') {
      const itemsBtn = greyButton({
        id: `shop:wizard:items:${sessionId}`,
        label: `Paste Stock Items (${session.data.items?.length || 0} loaded)`,
        emoji: '📋'
      });
      rows.push(new ActionRowBuilder().addComponents(itemsBtn));
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6: BANNER THEME & PREVIEW
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 6) {
    const body = [
      `### 6. Banner Theme & Preview`,
      `Select a banner aesthetic for the product card.`,
      '',
      `- **Theme**: \`${session.data.theme.toUpperCase()}\``,
      '',
      `Click **Preview Banner** to generate a live rendering of your product card before publishing.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const themeMenu = new StringSelectMenuBuilder()
      .setCustomId(`shop:add:${sessionId}:set_theme`)
      .setPlaceholder(`Choose Banner Theme (Current: ${session.data.theme})`)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Dark Luxe').setValue('dark').setDefault(session.data.theme === 'dark'),
        new StringSelectMenuOptionBuilder().setLabel('Clean Slate (Light)').setValue('light').setDefault(session.data.theme === 'light'),
        new StringSelectMenuOptionBuilder().setLabel('Cyberpunk Neon').setValue('neon').setDefault(session.data.theme === 'neon'),
        new StringSelectMenuOptionBuilder().setLabel('Carbon Minimal').setValue('minimal').setDefault(session.data.theme === 'minimal')
      ]);
    rows.push(new ActionRowBuilder().addComponents(themeMenu));

    const prevBtn = greyButton({
      id: `shop:add:${sessionId}:preview_banner`,
      label: 'Preview Banner',
      emoji: '🖼️'
    });
    rows.push(new ActionRowBuilder().addComponents(prevBtn));

    if (session.data.previewBanner) {
      try {
        const cat = categories.find(c => c.id === session.data.category_id);
        const buf = await renderBanner({
          product: {
            id: 'preview',
            name: session.data.name || 'Sample Product',
            price_minor: session.data.price_minor || 49900,
            compare_at_minor: session.data.compare_at_minor,
            currency: settings.currency,
            stock_count: session.data.stock_count,
            stock_type: session.data.stock_type,
            status: 'active',
            delivery_time_text: session.data.delivery_time_text
          },
          theme: session.data.theme,
          categoryName: cat?.name || 'Store',
          shopName: guild.name
        });
        files = [{ attachment: buf, name: 'preview.png' }];
      } catch (_) {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 7: REVIEW & PUBLISH
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 7) {
    const cat = categories.find(c => c.id === session.data.category_id);
    const priceStr = `${settings.currency_symbol}${(session.data.price_minor / 100).toFixed(2)}`;

    const body = [
      `### 7. Review & Auto-Publish`,
      `Your product is ready to be published! The bot will automatically:`,
      `1. Create a dedicated channel in category **${cat?.name || 'Shop'}**`,
      `2. Set read-only member permissions and full staff permissions`,
      `3. Render and upload the official 1200x400 canvas banner`,
      `4. Post the V2 product card and pin it to the channel`,
      `5. Save the product channel ID and message ID to database`,
      '',
      `**Summary:**`,
      `- **Name**: **${format.escapeMarkdown(session.data.name)}**`,
      `- **Price**: \`${priceStr}\``,
      `- **Stock**: \`${session.data.stock_type.toUpperCase()}\` (${session.data.stock_count} units)`,
      `- **Category**: ${cat ? `${cat.emoji} ${cat.name}` : '`None`'}`,
      '',
      `Click **Publish Product** to complete creation!`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const pubBtn = greyButton({
      id: `shop:add:${sessionId}:publish`,
      label: 'Publish Product & Create Channel',
      emoji: '🚀'
    });
    rows.push(new ActionRowBuilder().addComponents(pubBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // NAVIGATION CONTROLS
  // ───────────────────────────────────────────────────────────────────────────
  const navButtons = [];
  if (step > 1) {
    navButtons.push(greyButton({
      id: `shop:add:${sessionId}:prev`,
      label: 'Back',
      emoji: '◀'
    }));
  }

  if (step < 7) {
    const canProceed = (step === 1 && session.data.category_id) ||
                       (step === 2 && session.data.name) ||
                       (step === 3 && session.data.price_minor > 0) ||
                       (step >= 4);

    navButtons.push(greyButton({
      id: `shop:add:${sessionId}:next`,
      label: 'Next',
      emoji: '▶',
      disabled: !canProceed
    }));
  }

  navButtons.push(greyButton({
    id: `shop:add:${sessionId}:cancel`,
    label: 'Cancel',
    emoji: '✖'
  }));

  rows.push(new ActionRowBuilder().addComponents(navButtons));

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container, ...rows.slice(0, 4)]
  };

  if (files) {
    payload.files = files;
  }

  return payload;
}

/**
 * Executes automatic channel creation, permission setup, banner rendering, card posting, and pinning
 */
export async function publishProductChannel(guildOrOpts, maybeProduct = null, maybeSession = null) {
  let guild, productData, sessionData;
  if (guildOrOpts && typeof guildOrOpts === 'object' && guildOrOpts.guild) {
    guild = guildOrOpts.guild;
    const session = guildOrOpts.session;
    productData = guildOrOpts.productData || session?.data || {};
    sessionData = session?.data || {};
  } else {
    guild = guildOrOpts;
    productData = maybeProduct || {};
    sessionData = maybeSession || {};
  }

  const me = guild.members?.me;
  const categories = await getShopCategories(guild.id);
  const category = categories.find(c => c.id === productData.category_id);
  const settings = await getShopSettings(guild.id);

  // 1. Sanitize channel name: {emoji}-{slug} capped at 100 characters
  const cleanSlug = productData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  const channelName = `${cleanSlug}`;

  // 2. Build permission overwrites
  const permissionOverwrites = [
    // @everyone: View and Read history only, no sending or thread creation
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.AddReactions]
    },
    // Bot: Full manage rights
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  // Add staff & manager roles
  const staffRoleIds = [...(settings.manager_role_ids || []), ...(settings.support_role_ids || [])];
  for (const roleId of staffRoleIds) {
    if (guild.roles.cache.has(roleId)) {
      permissionOverwrites.push({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages]
      });
    }
  }

  // 3. Create Discord channel under category
  const permRes = await perm.apply({
    guildId: guild.id,
    feature: 'shop',
    targetType: 'channel',
    targetId: 'new',
    op: 'create_channel_with_overwrites',
    field: 'permissionOverwrites',
    oldValue: null,
    newValue: permissionOverwrites,
    reason: `AVA Shop: Create product channel for ${productData.name}`,
    execute: () => guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category?.discord_category_id || null,
      permissionOverwrites,
      topic: `Official Product Channel for ${productData.name} • Price: ${settings.currency_symbol}${(productData.price_minor / 100).toFixed(2)}`
    })
  });
  if (!permRes.executed || !permRes.result) {
    throw new Error('Channel creation refused: PERMISSION_WRITES is off');
  }
  const channel = permRes.result;

  // Pre-generate permanent product UUID so cards and banners have a real ID immediately
  const productId = productData.id || crypto.randomUUID();
  productData.id = productId;

  // 4. Render product banner
  const bannerBuffer = await renderBanner({
    product: productData,
    theme: sessionData.theme || settings.banner_theme,
    categoryName: category?.name || 'Products',
    shopName: guild.name
  });

  // 5. Build and send V2 product card
  const cardPayload = buildProductCard({
    product: {
      ...productData,
      id: productId,
      guild_id: guild.id
    },
    category,
    settings,
    bannerBuffer
  });

  const productMessage = await channel.send(cardPayload);

  // Pin product card
  await productMessage.pin().catch(() => {});

  // 6. Save product to database with channel & message ID
  const savedProduct = await saveShopProduct({
    ...productData,
    id: productId,
    guild_id: guild.id,
    channel_id: channel.id,
    message_id: productMessage.id,
    status: 'active',
    stock_count: productData.stock_type === 'items' ? (sessionData.items?.length || 0) : productData.stock_count
  });

  // 7. If items stock, encrypt and store items
  if (productData.stock_type === 'items' && Array.isArray(sessionData.items) && sessionData.items.length > 0) {
    const encrypted = sessionData.items.map(itemStr => encryptItem(itemStr));
    await addEncryptedStockItems(savedProduct.id, encrypted, guild.id);
  }

  // 8. Log creation to orders/log channel
  if (settings.orders_channel_id) {
    const logChan = guild.channels.cache.get(settings.orders_channel_id);
    if (logChan && logChan.isTextBased()) {
      const logContainer = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📦 Product Published: **${format.escapeMarkdown(productData.name)}**`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`Channel: <#${channel.id}>\nPrice: \`${settings.currency_symbol}${(productData.price_minor / 100).toFixed(2)}\`\nStock: \`${productData.stock_type.toUpperCase()}\``));

      logChan.send({
        flags: MessageFlags.IsComponentsV2,
        components: [logContainer]
      }).catch(() => {});
    }
  }

  return {
    product: savedProduct,
    channel,
    message: productMessage
  };
}

export default {
  createAddProductSession,
  renderAddProductStep,
  publishProductChannel
};

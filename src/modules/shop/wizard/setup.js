import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import { sessionStore } from '../../../core/interactions/session.js';
import { getShopSettings, updateShopSettings, getShopCategories, saveShopCategory } from '../db.js';
import { getGuildRoles } from '../../../db/permify.js';
import { isCanvasAvailable } from '../render/canvasAdapter.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import { renderBanner } from '../render/banner.js';
import * as format from '../../../utils/ui/format.js';

function getProgressBar(current, total = 7) {
  const filled = '▰'.repeat(current);
  const empty = '▱'.repeat(total - current);
  return `${filled}${empty} ${current}/${total}`;
}

export function createSetupSession(guildId, userId, existingSettings = null) {
  const sessionData = {
    step: 1,
    is_enabled: existingSettings?.is_enabled ?? true,
    currency: existingSettings?.currency || 'INR',
    currency_symbol: existingSettings?.currency_symbol || '₹',
    locale: existingSettings?.locale || 'en-IN',
    payment_methods: existingSettings?.payment_methods?.length ? existingSettings.payment_methods : [
      { id: 'upi', name: 'UPI', instructions: 'Send payment via UPI and share screenshot in ticket.' }
    ],
    categories: [],
    ticket_category_id: existingSettings?.ticket_category_id || null,
    support_role_ids: existingSettings?.support_role_ids || [],
    manager_role_ids: existingSettings?.manager_role_ids || [],
    buyer_role_id: existingSettings?.buyer_role_id || null,
    max_open_orders_per_user: existingSettings?.max_open_orders_per_user || 3,
    orders_channel_id: existingSettings?.orders_channel_id || null,
    delivery_channel_id: existingSettings?.delivery_channel_id || null,
    vouch_channel_id: existingSettings?.vouch_channel_id || null,
    restock_channel_id: existingSettings?.restock_channel_id || null,
    restock_ping_role_id: existingSettings?.restock_ping_role_id || null,
    banner_theme: existingSettings?.banner_theme || 'dark',
    banner_font: existingSettings?.banner_font || 'Inter',
    stock_display_mode: existingSettings?.stock_display_mode || 'exact',
    low_stock_threshold: existingSettings?.low_stock_threshold || 3
  };

  return sessionStore.createSession({
    module: 'shop_setup',
    guildId,
    userId,
    data: sessionData,
    ttlMs: 30 * 60 * 1000
  });
}

/**
 * Checks all bot permissions required for complete shop automation
 */
export function checkShopPermissions(guild) {
  const me = guild.members.me;
  if (!me) return { ok: false, missing: ['Bot Member Missing'] };

  const required = [
    { bit: PermissionFlagsBits.ManageChannels, name: 'Manage Channels' },
    { bit: PermissionFlagsBits.ManageRoles, name: 'Manage Roles' },
    { bit: PermissionFlagsBits.ViewChannel, name: 'View Channels' },
    { bit: PermissionFlagsBits.SendMessages, name: 'Send Messages' },
    { bit: PermissionFlagsBits.AttachFiles, name: 'Attach Files' },
    { bit: PermissionFlagsBits.EmbedLinks, name: 'Embed Links' },
    { bit: PermissionFlagsBits.ManageMessages, name: 'Manage Messages' }
  ];

  const missing = required.filter(r => !me.permissions.has(r.bit)).map(r => r.name);
  const canvasOk = isCanvasAvailable();
  if (!canvasOk) {
    missing.push('Canvas Rendering Engine');
  }

  return {
    ok: missing.length === 0,
    missing
  };
}

/**
 * Renders the current setup wizard step payload (Components V2 only)
 */
export async function renderSetupStep(session, guild) {
  const step = session.data.step || 1;
  const sessionId = session.id;
  const guildId = session.guildId;
  const userId = session.userId;

  const container = new ContainerBuilder();
  const rows = [];
  let files = null;

  // Header & Progress Bar
  const progress = getProgressBar(step, 7);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🛒 Shop Initial Setup Wizard\n\`${progress}\``)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: WELCOME & PERMISSIONS CHECK
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    const permCheck = checkShopPermissions(guild);
    const permStatus = permCheck.ok
      ? '🟢 **All required permissions and canvas engine are active!**'
      : `🔴 **Missing Requirements:**\n${permCheck.missing.map(m => `  • \`${m}\``).join('\n')}`;

    const body = [
      `Welcome to **Argoni Shop**! This wizard configures automated product channels, instant tickets, atomic stock locking, and canvas banners in 7 easy steps.`,
      '',
      `### 🛡️ System Requirements & Diagnostics`,
      permStatus,
      '',
      `### ⚙️ Initial Shop State`,
      `- **Shop Active**: \`${session.data.is_enabled ? 'Enabled' : 'Disabled'}\``,
      '- **Concurrency Guard**: Atomic row locking (`FOR UPDATE SKIP LOCKED`) active',
      '- **Components Specification**: 100% Pure Components V2'
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // Enable/Disable toggle button
    const toggleBtn = greyButton({
      id: `shop:setup:${sessionId}:toggle_enabled`,
      label: session.data.is_enabled ? 'Shop is Enabled' : 'Shop is Disabled',
      emoji: session.data.is_enabled ? '🟢' : '🔴'
    });
    rows.push(new ActionRowBuilder().addComponents(toggleBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: CATEGORIES SETUP
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 2) {
    const cats = session.data.categories || [];
    const catList = cats.length > 0
      ? cats.map((c, i) => `${i + 1}. ${c.emoji || '📦'} **${c.name}** → <#${c.discord_category_id}>`).join('\n')
      : '*(No shop categories created yet. Select a Discord category below or click Create New)*';

    const body = [
      `### 📁 Shop Categories`,
      `Each shop category maps to a Discord category where product channels get posted and synchronized.`,
      '',
      `**Current Categories:**`,
      catList,
      '',
      `- Select an existing Discord Category from the dropdown menu to link it`,
      `- Or click **Create Category** to enter a custom name and emoji`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // Discord Category Select
    const catSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:cat_select`)
      .setPlaceholder('Pick a Discord Category to add...')
      .setChannelTypes(ChannelType.GuildCategory);
    rows.push(new ActionRowBuilder().addComponents(catSelect));

    // Create New Category Modal Button
    const createCatBtn = greyButton({
      id: `shop:wizard:category_create:${sessionId}`,
      label: 'Create Custom Category',
      emoji: '➕'
    });
    rows.push(new ActionRowBuilder().addComponents(createCatBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3: CURRENCY & PAYMENTS
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 3) {
    const methods = session.data.payment_methods || [];
    const methodsList = methods.map((m, i) => `${i + 1}. **${m.name}**: \`${m.instructions.slice(0, 50)}...\``).join('\n');

    const body = [
      `### 💳 Currency & Payment Methods`,
      `Configure the display currency and staff payment instructions. Payments are **manually confirmed by staff** in the order ticket.`,
      '',
      `- **Current Currency**: \`${session.data.currency}\` (${session.data.currency_symbol})`,
      `- **Locale**: \`${session.data.locale}\``,
      '',
      `**Active Manual Payment Methods:**`,
      methodsList || '*(None configured)*',
      '',
      `- Select currency from dropdown below, or click **Add Payment Method**`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const currSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:curr_select`)
      .setPlaceholder(`Change Currency (Current: ${session.data.currency})`)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('INR (₹) - Indian Rupee').setValue('INR:₹:en-IN').setDefault(session.data.currency === 'INR'),
        new StringSelectMenuOptionBuilder().setLabel('USD ($) - US Dollar').setValue('USD:$:en-US').setDefault(session.data.currency === 'USD'),
        new StringSelectMenuOptionBuilder().setLabel('EUR (€) - Euro').setValue('EUR:€:de-DE').setDefault(session.data.currency === 'EUR'),
        new StringSelectMenuOptionBuilder().setLabel('GBP (£) - British Pound').setValue('GBP:£:en-GB').setDefault(session.data.currency === 'GBP')
      ]);
    rows.push(new ActionRowBuilder().addComponents(currSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4: TICKET INTEGRATION & ROLES
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 4) {
    const managerCount = session.data.manager_role_ids?.length || 0;
    const supportCount = session.data.support_role_ids?.length || 0;

    const body = [
      `### 🎫 Order Ticket Integration & Roles`,
      `When buyers click **Buy Now**, an order ticket is created where they can apply coupons, view payment details, and receive items.`,
      '',
      `- **Ticket Category**: ${session.data.ticket_category_id ? `<#${session.data.ticket_category_id}>` : '*(Default / Automatic)*'}`,
      `- **Shop Managers**: \`${managerCount} role(s) configured\``,
      `- **Shop Staff / Support**: \`${supportCount} role(s) configured\``,
      `- **Max Open Orders Per Buyer**: \`${session.data.max_open_orders_per_user}\``,
      '',
      `*Use the menus below to assign staff roles and the ticket category.*`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    // Ticket category select
    const ticketCatSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:tkt_cat_select`)
      .setPlaceholder('Pick Ticket Category for Orders...')
      .setChannelTypes(ChannelType.GuildCategory);
    rows.push(new ActionRowBuilder().addComponents(ticketCatSelect));

    // Manager roles select
    const managerRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:mgr_role_select`)
      .setPlaceholder('Select Shop Manager Roles...')
      .setMaxValues(5);
    rows.push(new ActionRowBuilder().addComponents(managerRoleSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5: LOG & ANNOUNCEMENT CHANNELS
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 5) {
    const body = [
      `### 📢 Dedicated Channels & Restock Notifications`,
      `Set up automated delivery logs, vouch logs, and restock announcement pings.`,
      '',
      `- **Orders Log**: ${session.data.orders_channel_id ? `<#${session.data.orders_channel_id}>` : '`Not Set`'}`,
      `- **Staff Delivery Log**: ${session.data.delivery_channel_id ? `<#${session.data.delivery_channel_id}>` : '`Not Set`'}`,
      `- **Vouches / Reviews**: ${session.data.vouch_channel_id ? `<#${session.data.vouch_channel_id}>` : '`Not Set`'}`,
      `- **Restock Announcements**: ${session.data.restock_channel_id ? `<#${session.data.restock_channel_id}>` : '`Not Set`'}`,
      `- **Restock Ping Role**: ${session.data.restock_ping_role_id ? `<@&${session.data.restock_ping_role_id}>` : '`None`'}`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const chanSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:orders_chan_select`)
      .setPlaceholder('Pick Orders Log Channel...')
      .setChannelTypes(ChannelType.GuildText);
    rows.push(new ActionRowBuilder().addComponents(chanSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6: BANNER THEME & STYLING
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 6) {
    const body = [
      `### 🎨 Canvas Banner Theme & Aesthetics`,
      `Product cards feature automated 1200x400 high-resolution canvas banners.`,
      '',
      `- **Active Theme**: \`${session.data.banner_theme.toUpperCase()}\``,
      `- **Font Family**: \`${session.data.banner_font}\``,
      `- **Stock Display**: \`${session.data.stock_display_mode}\``,
      '',
      `Click **Preview Banner** below to render a live banner test using your settings!`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    const themeSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:setup:${sessionId}:theme_select`)
      .setPlaceholder(`Choose Banner Theme (Current: ${session.data.banner_theme})`)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Dark Luxe (Recommended)').setValue('dark').setDescription('Deep indigo & obsidian background with crisp white typography').setDefault(session.data.banner_theme === 'dark'),
        new StringSelectMenuOptionBuilder().setLabel('Clean Slate (Light)').setValue('light').setDescription('Pearl frosted gradient with deep contrast text').setDefault(session.data.banner_theme === 'light'),
        new StringSelectMenuOptionBuilder().setLabel('Cyberpunk Neon').setValue('neon').setDescription('Electric magenta & cyan highlights on dark violet').setDefault(session.data.banner_theme === 'neon'),
        new StringSelectMenuOptionBuilder().setLabel('Carbon Minimal').setValue('minimal').setDescription('Monochrome zinc & carbon styling').setDefault(session.data.banner_theme === 'minimal')
      ]);
    rows.push(new ActionRowBuilder().addComponents(themeSelect));

    const previewBtn = greyButton({
      id: `shop:setup:${sessionId}:preview_banner`,
      label: 'Preview Sample Banner',
      emoji: '🖼️'
    });
    rows.push(new ActionRowBuilder().addComponents(previewBtn));

    if (session.data.showPreview) {
      try {
        const sampleBuf = await renderBanner({
          product: {
            id: 'sample',
            name: 'Sample Product Key',
            price_minor: 49900,
            compare_at_minor: 79900,
            currency: session.data.currency,
            stock_count: 10,
            status: 'active',
            delivery_time_text: 'Instant Automated Delivery'
          },
          theme: session.data.banner_theme,
          categoryName: 'Preview Category',
          shopName: guild.name
        });
        files = [{ attachment: sampleBuf, name: 'preview.png' }];
      } catch (_) {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 7: REVIEW & APPLY
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 7) {
    const summary = [
      `### 📋 Setup Summary & Confirmation`,
      `Please review your shop configuration before finalizing.`,
      '',
      `- **Shop Status**: \`${session.data.is_enabled ? 'Active / Enabled' : 'Disabled'}\``,
      `- **Currency**: \`${session.data.currency} (${session.data.currency_symbol})\``,
      `- **Categories Configured**: \`${session.data.categories?.length || 0} category(s)\``,
      `- **Payment Methods**: \`${session.data.payment_methods?.length || 0} manual method(s)\``,
      `- **Banner Theme**: \`${session.data.banner_theme}\``,
      `- **Orders Channel**: ${session.data.orders_channel_id ? `<#${session.data.orders_channel_id}>` : '`None`'}`,
      '',
      `Click **Apply & Save** to persist all settings to Supabase and open the Shop Dashboard.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

    const applyBtn = greyButton({
      id: `shop:setup:${sessionId}:apply_confirm`,
      label: 'Apply & Save Configuration',
      emoji: '✅'
    });
    rows.push(new ActionRowBuilder().addComponents(applyBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // NAVIGATION CONTROLS (Back / Next / Cancel)
  // ───────────────────────────────────────────────────────────────────────────
  const navButtons = [];
  if (step > 1) {
    navButtons.push(greyButton({
      id: `shop:setup:${sessionId}:prev`,
      label: 'Back',
      emoji: '◀'
    }));
  }

  if (step < 7) {
    navButtons.push(greyButton({
      id: `shop:setup:${sessionId}:next`,
      label: 'Next',
      emoji: '▶'
    }));
  }

  navButtons.push(greyButton({
    id: `shop:setup:${sessionId}:cancel`,
    label: 'Cancel',
    emoji: '✖'
  }));

  rows.push(new ActionRowBuilder().addComponents(navButtons));

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Argoni Shop System • Step ${step} of 7 • Components V2`)
  );

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container, ...rows.slice(0, 4)]
  };

  if (files) {
    payload.files = files;
  }

  return payload;
}

export default {
  createSetupSession,
  checkShopPermissions,
  renderSetupStep
};

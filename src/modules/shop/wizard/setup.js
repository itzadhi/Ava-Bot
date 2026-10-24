import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder
} from 'discord.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import { buildId } from '../../../core/interactions/ownership.js';
import { copy } from '../../../config/copy.js';
import { renderBanner } from '../render/banner.js';
import { sessionStore } from '../../../core/interactions/session.js';

const TOTAL_STEPS = 8;

/**
 * Creates a fresh session for /shop setup wizard
 */
export function createSetupSession({ guildId, userId, currentSettings = null }) {
  const defaults = {
    step: 1,
    is_enabled: currentSettings?.is_enabled ?? false,
    currency: currentSettings?.currency || 'INR',
    currency_symbol: currentSettings?.currency_symbol || '₹',
    locale: currentSettings?.locale || 'en-IN',
    categories: [],
    payment_methods: currentSettings?.payment_methods || [],
    ticket_category_id: currentSettings?.ticket_category_id || null,
    manager_role_ids: currentSettings?.manager_role_ids || [],
    support_role_ids: currentSettings?.support_role_ids || [],
    max_open_orders_per_user: currentSettings?.max_open_orders_per_user || 2,
    reservation_minutes: currentSettings?.reservation_minutes || 30,
    orders_channel_id: currentSettings?.orders_channel_id || null,
    delivery_channel_id: currentSettings?.delivery_channel_id || null,
    vouch_channel_id: currentSettings?.vouch_channel_id || null,
    restock_channel_id: currentSettings?.restock_channel_id || null,
    restock_ping_role_id: currentSettings?.restock_ping_role_id || null,
    banner_theme: currentSettings?.banner_theme || 'dark',
    banner_font: currentSettings?.banner_font || 'Inter',
    stock_display_mode: currentSettings?.stock_display_mode || 'exact',
    low_stock_threshold: currentSettings?.low_stock_threshold || 3,
    showPreview: false
  };

  return sessionStore.createSession({
    module: 'shop_setup',
    guildId,
    userId,
    ownerId: userId,
    data: defaults,
    ttlMs: 60 * 60 * 1000 // 60 minutes
  });
}

/**
 * Builds standard customId for setup wizard components
 */
function makeCustomId(session, action) {
  return buildId({
    module: 'shop',
    action: 'setup',
    guildId: session.guildId,
    ownerId: session.userId,
    key: `${session.id}:${action}`
  });
}

/**
 * Renders the current setup wizard step payload (Components V2 only, dropdown-first)
 */
export async function renderSetupStep(session, guild) {
  const step = session.data.step || 1;
  const sessionId = session.id;
  const guildId = session.guildId;
  const userId = session.userId;

  const container = new ContainerBuilder();
  const rows = [];
  let files = null;

  // Header
  const title = `## ${copy.shop.wizard.title}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  container.addSeparatorComponents(new SeparatorBuilder());

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 1: SHOP STATUS
  // ───────────────────────────────────────────────────────────────────────────
  if (step === 1) {
    const isEnabled = Boolean(session.data.is_enabled);
    const subHeader = `### ${copy.shop.wizard.step1.subtitle}\n${copy.shop.wizard.step1.desc}`;
    const statusLine = `Current status: **${isEnabled ? 'Enabled' : 'Disabled'}**`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${statusLine}`));

    const statusSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'status_select'))
      .setPlaceholder(copy.shop.wizard.step1.dropdownPlaceholder)
      .addOptions([
        new StringSelectMenuOptionBuilder()
          .setLabel('Enabled')
          .setDescription('Shop is open and customers can browse and order products')
          .setValue('enabled')
          .setDefault(isEnabled),
        new StringSelectMenuOptionBuilder()
          .setLabel('Disabled')
          .setDescription('Shop is closed and product purchases are paused')
          .setValue('disabled')
          .setDefault(!isEnabled)
      ]);

    rows.push(new ActionRowBuilder().addComponents(statusSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 2: CATEGORIES SETUP
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 2) {
    const cats = session.data.categories || [];
    const catList = cats.length > 0
      ? cats.map((c, i) => `• ${c.emoji || '📦'} **${c.name}** (<#${c.discord_category_id}>)`).join('\n')
      : '*(No categories selected yet. Pick categories from the dropdown below)*';

    const subHeader = `### ${copy.shop.wizard.step2.subtitle}\n${copy.shop.wizard.step2.desc}`;
    const currentLine = `**Current Categories:**\n${catList}`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const catSelect = new ChannelSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'cat_select'))
      .setPlaceholder(copy.shop.wizard.step2.selectPlaceholder)
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(0)
      .setMaxValues(Math.min(5, 25));

    rows.push(new ActionRowBuilder().addComponents(catSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 3: CURRENCY SELECTION
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 3) {
    const currentCurr = session.data.currency || 'INR';
    const subHeader = `### ${copy.shop.wizard.step3.subtitle}\n${copy.shop.wizard.step3.desc}`;
    const currentLine = `Current: **${currentCurr}** (${session.data.currency_symbol || '₹'}) • Locale: \`${session.data.locale || 'en-IN'}\``;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const currSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'curr_select'))
      .setPlaceholder(copy.shop.wizard.step3.dropdownPlaceholder)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('INR (₹) · Indian Rupee').setValue('INR:₹:en-IN').setDefault(currentCurr === 'INR'),
        new StringSelectMenuOptionBuilder().setLabel('USD ($) · US Dollar').setValue('USD:$:en-US').setDefault(currentCurr === 'USD'),
        new StringSelectMenuOptionBuilder().setLabel('EUR (€) · Euro').setValue('EUR:€:de-DE').setDefault(currentCurr === 'EUR'),
        new StringSelectMenuOptionBuilder().setLabel('GBP (£) · British Pound').setValue('GBP:£:en-GB').setDefault(currentCurr === 'GBP'),
        new StringSelectMenuOptionBuilder().setLabel('AUD ($) · Australian Dollar').setValue('AUD:$:en-AU').setDefault(currentCurr === 'AUD'),
        new StringSelectMenuOptionBuilder().setLabel('CAD ($) · Canadian Dollar').setValue('CAD:$:en-CA').setDefault(currentCurr === 'CAD'),
        new StringSelectMenuOptionBuilder().setLabel('AED (د.إ) · UAE Dirham').setValue('AED:د.إ:ar-AE').setDefault(currentCurr === 'AED')
      ]);

    rows.push(new ActionRowBuilder().addComponents(currSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 4: PAYMENT METHODS
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 4) {
    const methods = session.data.payment_methods || [];
    const activeNames = methods.map(m => m.name || m.id).join(', ') || 'None selected';
    const subHeader = `### ${copy.shop.wizard.step4.subtitle}\n${copy.shop.wizard.step4.desc}`;
    const currentLine = `Current methods: **${activeNames}**`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const paySelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'pay_select'))
      .setPlaceholder(copy.shop.wizard.step4.dropdownPlaceholder)
      .setMinValues(1)
      .setMaxValues(7)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('UPI (Paytm / GPay / PhonePe)').setValue('UPI').setDefault(methods.some(m => m.name === 'UPI')),
        new StringSelectMenuOptionBuilder().setLabel('PayPal').setValue('PayPal').setDefault(methods.some(m => m.name === 'PayPal')),
        new StringSelectMenuOptionBuilder().setLabel('Crypto (BTC / LTC / USDT)').setValue('Crypto').setDefault(methods.some(m => m.name === 'Crypto')),
        new StringSelectMenuOptionBuilder().setLabel('Bank Transfer / IMPS').setValue('Bank Transfer').setDefault(methods.some(m => m.name === 'Bank Transfer')),
        new StringSelectMenuOptionBuilder().setLabel('Debit / Credit Card').setValue('Card').setDefault(methods.some(m => m.name === 'Card')),
        new StringSelectMenuOptionBuilder().setLabel('Cash App').setValue('Cash App').setDefault(methods.some(m => m.name === 'Cash App')),
        new StringSelectMenuOptionBuilder().setLabel('Other Payment Method').setValue('Other').setDefault(methods.some(m => m.name === 'Other'))
      ]);

    rows.push(new ActionRowBuilder().addComponents(paySelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 5: TICKET & ORDER SETTINGS
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 5) {
    const tktCat = session.data.ticket_category_id ? `<#${session.data.ticket_category_id}>` : 'Not Set';
    const maxOrders = session.data.max_open_orders_per_user || 2;
    const subHeader = `### ${copy.shop.wizard.step5.subtitle}\n${copy.shop.wizard.step5.desc}`;
    const currentLine = `Ticket category: ${tktCat} • Max open orders per user: **${maxOrders}**`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const tktCatSelect = new ChannelSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'tkt_cat_select'))
      .setPlaceholder(copy.shop.wizard.step5.categoryPlaceholder)
      .setChannelTypes(ChannelType.GuildCategory);

    const maxOrdersSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'max_orders_select'))
      .setPlaceholder('Select max open orders per buyer')
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('1 order').setValue('1').setDefault(maxOrders === 1),
        new StringSelectMenuOptionBuilder().setLabel('2 orders').setValue('2').setDefault(maxOrders === 2),
        new StringSelectMenuOptionBuilder().setLabel('3 orders').setValue('3').setDefault(maxOrders === 3),
        new StringSelectMenuOptionBuilder().setLabel('5 orders').setValue('5').setDefault(maxOrders === 5),
        new StringSelectMenuOptionBuilder().setLabel('10 orders').setValue('10').setDefault(maxOrders === 10)
      ]);

    rows.push(new ActionRowBuilder().addComponents(tktCatSelect));
    rows.push(new ActionRowBuilder().addComponents(maxOrdersSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 6: NOTIFICATION CHANNELS & ROLES
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 6) {
    const ordersChan = session.data.orders_channel_id ? `<#${session.data.orders_channel_id}>` : 'Not Set';
    const restockPing = session.data.restock_ping_role_id ? `<@&${session.data.restock_ping_role_id}>` : 'None';
    const subHeader = `### ${copy.shop.wizard.step6.subtitle}\n${copy.shop.wizard.step6.desc}`;
    const currentLine = `Orders log: ${ordersChan} • Restock ping role: ${restockPing}`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const chanSelect = new ChannelSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'orders_chan_select'))
      .setPlaceholder(copy.shop.wizard.step6.ordersLogPlaceholder)
      .setChannelTypes(ChannelType.GuildText);

    const pingRoleSelect = new RoleSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'restock_ping_select'))
      .setPlaceholder('Select restock notification role (or None)');

    rows.push(new ActionRowBuilder().addComponents(chanSelect));
    rows.push(new ActionRowBuilder().addComponents(pingRoleSelect));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 7: BANNER APPEARANCE & STYLING
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 7) {
    const theme = session.data.banner_theme || 'dark';
    const stockMode = session.data.stock_display_mode || 'exact';
    const subHeader = `### ${copy.shop.wizard.step7.subtitle}\n${copy.shop.wizard.step7.desc}`;
    const currentLine = `Theme: **${theme}** • Stock display: **${stockMode}**`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${subHeader}\n\n${currentLine}`));

    const themeSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'theme_select'))
      .setPlaceholder(copy.shop.wizard.step7.themePlaceholder)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Dark Luxe (Recommended)').setValue('dark').setDescription('Obsidian & indigo backdrop with glowing accents').setDefault(theme === 'dark'),
        new StringSelectMenuOptionBuilder().setLabel('Clean Slate (Light)').setValue('light').setDescription('Pearl gradient with high-contrast text').setDefault(theme === 'light'),
        new StringSelectMenuOptionBuilder().setLabel('Cyberpunk Neon').setValue('neon').setDescription('Electric magenta & cyan highlights').setDefault(theme === 'neon'),
        new StringSelectMenuOptionBuilder().setLabel('Carbon Minimal').setValue('minimal').setDescription('Monochrome zinc & carbon styling').setDefault(theme === 'minimal')
      ]);

    const stockModeSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'stock_display_select'))
      .setPlaceholder(copy.shop.wizard.step7.stockDisplayPlaceholder)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Exact count (e.g. 5 available)').setValue('exact').setDefault(stockMode === 'exact'),
        new StringSelectMenuOptionBuilder().setLabel('Simplified text (In Stock / Sold Out)').setValue('simple').setDefault(stockMode === 'simple'),
        new StringSelectMenuOptionBuilder().setLabel('Hide stock status completely').setValue('hidden').setDefault(stockMode === 'hidden')
      ]);

    const previewBtn = greyButton({
      id: makeCustomId(session, 'preview_banner'),
      label: copy.common.preview,
      emoji: '🖼️'
    });

    rows.push(new ActionRowBuilder().addComponents(themeSelect));
    rows.push(new ActionRowBuilder().addComponents(stockModeSelect));
    rows.push(new ActionRowBuilder().addComponents(previewBtn));

    if (session.data.showPreview) {
      try {
        const sampleBuf = await renderBanner({
          product: {
            id: 'sample',
            name: 'Sample Product Banner',
            price_minor: 49900,
            compare_at_minor: 79900,
            currency: session.data.currency,
            stock_count: 10,
            status: 'active',
            delivery_time_text: 'Instant Automated Delivery'
          },
          theme: session.data.banner_theme,
          categoryName: 'Preview',
          shopName: guild.name
        });
        files = [{ attachment: sampleBuf, name: 'preview.png' }];
      } catch (_) {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STEP 8: REVIEW & CONFIRM
  // ───────────────────────────────────────────────────────────────────────────
  else if (step === 8) {
    const summary = [
      `### ${copy.shop.wizard.step8.subtitle}`,
      copy.shop.wizard.step8.desc,
      '',
      `• **Status**: ${session.data.is_enabled ? 'Enabled' : 'Disabled'}`,
      `• **Currency**: ${session.data.currency} (${session.data.currency_symbol})`,
      `• **Categories**: ${session.data.categories?.length || 0} configured`,
      `• **Payment Methods**: ${session.data.payment_methods?.length || 0} active`,
      `• **Banner Theme**: ${session.data.banner_theme}`,
      `• **Orders Log**: ${session.data.orders_channel_id ? `<#${session.data.orders_channel_id}>` : 'None'}`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

    const jumpSelect = new StringSelectMenuBuilder()
      .setCustomId(makeCustomId(session, 'jump_step_select'))
      .setPlaceholder(copy.shop.wizard.step8.jumpDropdownPlaceholder)
      .addOptions([
        new StringSelectMenuOptionBuilder().setLabel('Step 1 · Shop Status').setValue('1'),
        new StringSelectMenuOptionBuilder().setLabel('Step 2 · Product Categories').setValue('2'),
        new StringSelectMenuOptionBuilder().setLabel('Step 3 · Currency').setValue('3'),
        new StringSelectMenuOptionBuilder().setLabel('Step 4 · Payment Methods').setValue('4'),
        new StringSelectMenuOptionBuilder().setLabel('Step 5 · Ticket & Order Settings').setValue('5'),
        new StringSelectMenuOptionBuilder().setLabel('Step 6 · Notification Channels').setValue('6'),
        new StringSelectMenuOptionBuilder().setLabel('Step 7 · Banner Appearance').setValue('7')
      ]);

    rows.push(new ActionRowBuilder().addComponents(jumpSelect));

    const confirmBtn = greyButton({
      id: makeCustomId(session, 'apply_confirm'),
      label: copy.common.confirm,
      emoji: '✅'
    });
    rows.push(new ActionRowBuilder().addComponents(confirmBtn));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // NAVIGATION CONTROLS (Back / Next / Cancel)
  // ───────────────────────────────────────────────────────────────────────────
  const navButtons = [];
  if (step > 1) {
    navButtons.push(greyButton({
      id: makeCustomId(session, 'prev'),
      label: copy.common.back,
      emoji: '◀'
    }));
  }

  if (step < TOTAL_STEPS) {
    navButtons.push(greyButton({
      id: makeCustomId(session, 'next'),
      label: copy.common.next,
      emoji: '▶'
    }));
  }

  navButtons.push(greyButton({
    id: makeCustomId(session, 'cancel'),
    label: copy.common.cancel,
    emoji: '✖'
  }));

  rows.push(new ActionRowBuilder().addComponents(navButtons));

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Step ${step} of ${TOTAL_STEPS}`)
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
  renderSetupStep
};

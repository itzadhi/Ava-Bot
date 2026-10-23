import {
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags
} from 'discord.js';
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
 * Builds the official Components V2 Product Card
 * Strictly 1 single container, no embeds, 100% grey buttons, media gallery banner.
 *
 * @param {object} params
 * @param {object} params.product Product database record
 * @param {object} [params.category] Category object
 * @param {object} [params.settings] Guild shop settings
 * @param {Buffer} [params.bannerBuffer] Rendered banner PNG buffer
 * @returns {object} Discord message payload ready to send or edit
 */
export function buildProductCard({
  product,
  category = null,
  settings = null,
  bannerBuffer = null
}) {
  const container = new ContainerBuilder();

  // 1. Media Gallery Banner (attachment://banner.png)
  const mg = new MediaGalleryBuilder();
  mg.addItems(new MediaGalleryItemBuilder().setURL('attachment://banner.png'));
  container.addMediaGalleryComponents(mg);

  // 2. Product Title Header
  const emoji = category?.emoji || '📦';
  const titleText = `## ${emoji} ${format.escapeMarkdown(product.name)}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
  container.addSeparatorComponents(new SeparatorBuilder());

  // 3. Short Description
  if (product.description && product.description.trim()) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(product.description.trim())
    );
  }

  // 4. Feature Bullets
  const features = Array.isArray(product.features) ? product.features : [];
  if (features.length > 0) {
    const bullets = features
      .filter(f => typeof f === 'string' && f.trim().length > 0)
      .slice(0, 8)
      .map(f => `• ${format.escapeMarkdown(f.trim())}`)
      .join('\n');

    if (bullets) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bullets));
    }
  }

  // 5. Key Facts (Price, Stock, Delivery, Warranty)
  const facts = [];

  // Price line (with compare-at strikethrough if on sale)
  const currency = product.currency || settings?.currency || 'INR';
  const locale = settings?.locale || 'en-IN';
  const currentPrice = formatCurrency(product.price_minor, currency, locale);

  let priceStr = `**${currentPrice}**`;
  if (product.compare_at_minor && product.compare_at_minor > product.price_minor) {
    const oldPrice = formatCurrency(product.compare_at_minor, currency, locale);
    priceStr = `~~${oldPrice}~~ **${currentPrice}** 🔥 *(Sale)*`;
  }
  facts.push(`**Price:** ${priceStr}`);

  // Stock status
  const stockMode = settings?.stock_display_mode || 'exact';
  let isSoldOut = false;
  let isLowStock = false;

  if (product.stock_type === 'unlimited') {
    facts.push(`**Stock:** 🟢 \`Available\` *(Unlimited)*`);
  } else {
    const count = Math.max(0, Number(product.stock_count || 0));
    isSoldOut = count <= 0;
    isLowStock = count > 0 && count <= (product.low_stock_threshold || 3);

    if (isSoldOut) {
      facts.push(`**Stock:** 🔴 \`Sold Out\``);
    } else if (isLowStock) {
      if (stockMode === 'exact') {
        facts.push(`**Stock:** 🟡 \`Low Stock (${count} left)\``);
      } else {
        facts.push(`**Stock:** 🟡 \`Low Stock\``);
      }
    } else {
      if (stockMode === 'exact') {
        facts.push(`**Stock:** 🟢 \`In Stock (${count} available)\``);
      } else {
        facts.push(`**Stock:** 🟢 \`In Stock\``);
      }
    }
  }

  // Delivery text
  const delivery = product.delivery_time_text || (product.delivery_mode === 'automatic' ? '⚡ Instant Delivery' : '⏳ Manual Staff Delivery');
  facts.push(`**Delivery:** ${delivery}`);

  // Warranty text
  if (product.warranty_text) {
    facts.push(`**Warranty:** 🛡️ ${format.escapeMarkdown(product.warranty_text)}`);
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(facts.join('\n')));

  // 6. Subtext / Timestamps
  const updatedUnix = Math.floor(new Date(product.updated_at || Date.now()).getTime() / 1000);
  const subtext = `-# Product ID: \`${product.id}\` • Updated <t:${updatedUnix}:R>`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(subtext));

  // 7. Divider before Buttons
  container.addSeparatorComponents(new SeparatorBuilder());

  // 8. Grey Buttons Row (ButtonStyle.Secondary only)
  const buttons = [];
  const isPaused = product.status === 'paused';

  // Buy Now Button
  buttons.push(greyButton({
    id: `shop:buy:${product.guild_id}:${product.id}`,
    label: isSoldOut ? 'Sold Out' : (isPaused ? 'Paused' : 'Buy Now'),
    emoji: isSoldOut ? '✖' : (isPaused ? '⏸' : '🛒'),
    disabled: isSoldOut || isPaused
  }));

  // Notify Me button (only visible/enabled when sold out)
  if (isSoldOut) {
    buttons.push(greyButton({
      id: `shop:waitlist:${product.guild_id}:${product.id}`,
      label: 'Notify Me',
      emoji: '🔔'
    }));
  }

  // Details / FAQ button
  buttons.push(greyButton({
    id: `shop:details:${product.guild_id}:${product.id}`,
    label: 'Details / FAQ',
    emoji: 'ℹ️'
  }));

  // Vouches link or button (if vouch channel configured)
  if (settings?.vouch_channel_id) {
    buttons.push(greyButton({
      id: `shop:vouch_channel:${product.guild_id}`,
      label: 'Reviews',
      emoji: '⭐'
    }));
  }

  const row = new ActionRowBuilder().addComponents(buttons.slice(0, 5));

  const payload = {
    flags: MessageFlags.IsComponentsV2,
    components: [container, row]
  };

  if (bannerBuffer) {
    payload.files = [{
      attachment: bannerBuffer,
      name: 'banner.png'
    }];
  }

  return payload;
}

export default {
  buildProductCard
};

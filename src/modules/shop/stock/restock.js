import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import {
  getShopProductById,
  saveShopProduct,
  addEncryptedStockItems,
  getShopSettings,
  getWaitlist,
  clearWaitlist
} from '../db.js';
import { encryptItem } from './encryption.js';
import { renderBanner } from '../render/banner.js';
import { buildProductCard } from '../render/card.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import * as format from '../../../utils/ui/format.js';
import { logger } from '../../../utils/logger.js';

/**
 * Executes a full restock of a product:
 * 1. Updates stock in database & encrypts items
 * 2. Updates the live Discord product card & banner (flips SOLD OUT -> IN STOCK)
 * 3. Posts announcement to restock channel (with role ping)
 * 4. Batches DMs to waitlisted customers
 *
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {string} params.productId
 * @param {number|string[]} params.addedItemsOrQuantity Number of units or array of item lines
 * @param {import('discord.js').GuildMember} params.actorMember
 * @returns {Promise<object>}
 */
export async function executeRestock({
  guild,
  productId,
  addedItemsOrQuantity,
  quantityToAdd,
  amount,
  actorMember,
  staffId
}) {
  const [product, settings] = await Promise.all([
    getShopProductById(productId),
    getShopSettings(guild.id)
  ]);

  if (!product) {
    throw new Error('PRODUCT_NOT_FOUND: Product record does not exist');
  }

  const oldStock = product.stock_count || 0;
  let addedCount = 0;
  const input = addedItemsOrQuantity ?? quantityToAdd ?? amount ?? 0;

  if (product.stock_type === 'items') {
    const rawLines = Array.isArray(input) ? input : [];
    // Deduplicate and filter non-empty lines
    const uniqueLines = Array.from(new Set(rawLines.map(l => l.trim()).filter(l => l.length > 0)));
    if (uniqueLines.length > 0) {
      const encrypted = uniqueLines.map(line => encryptItem(line));
      addedCount = await addEncryptedStockItems(product.id, encrypted, guild.id);
    }
  } else if (product.stock_type === 'quantity') {
    addedCount = Math.max(0, parseInt(input, 10) || 0);
    product.stock_count = oldStock + addedCount;
    await saveShopProduct(product);
  } else {
    // Unlimited: toggle availability to active
    product.status = 'active';
    await saveShopProduct(product);
  }

  const newStock = (product.stock_type === 'quantity')
    ? (oldStock + addedCount)
    : (product.stock_count || oldStock + addedCount);

  // 1. Live update the product card and banner in the product channel
  if (product.channel_id && product.message_id) {
    try {
      const channel = guild.channels.cache.get(product.channel_id) || await guild.channels.fetch(product.channel_id).catch(() => null);
      if (channel && channel.isTextBased()) {
        const msg = await channel.messages.fetch(product.message_id).catch(() => null);
        if (msg) {
          const bannerBuf = await renderBanner({
            product: { ...product, stock_count: newStock, status: 'active' },
            theme: settings.banner_theme,
            shopName: guild.name
          });

          const updatedCard = buildProductCard({
            product: { ...product, stock_count: newStock, status: 'active' },
            settings,
            bannerBuffer: bannerBuf
          });

          await msg.edit(updatedCard);
        }
      }
    } catch (err) {
      logger.warn({ err: err.message, productId }, 'Could not update live product card in channel during restock');
    }
  }

  // 2. Post Restock Announcement to configured Restock Channel
  if (settings.restock_channel_id) {
    try {
      const restockChan = guild.channels.cache.get(settings.restock_channel_id) || await guild.channels.fetch(settings.restock_channel_id).catch(() => null);
      const isText = restockChan && (typeof restockChan.isTextBased === 'function' ? restockChan.isTextBased() : Boolean(restockChan.send));
      if (isText) {
        const ping = settings.restock_ping_role_id ? `<@&${settings.restock_ping_role_id}> ` : '';

        const annContainer = new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 📦 Restock Alert — **${format.escapeMarkdown(product.name)}**`)
          )
          .addSeparatorComponents(new SeparatorBuilder())
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**${product.name}** has just been restocked!\n\n- **Added**: \`+${addedCount} units\`\n- **Available Now**: \`${newStock} units\`\n- **Product Channel**: <#${product.channel_id}>\n- **Price**: \`${settings.currency_symbol}${(product.price_minor / 100).toFixed(2)}\``)
          );

        await restockChan.send({
          content: ping || null,
          flags: MessageFlags.IsComponentsV2,
          components: [annContainer]
        });
      }
    } catch (annErr) {
      logger.warn({ err: annErr.message }, 'Failed to post restock announcement');
    }
  }

  // 3. Notify Waitlisted Customers via DM
  const waitlistUsers = await getWaitlist(product.id);
  if (waitlistUsers.length > 0) {
    // Clear waitlist immediately so users aren't notified twice
    await clearWaitlist(product.id);

    // Send DM notifications with error catching
    for (const userId of waitlistUsers) {
      try {
        const user = await guild.client.users.fetch(userId).catch(() => null);
        if (user) {
          await user.send({
            content: `🔔 **Restock Notice:** The product **${product.name}** you were waiting for in **${guild.name}** is now back in stock!\nHead over to <#${product.channel_id}> to purchase before it sells out!`
          }).catch(() => {});
        }
      } catch (_) {}
    }
  }

  return {
    productId: product.id,
    oldStock,
    addedCount,
    newStock,
    waitlistCount: waitlistUsers.length,
    notifiedCount: waitlistUsers.length
  };
}

export default {
  executeRestock
};

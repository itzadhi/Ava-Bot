import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} from 'discord.js';
import { handleShopWizardInteraction } from './wizard/router.js';
import { handleBuyNowClick } from './orders/buy.js';
import { handleDeliverOrder, handleMarkPaid } from './orders/delivery.js';
import { renderAddProductStep, publishProductChannel } from './wizard/add.js';
import { sessionStore } from '../../core/interactions/session.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';
import { errorCard, successCard } from '../../ui/cards.js';
import {
  getShopOrder,
  updateShopOrder,
  getShopProductById,
  getShopSettings,
  addToWaitlist,
  createShopReview
} from './db.js';
import { isShopManager, isShopStaff } from './permissions.js';
import { logger } from '../../utils/logger.js';
import * as format from '../../utils/ui/format.js';

/**
 * Central Interaction Handler for all `shop:*` customIds
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} True if handled, false otherwise
 */
export async function handleShopInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('shop:')) {
    return false;
  }

  const parts = customId.split(':');
  // Format: shop:<module>:<arg1>:<arg2>...
  const [, moduleName, arg1, arg2, arg3, arg4] = parts;

  // 1. Wizard & Dashboard Routing
  if (moduleName === 'setup' || moduleName === 'dash') {
    return handleShopWizardInteraction(interaction);
  }

  // 2. Buy Now Click
  if (moduleName === 'buy') {
    const guildId = arg1;
    const productId = arg2;
    await handleBuyNowClick(interaction, guildId, productId, 1);
    return true;
  }

  // 2.1 Quantity Select on Buy
  if (moduleName === 'buy_qty') {
    const guildId = arg1;
    const productId = arg2;
    const qty = parseInt(interaction.values?.[0] || '1', 10);
    await handleBuyNowClick(interaction, guildId, productId, qty);
    return true;
  }

  // 3. Waitlist Button (Notify Me)
  if (moduleName === 'waitlist') {
    const guildId = arg1;
    const productId = arg2;
    await addToWaitlist(guildId, productId, interaction.user.id);
    await safeRespond(interaction, successCard({
      title: 'Added to Restock Waitlist',
      reason: 'You will receive an automatic direct message when this product is restocked.',
      ephemeral: true
    }), { ephemeral: true });
    return true;
  }

  // 4. Product Creation Wizard (shop:add:...)
  if (moduleName === 'add') {
    const sessionId = arg1;
    const action = arg2;
    const val = arg3;

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      await safeRespond(interaction, errorCard({
        title: 'Wizard Session Expired',
        reason: 'This product creation session has expired or the bot was restarted.',
        fix: 'Please run /shop add to start a new wizard.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (action === 'cancel') {
      sessionStore.deleteSession(sessionId);
      await safeRespond(interaction, errorCard({
        title: 'Product Creation Cancelled',
        reason: 'No channel or product was created.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (action === 'next') {
      session.data.step = Math.min(7, (session.data.step || 1) + 1);
      session.data.previewBanner = false;
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'prev') {
      session.data.step = Math.max(1, (session.data.step || 1) - 1);
      session.data.previewBanner = false;
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'set_cat') {
      session.data.category_id = interaction.values?.[0] || null;
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'set_stock_type') {
      session.data.stock_type = val || 'unlimited';
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'set_theme') {
      session.data.theme = interaction.values?.[0] || 'dark';
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'preview_banner') {
      session.data.previewBanner = true;
      const payload = await renderAddProductStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'publish') {
      // Execute automatic publish
      try {
        const result = await publishProductChannel(interaction.guild, session.data, session.data);
        sessionStore.deleteSession(sessionId);

        const successContainer = new ContainerBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## 🚀 Product Published Successfully!\n**${format.escapeMarkdown(result.product.name)}** is now live in <#${result.channel.id}>!`)
          )
          .addSeparatorComponents(new SeparatorBuilder())
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`- Channel: <#${result.channel.id}>\n- Stock: \`${result.product.stock_type.toUpperCase()}\` (${result.product.stock_count} units)\n- Official V2 Card & Canvas Banner pinned automatically.`)
          );

        await safeRespond(interaction, {
          flags: MessageFlags.IsComponentsV2,
          components: [successContainer]
        });
      } catch (pubErr) {
        logger.error({ err: pubErr.message }, 'Failed to publish product');
        await safeRespond(interaction, errorCard({
          title: 'Publishing Failed',
          reason: `Could not create product channel: ${pubErr.message}`,
          fix: 'Ensure the bot has Manage Channels and Send Messages permissions.',
          ephemeral: true
        }), { ephemeral: true });
      }
      return true;
    }
  }

  // 5. Product Creation Modals (shop:wizard:...)
  if (moduleName === 'wizard') {
    const action = arg1; // 'name' | 'price' | 'content' | 'items' | 'category_create'
    const sessionId = arg2;

    const session = sessionStore.getSession(sessionId);

    // Modal submit handling
    if (interaction.isModalSubmit?.()) {
      if (!session) {
        await safeRespond(interaction, errorCard({ title: 'Session Expired', ephemeral: true }), { ephemeral: true });
        return true;
      }

      if (action === 'name') {
        session.data.name = interaction.fields.getTextInputValue('product_name')?.trim();
        const payload = await renderAddProductStep(session, interaction.guild);
        await safeRespond(interaction, payload);
        return true;
      }

      if (action === 'price') {
        const rawPrice = interaction.fields.getTextInputValue('price')?.trim();
        const rawCompare = interaction.fields.getTextInputValue('compare_at')?.trim();
        session.data.price_minor = Math.round((parseFloat(rawPrice.replace(/[^0-9.]/g, '')) || 0) * 100);
        session.data.compare_at_minor = rawCompare ? Math.round((parseFloat(rawCompare.replace(/[^0-9.]/g, '')) || 0) * 100) : null;
        const payload = await renderAddProductStep(session, interaction.guild);
        await safeRespond(interaction, payload);
        return true;
      }

      if (action === 'content') {
        session.data.description = interaction.fields.getTextInputValue('desc')?.trim() || '';
        const rawFeatures = interaction.fields.getTextInputValue('features')?.trim() || '';
        session.data.features = rawFeatures.split('\n').map(l => l.replace(/^[•\-\*]\s*/, '').trim()).filter(l => l.length > 0);
        session.data.delivery_time_text = interaction.fields.getTextInputValue('delivery')?.trim() || 'Instant Automated Delivery';
        session.data.warranty_text = interaction.fields.getTextInputValue('warranty')?.trim() || '';
        const payload = await renderAddProductStep(session, interaction.guild);
        await safeRespond(interaction, payload);
        return true;
      }

      if (action === 'items') {
        const rawItems = interaction.fields.getTextInputValue('items_text')?.trim() || '';
        const lines = rawItems.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        session.data.items = lines;
        session.data.stock_count = lines.length;
        const payload = await renderAddProductStep(session, interaction.guild);
        await safeRespond(interaction, payload);
        return true;
      }
      return true;
    }

    // Modal Opening Buttons (Must be cache-only, never deferred!)
    if (action === 'name') {
      const modal = new ModalBuilder()
        .setCustomId(`shop:wizard:name:${sessionId}`)
        .setTitle('Set Product Name');

      const nameInput = new TextInputBuilder()
        .setCustomId('product_name')
        .setLabel('Product Name (1-80 chars)')
        .setStyle(TextInputStyle.Short)
        .setValue(session?.data?.name || '')
        .setRequired(true)
        .setMaxLength(80);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'price') {
      const modal = new ModalBuilder()
        .setCustomId(`shop:wizard:price:${sessionId}`)
        .setTitle('Set Product Pricing');

      const priceInput = new TextInputBuilder()
        .setCustomId('price')
        .setLabel('Price (e.g. 499 or 499.99)')
        .setStyle(TextInputStyle.Short)
        .setValue(session?.data?.price_minor ? (session.data.price_minor / 100).toFixed(2) : '')
        .setRequired(true);

      const compareInput = new TextInputBuilder()
        .setCustomId('compare_at')
        .setLabel('Compare-At / Old Price (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(session?.data?.compare_at_minor ? (session.data.compare_at_minor / 100).toFixed(2) : '')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(priceInput),
        new ActionRowBuilder().addComponents(compareInput)
      );
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'content') {
      const modal = new ModalBuilder()
        .setCustomId(`shop:wizard:content:${sessionId}`)
        .setTitle('Product Card Content');

      const descInput = new TextInputBuilder()
        .setCustomId('desc')
        .setLabel('Short Description')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(session?.data?.description || '')
        .setRequired(false)
        .setMaxLength(600);

      const featInput = new TextInputBuilder()
        .setCustomId('features')
        .setLabel('Features / Bullets (One per line)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(session?.data?.features?.join('\n') || '')
        .setRequired(false)
        .setMaxLength(800);

      const delInput = new TextInputBuilder()
        .setCustomId('delivery')
        .setLabel('Delivery Time')
        .setStyle(TextInputStyle.Short)
        .setValue(session?.data?.delivery_time_text || 'Instant Delivery')
        .setRequired(false);

      const warInput = new TextInputBuilder()
        .setCustomId('warranty')
        .setLabel('Warranty Details')
        .setStyle(TextInputStyle.Short)
        .setValue(session?.data?.warranty_text || '24 Hours Warranty')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(descInput),
        new ActionRowBuilder().addComponents(featInput),
        new ActionRowBuilder().addComponents(delInput),
        new ActionRowBuilder().addComponents(warInput)
      );
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'items') {
      const modal = new ModalBuilder()
        .setCustomId(`shop:wizard:items:${sessionId}`)
        .setTitle('Paste Stock Items');

      const itemsInput = new TextInputBuilder()
        .setCustomId('items_text')
        .setLabel('Items / Deliverables (One per line)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('user1:pass1\nuser2:pass2\nKEY-AAAA-BBBB')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(itemsInput));
      await interaction.showModal(modal);
      return true;
    }
  }

  // 6. Order Actions (shop:order:...)
  if (moduleName === 'order') {
    const action = arg1;
    const orderId = arg2;

    if (action === 'deliver') {
      await handleDeliverOrder(interaction, orderId);
      return true;
    }

    if (action === 'mark_paid') {
      await handleMarkPaid(interaction, orderId);
      return true;
    }

    if (action === 'i_paid') {
      const order = await getShopOrder(orderId);
      if (!order) return true;

      const pings = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`🔔 <@${interaction.user.id}> has marked **Order #${order.number}** as PAID! Staff please verify transaction details and deliver.`)
        );

      await interaction.channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [pings]
      });

      await safeRespond(interaction, successCard({
        title: 'Staff Notified',
        reason: 'Staff have been notified of your payment.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (action === 'cancel') {
      const order = await getShopOrder(orderId);
      if (!order) return true;

      // Allow buyer or staff to cancel
      const isStaff = await isShopStaff(interaction.member);
      if (order.user_id !== interaction.user.id && !isStaff) {
        return safeRespond(interaction, errorCard({
          title: 'Action Restricted',
          reason: 'Only the order buyer or shop staff can cancel this order.',
          ephemeral: true
        }), { ephemeral: true });
      }

      await updateShopOrder(orderId, { status: 'cancelled' });

      const cancelContainer = new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ✖ Order #${order.number} Cancelled\nThis order has been cancelled by <@${interaction.user.id}>. Stock reservation released.`)
        );

      await interaction.channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [cancelContainer]
      });

      return safeRespond(interaction, successCard({
        title: 'Order Cancelled',
        reason: 'Your order was cancelled successfully.',
        ephemeral: true
      }), { ephemeral: true });
    }

    if (action === 'close') {
      const isStaff = await isShopStaff(interaction.member);
      if (!isStaff) {
        return safeRespond(interaction, errorCard({
          title: 'Action Restricted',
          reason: 'Only shop staff can close order ticket channels.',
          ephemeral: true
        }), { ephemeral: true });
      }

      await safeRespond(interaction, successCard({
        title: 'Closing Ticket',
        reason: 'This order ticket will be archived and deleted shortly.',
        ephemeral: true
      }), { ephemeral: true });

      setTimeout(async () => {
        await interaction.channel?.delete().catch(() => {});
      }, 3000);
      return true;
    }
  }

  // 7. Customer Reviews & Ratings (shop:review:...)
  if (moduleName === 'review') {
    const action = arg1;
    const orderId = arg2;

    if (action === 'open') {
      const modal = new ModalBuilder()
        .setCustomId(`shop:review:submit:${orderId}`)
        .setTitle('Leave a Purchase Review');

      const ratingInput = new TextInputBuilder()
        .setCustomId('rating_stars')
        .setLabel('Rating (1 to 5 Stars)')
        .setStyle(TextInputStyle.Short)
        .setValue('5')
        .setMinLength(1)
        .setMaxLength(1)
        .setRequired(true);

      const commentInput = new TextInputBuilder()
        .setCustomId('rating_comment')
        .setLabel('Your Review / Feedback (Optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Great service and instant delivery!')
        .setRequired(false)
        .setMaxLength(500);

      modal.addComponents(
        new ActionRowBuilder().addComponents(ratingInput),
        new ActionRowBuilder().addComponents(commentInput)
      );

      await interaction.showModal(modal);
      return true;
    }

    if (action === 'submit' && interaction.isModalSubmit?.()) {
      const starsRaw = parseInt(interaction.fields.getTextInputValue('rating_stars') || '5', 10);
      const stars = Math.max(1, Math.min(5, isNaN(starsRaw) ? 5 : starsRaw));
      const comment = interaction.fields.getTextInputValue('rating_comment')?.trim() || '';

      const order = await getShopOrder(orderId);
      const settings = await getShopSettings(interaction.guildId);

      const review = await createShopReview({
        guild_id: interaction.guildId,
        order_id: orderId,
        product_id: order?.product_id,
        user_id: interaction.user.id,
        stars,
        comment
      });

      // Post vouch card to review channel if configured
      if (settings.vouch_channel_id) {
        const vouchChan = interaction.guild.channels.cache.get(settings.vouch_channel_id);
        if (vouchChan && vouchChan.isTextBased()) {
          const starStr = '⭐'.repeat(stars);
          const vouchContainer = new ContainerBuilder()
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`## ⭐ Verified Purchase Review — ${starStr}`)
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
              new TextDisplayBuilder().setContent(`- **Customer**: <@${interaction.user.id}>\n- **Product**: **${order?.product_name_snapshot || 'Product'}**\n- **Rating**: \`${stars}/5\`\n\n> "${comment || 'Excellent product and instant delivery!'}"\n\n-# Verified Argoni Shop Customer • <t:${Math.floor(Date.now() / 1000)}:R>`)
            );

          vouchChan.send({
            flags: MessageFlags.IsComponentsV2,
            components: [vouchContainer]
          }).catch(() => {});
        }
      }

      await safeRespond(interaction, successCard({
        title: 'Thank You for Your Review!',
        reason: `Your ${stars}-star rating has been recorded and posted to the vouches channel.`,
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }
  }

  return false;
}

export default {
  handleShopInteraction
};

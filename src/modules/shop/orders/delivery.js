import {
  ActionRowBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import {
  getShopOrder,
  updateShopOrder,
  getShopProductById,
  getShopSettings,
  getReservedItemsForOrder,
  completeOrder,
  addShopOrderEvent
} from '../db.js';
import { decryptItem, maskItem } from '../stock/encryption.js';
import { isShopStaff, isShopManager } from '../permissions.js';
import { safeRespond } from '../../../core/interactions/safeRespond.js';
import { errorCard, successCard } from '../../../ui/cards.js';
import { greyButton } from '../../../utils/ui/greyButton.js';
import * as format from '../../../utils/ui/format.js';
import { logger } from '../../../utils/logger.js';

/**
 * Handles the "Deliver Items" staff action
 */
export async function handleDeliverOrder(interaction, orderId) {
  const member = interaction.member;
  const guild = interaction.guild;
  const settings = await getShopSettings(guild.id);

  // 1. Authorization: Only Shop Staff or Managers can deliver
  const isStaff = await isShopStaff(member, settings);
  if (!isStaff) {
    return safeRespond(interaction, errorCard({
      title: 'Action Restricted',
      reason: 'Only Shop Staff or Managers can deliver orders.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // 2. Fetch order and product
  const order = await getShopOrder(orderId);
  if (!order) {
    return safeRespond(interaction, errorCard({
      title: 'Order Not Found',
      reason: 'Could not locate order record.',
      ephemeral: true
    }), { ephemeral: true });
  }

  if (['delivered', 'completed'].includes(order.status)) {
    return safeRespond(interaction, errorCard({
      title: 'Already Delivered',
      reason: 'This order has already been delivered to the customer.',
      ephemeral: true
    }), { ephemeral: true });
  }

  const product = await getShopProductById(order.product_id);
  if (!product) {
    return safeRespond(interaction, errorCard({
      title: 'Product Record Missing',
      reason: 'Product record is missing or deleted.',
      ephemeral: true
    }), { ephemeral: true });
  }

  // 3. Deliver Items based on stock_type
  let deliverableText = '';
  let maskedLogText = '';

  if (product.stock_type === 'items') {
    const items = await getReservedItemsForOrder(order.id);
    if (!items || items.length === 0) {
      return safeRespond(interaction, errorCard({
        title: 'No Reserved Deliverables Found',
        reason: 'No stock item rows are currently reserved for this order.',
        fix: 'Please check stock item database or deliver manually.',
        ephemeral: true
      }), { ephemeral: true });
    }

    try {
      const decryptedLines = items.map(item => decryptItem(item));
      deliverableText = decryptedLines.join('\n');
      maskedLogText = decryptedLines.map(line => maskItem(line)).join(', ');
    } catch (decErr) {
      logger.error({ err: decErr.message }, 'Failed to decrypt items for delivery');
      return safeRespond(interaction, errorCard({
        title: 'Decryption Failure',
        reason: 'Unable to decrypt stock items. Please check SHOP_ENCRYPTION_KEY in .env.',
        ephemeral: true
      }), { ephemeral: true });
    }
  } else {
    deliverableText = `Service / Slots delivered: ${product.name} (x${order.quantity})`;
    maskedLogText = deliverableText;
  }

  // 4. Mark items complete in database
  await completeOrder(order.id);
  await updateShopOrder(order.id, {
    status: 'delivered',
    delivered_payload: {
      masked: maskedLogText,
      delivered_at: new Date().toISOString(),
      delivered_by: member.id
    }
  });

  await addShopOrderEvent(order.id, 'delivered', member.id, {
    maskedSummary: maskedLogText
  });

  // 5. Send Deliverable Card to Customer inside Ticket Channel
  const ticketChan = interaction.channel;
  const deliverContainer = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 🎁 Order #${order.number} Delivered!\n<@${order.user_id}> Your purchase has been delivered by <@${member.id}>.`)
    )
    .addSeparatorComponents(new SeparatorBuilder());

  if (product.stock_type === 'items') {
    deliverContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### 🔑 Deliverable(s):\n\`\`\`txt\n${deliverableText}\n\`\`\`\n-# Please save and secure your deliverables immediately.`)
    );
  } else {
    deliverContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### ✅ Service Fulfilled\n**${product.name}** has been marked as fulfilled.`)
    );
  }

  deliverContainer.addSeparatorComponents(new SeparatorBuilder());
  deliverContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ⭐ Rate Your Experience\nPlease take a second to rate your purchase below!`)
  );

  const reviewBtn = greyButton({
    id: `shop:review:open:${order.id}`,
    label: 'Leave a Review',
    emoji: '⭐'
  });

  await ticketChan.send({
    content: `<@${order.user_id}>`,
    flags: MessageFlags.IsComponentsV2,
    components: [deliverContainer, new ActionRowBuilder().addComponents(reviewBtn)]
  });

  // Attempt direct message to buyer
  try {
    const buyer = await interaction.client.users.fetch(order.user_id);
    if (buyer) {
      await buyer.send({
        content: `🎉 Your Argoni Shop Order #${order.number} for **${product.name}** in **${guild.name}** has been delivered!\nView your items in <#${ticketChan.id}>.`
      }).catch(() => {});
    }
  } catch (_) {}

  // 6. Log delivery to staff delivery log channel (masked only!)
  if (settings.delivery_channel_id) {
    const logChan = guild.channels.cache.get(settings.delivery_channel_id);
    if (logChan && logChan.isTextBased()) {
      const logContainer = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📦 Order #${order.number} Delivered`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`- **Product**: **${product.name}**\n- **Buyer**: <@${order.user_id}>\n- **Staff**: <@${member.id}>\n- **Deliverable**: \`${maskedLogText}\``));

      logChan.send({
        flags: MessageFlags.IsComponentsV2,
        components: [logContainer]
      }).catch(() => {});
    }
  }

  return safeRespond(interaction, successCard({
    title: 'Order Delivered Successfully',
    reason: `Deliverables posted to ticket channel <#${ticketChan.id}>.`,
    ephemeral: true
  }), { ephemeral: true });
}

/**
 * Handles the "Mark Paid" staff action
 */
export async function handleMarkPaid(interaction, orderId) {
  const member = interaction.member;
  const settings = await getShopSettings(interaction.guildId);

  const isStaff = await isShopStaff(member, settings);
  if (!isStaff) {
    return safeRespond(interaction, errorCard({
      title: 'Action Restricted',
      reason: 'Only Shop Staff or Managers can mark orders as paid.',
      ephemeral: true
    }), { ephemeral: true });
  }

  const order = await getShopOrder(orderId);
  if (!order) {
    return safeRespond(interaction, errorCard({ title: 'Order Not Found', ephemeral: true }), { ephemeral: true });
  }

  await updateShopOrder(orderId, { status: 'paid' });
  await addShopOrderEvent(orderId, 'marked_paid', member.id);

  // Announce in ticket channel
  const paidContainer = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🟢 Payment Verified\n<@${member.id}> has confirmed payment for **Order #${order.number}**! Staff will now deliver the purchase.`));

  await interaction.channel.send({
    flags: MessageFlags.IsComponentsV2,
    components: [paidContainer]
  });

  return safeRespond(interaction, successCard({
    title: 'Payment Confirmed',
    reason: `Order #${order.number} marked as PAID.`,
    ephemeral: true
  }), { ephemeral: true });
}

export default {
  handleDeliverOrder,
  handleMarkPaid
};

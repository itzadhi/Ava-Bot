import { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { sessionStore } from '../../../core/interactions/session.js';
import { safeRespond } from '../../../core/interactions/safeRespond.js';
import { errorCard } from '../../../ui/cards.js';
import { renderSetupStep } from './setup.js';
import { renderShopDashboard } from './dashboard.js';
import { updateShopSettings, saveShopCategory, getShopSettings } from '../db.js';
import { isShopManager } from '../permissions.js';

/**
 * Handles all wizard & dashboard interaction clicks
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} True if handled, false otherwise
 */
export async function handleShopWizardInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('shop:')) {
    return false;
  }

  const parts = customId.split(':');
  // Format: shop:<submodule>:<arg1>:<arg2>:<arg3>...
  const [, sub, arg1, arg2, arg3, arg4] = parts;

  // ───────────────────────────────────────────────────────────────────────────
  // 1. SETUP WIZARD ROUTING (shop:setup:...)
  // ───────────────────────────────────────────────────────────────────────────
  if (sub === 'setup') {
    let sessionId, action;
    if (parts[4]) {
      // 5-part format: shop:setup:guildId:ownerId:sessionId:action
      sessionId = parts[4];
      action = parts[5] || parts.slice(5).join(':');
    } else {
      // Legacy 4-part format: shop:setup:sessionId:action
      sessionId = arg1;
      action = arg2;
    }

    const session = sessionStore.getSession(sessionId);
    if (!session) {
      await safeRespond(interaction, errorCard({
        title: 'Setup Session Expired',
        reason: 'This setup session has expired or the bot was restarted.',
        fix: 'Please run /shop again to start a new setup session.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    // Permission guard
    const isManager = await isShopManager(interaction.member);
    if (!isManager) {
      await safeRespond(interaction, errorCard({
        title: 'Access Restricted',
        reason: 'Only Shop Managers or Server Administrators can configure the shop.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (action === 'cancel') {
      sessionStore.deleteSession(sessionId);
      await safeRespond(interaction, errorCard({
        title: 'Setup Wizard Cancelled',
        reason: 'No configuration changes were applied to your server.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (action === 'next') {
      session.data.step = Math.min(8, (session.data.step || 1) + 1);
      session.data.showPreview = false;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'prev') {
      session.data.step = Math.max(1, (session.data.step || 1) - 1);
      session.data.showPreview = false;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'status_select') {
      const val = interaction.values?.[0];
      session.data.is_enabled = (val === 'enabled');
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'toggle_enabled') {
      session.data.is_enabled = !session.data.is_enabled;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'cat_select') {
      const selectedIds = interaction.values || [];
      if (!session.data.categories) session.data.categories = [];
      for (const catId of selectedIds) {
        const chan = interaction.guild.channels.cache.get(catId);
        if (chan && !session.data.categories.some(c => c.discord_category_id === catId)) {
          session.data.categories.push({
            name: chan.name,
            discord_category_id: catId,
            emoji: '📦'
          });
        }
      }
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'curr_select') {
      const val = interaction.values?.[0] || 'INR:₹:en-IN';
      const [curr, sym, loc] = val.split(':');
      session.data.currency = curr;
      session.data.currency_symbol = sym;
      session.data.locale = loc;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'pay_select') {
      const selected = interaction.values || [];
      session.data.payment_methods = selected.map(name => ({
        name,
        instructions: `Please send payment via ${name} and provide confirmation in this ticket.`
      }));
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'tkt_cat_select') {
      session.data.ticket_category_id = interaction.values?.[0] || null;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'max_orders_select') {
      session.data.max_open_orders_per_user = parseInt(interaction.values?.[0] || '2', 10);
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'mgr_role_select') {
      session.data.manager_role_ids = interaction.values || [];
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'orders_chan_select') {
      session.data.orders_channel_id = interaction.values?.[0] || null;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'restock_ping_select') {
      session.data.restock_ping_role_id = interaction.values?.[0] || null;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'theme_select') {
      session.data.banner_theme = interaction.values?.[0] || 'dark';
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'stock_display_select') {
      session.data.stock_display_mode = interaction.values?.[0] || 'exact';
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'jump_step_select') {
      session.data.step = Math.max(1, Math.min(8, parseInt(interaction.values?.[0] || '1', 10)));
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'preview_banner') {
      session.data.showPreview = true;
      const payload = await renderSetupStep(session, interaction.guild);
      await safeRespond(interaction, payload);
      return true;
    }

    if (action === 'apply_confirm') {
      // Persist shop settings to database
      await updateShopSettings(interaction.guildId, {
        is_enabled: session.data.is_enabled,
        currency: session.data.currency,
        currency_symbol: session.data.currency_symbol,
        locale: session.data.locale,
        payment_methods: session.data.payment_methods,
        ticket_category_id: session.data.ticket_category_id,
        manager_role_ids: session.data.manager_role_ids,
        orders_channel_id: session.data.orders_channel_id,
        delivery_channel_id: session.data.delivery_channel_id,
        vouch_channel_id: session.data.vouch_channel_id,
        restock_channel_id: session.data.restock_channel_id,
        restock_ping_role_id: session.data.restock_ping_role_id,
        stock_display_mode: session.data.stock_display_mode,
        low_stock_threshold: session.data.low_stock_threshold,
        max_open_orders_per_user: session.data.max_open_orders_per_user,
        banner_theme: session.data.banner_theme,
        banner_font: session.data.banner_font
      });

      // Save categories
      if (Array.isArray(session.data.categories)) {
        for (const cat of session.data.categories) {
          await saveShopCategory({
            guild_id: interaction.guildId,
            name: cat.name,
            discord_category_id: cat.discord_category_id,
            emoji: cat.emoji || '📦'
          });
        }
      }

      sessionStore.deleteSession(sessionId);

      // Render fresh Dashboard
      const dashPayload = await renderShopDashboard({
        guild: interaction.guild,
        activeTab: 'overview',
        userId: interaction.user.id
      });

      await safeRespond(interaction, dashPayload);
      return true;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. DASHBOARD ROUTING (shop:dash:...)
  // ───────────────────────────────────────────────────────────────────────────
  if (sub === 'dash') {
    const scope = arg1; // 'tab' | 'action'
    const guildId = arg2;
    const userId = arg3;
    const item = arg4;

    const isManager = await isShopManager(interaction.member);
    if (!isManager) {
      await safeRespond(interaction, errorCard({
        title: 'Access Restricted',
        reason: 'Only Shop Managers or Server Administrators can access dashboard controls.',
        ephemeral: true
      }), { ephemeral: true });
      return true;
    }

    if (scope === 'tab') {
      const tabName = item || 'overview';
      const dashPayload = await renderShopDashboard({
        guild: interaction.guild,
        activeTab: tabName,
        userId: interaction.user.id
      });
      await safeRespond(interaction, dashPayload);
      return true;
    }

    if (scope === 'action') {
      if (item === 'toggle_shop') {
        const current = await getShopSettings(guildId);
        await updateShopSettings(guildId, { is_enabled: !current.is_enabled });
        const dashPayload = await renderShopDashboard({
          guild: interaction.guild,
          activeTab: 'settings',
          userId: interaction.user.id
        });
        await safeRespond(interaction, dashPayload);
        return true;
      }

      if (item === 'refresh') {
        const dashPayload = await renderShopDashboard({
          guild: interaction.guild,
          activeTab: 'overview',
          userId: interaction.user.id
        });
        await safeRespond(interaction, dashPayload);
        return true;
      }

      if (item === 'run_setup') {
        const current = await getShopSettings(guildId);
        const newSession = sessionStore.createSession({
          module: 'shop_setup',
          guildId,
          userId: interaction.user.id,
          data: {
            step: 1,
            ...current
          }
        });
        const setupPayload = await renderSetupStep(newSession, interaction.guild);
        await safeRespond(interaction, setupPayload);
        return true;
      }
    }
  }

  return false;
}

export default {
  handleShopWizardInteraction
};

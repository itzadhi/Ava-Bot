import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { addBlacklist, removeBlacklist, listBlacklist } from '../../../db/blacklist.js';
import { logAudit } from '../../../db/audit.js';

export const blacklistTab = {
  id: 'blacklist',
  label: 'Blacklist',
  async render({ state }) {
    const page = state.blacklistPage || 1;
    const limit = 5;
    const list = await listBlacklist(null, page, limit);

    const lines = list.map((b, idx) => {
      const num = (page - 1) * limit + idx + 1;
      return `${num}. **[${b.type.toUpperCase()}]** \`${b.target_id}\`\n   Reason: ${b.reason} • Added by: <@${b.added_by}>`;
    });

    return {
      body: lines.length > 0 ? lines.join('\n') : '_No active blacklist records._',
      subtext: `Page ${page} • Active Restrictions`
    };
  },

  buttons({ state }) {
    const page = state.blacklistPage || 1;
    return [
      new ButtonBuilder()
        .setCustomId(`owner:blacklist:prev:${state.sessionId}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`owner:blacklist:next:${state.sessionId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:blacklist:add_modal:${state.sessionId}`)
        .setLabel('Add Entry')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:blacklist:remove_modal:${state.sessionId}`)
        .setLabel('Remove Entry')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'prev') {
      state.blacklistPage = Math.max(1, (state.blacklistPage || 1) - 1);
      return { status: `Moved to page ${state.blacklistPage}` };
    }
    if (action === 'next') {
      state.blacklistPage = (state.blacklistPage || 1) + 1;
      return { status: `Moved to page ${state.blacklistPage}` };
    }
    if (action === 'add_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:blacklist:add_submit:${state.sessionId}`)
        .setTitle('Add Blacklist Entry');
      const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type: user OR guild')
        .setPlaceholder('user or guild')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const idInput = new TextInputBuilder()
        .setCustomId('target_id')
        .setLabel('Target Discord Snowflake ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason for restriction')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(idInput),
        new ActionRowBuilder().addComponents(reasonInput)
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }
    if (action === 'remove_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:blacklist:remove_submit:${state.sessionId}`)
        .setTitle('Remove Blacklist Entry');
      const typeInput = new TextInputBuilder()
        .setCustomId('type')
        .setLabel('Type: user OR guild')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      const idInput = new TextInputBuilder()
        .setCustomId('target_id')
        .setLabel('Target Discord Snowflake ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(typeInput),
        new ActionRowBuilder().addComponents(idInput)
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }
    return {};
  },

  async handleModalSubmit({ action, interaction, state, client }) {
    const type = interaction.fields.getTextInputValue('type')?.trim().toLowerCase();
    const targetId = interaction.fields.getTextInputValue('target_id')?.trim();

    if (action === 'add_submit') {
      const reason = interaction.fields.getTextInputValue('reason')?.trim();
      if (!['user', 'guild'].includes(type)) {
        return { status: 'Error: Type must be either "user" or "guild"' };
      }
      await addBlacklist(type, targetId, reason, interaction.user.id);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_BLACKLIST_ADD',
        details: { type, targetId, reason }
      });

      // Auto-leave if a guild is blacklisted
      if (type === 'guild' && client.guilds.cache.has(targetId)) {
        try {
          await client.guilds.cache.get(targetId).leave();
        } catch (_) {}
      }

      return { status: `Successfully blacklisted ${type} ${targetId}` };
    }

    if (action === 'remove_submit') {
      if (!['user', 'guild'].includes(type)) {
        return { status: 'Error: Type must be either "user" or "guild"' };
      }
      await removeBlacklist(type, targetId);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_BLACKLIST_REMOVE',
        details: { type, targetId }
      });
      return { status: `Successfully removed ${type} ${targetId} from blacklist` };
    }

    return {};
  }
};

export default blacklistTab;

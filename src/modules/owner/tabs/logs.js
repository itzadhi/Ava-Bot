import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { getErrorLogs, clearOldErrors } from '../../../db/errors.js';
import { db } from '../../../db/client.js';
import { logAudit } from '../../../db/audit.js';

export const logsTab = {
  id: 'logs',
  label: 'Logs',
  async render({ state }) {
    const page = state.logsPage || 1;
    const limit = 5;
    const errors = await getErrorLogs({ limit, page });

    const lines = errors.map((e, idx) => {
      const num = (page - 1) * limit + idx + 1;
      return `${num}. **#${e.id} [${e.scope}]**: ${e.message}\n   -# Logged <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`;
    });

    return {
      body: lines.length > 0 ? lines.join('\n\n') : '_No recorded error logs found._',
      subtext: `Page ${page} • System Error Logs`
    };
  },

  buttons({ state }) {
    const page = state.logsPage || 1;
    return [
      new ButtonBuilder()
        .setCustomId(`owner:logs:prev:${state.sessionId}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`owner:logs:next:${state.sessionId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:logs:view_stack_modal:${state.sessionId}`)
        .setLabel('View Stack')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`owner:logs:clear_old:${state.sessionId}`)
        .setLabel('Clear >7d')
        .setStyle(ButtonStyle.Danger)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'prev') {
      state.logsPage = Math.max(1, (state.logsPage || 1) - 1);
      return { status: `Moved to page ${state.logsPage}` };
    }

    if (action === 'next') {
      state.logsPage = (state.logsPage || 1) + 1;
      return { status: `Moved to page ${state.logsPage}` };
    }

    if (action === 'view_stack_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:logs:stack_submit:${state.sessionId}`)
        .setTitle('Inspect Error Stack Trace');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('error_id').setLabel('Error ID').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'clear_old') {
      await clearOldErrors(7);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_CLEAR_OLD_ERRORS',
        details: { olderThanDays: 7 }
      });
      return { status: 'Cleared error logs older than 7 days' };
    }

    return {};
  },

  async handleModalSubmit({ action, interaction, state }) {
    if (action === 'stack_submit') {
      const errorId = interaction.fields.getTextInputValue('error_id')?.trim();
      const { data } = await db.from('error_logs').select('*').eq('id', errorId).maybeSingle();

      if (!data) {
        return { status: `Error #${errorId} not found.` };
      }

      const stackSnippet = (data.stack || 'No stack trace available').slice(0, 1500);
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: `**Error #${data.id} [${data.scope}]**\n\`\`\`js\n${stackSnippet}\n\`\`\``
      }).catch(() => {});

      return { modalReplied: true, status: `Inspected stack for Error #${errorId}` };
    }
    return {};
  }
};

export default logsTab;

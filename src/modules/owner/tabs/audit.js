import { ButtonBuilder, ButtonStyle } from 'discord.js';
import { getAuditLogs } from '../../../db/audit.js';

export const auditTab = {
  id: 'audit',
  label: 'Audit',
  async render({ state }) {
    const page = state.auditPage || 1;
    const limit = 5;
    const logs = await getAuditLogs({ limit, page });

    const lines = logs.map((l, idx) => {
      const num = (page - 1) * limit + idx + 1;
      const unix = Math.floor(new Date(l.created_at).getTime() / 1000);
      const details = JSON.stringify(l.details || {});
      return `${num}. **${l.action}** by <@${l.user_id}>\n   Details: \`${details}\`\n   -# <t:${unix}:R>`;
    });

    return {
      body: lines.length > 0 ? lines.join('\n\n') : '_No audit records recorded yet._',
      subtext: `Page ${page} • System & Administrative Audit Trail`
    };
  },

  buttons({ state }) {
    const page = state.auditPage || 1;
    return [
      new ButtonBuilder()
        .setCustomId(`owner:audit:prev:${state.sessionId}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`owner:audit:next:${state.sessionId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:audit:refresh:${state.sessionId}`)
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, state }) {
    if (action === 'prev') {
      state.auditPage = Math.max(1, (state.auditPage || 1) - 1);
      return { status: `Moved to page ${state.auditPage}` };
    }

    if (action === 'next') {
      state.auditPage = (state.auditPage || 1) + 1;
      return { status: `Moved to page ${state.auditPage}` };
    }

    return { status: 'Audit trail refreshed' };
  }
};

export default auditTab;

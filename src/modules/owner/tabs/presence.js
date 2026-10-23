import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ActivityType } from 'discord.js';
import { getBotState, setBotState } from '../../../db/botState.js';
import { logAudit } from '../../../db/audit.js';

export const presenceTab = {
  id: 'presence',
  label: 'Presence',
  async render({ client }) {
    const presenceConfig = getBotState('presence') || { type: 'Playing', text: 'a!help | /backup', status: 'online' };

    const lines = [
      `**Current Activity Type**: ${presenceConfig.type}`,
      `**Activity Text**: "${presenceConfig.text}"`,
      `**Status State**: ${presenceConfig.status.toUpperCase()}`
    ];

    return {
      body: lines.join('\n'),
      subtext: 'Discord Client Rich Presence Control'
    };
  },

  buttons({ state }) {
    return [
      new ButtonBuilder()
        .setCustomId(`owner:presence:status_modal:${state.sessionId}`)
        .setLabel('Set Activity')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:presence:state_modal:${state.sessionId}`)
        .setLabel('Set State')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:presence:reset:${state.sessionId}`)
        .setLabel('Reset Default')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, interaction, state, client }) {
    if (action === 'status_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:presence:status_submit:${state.sessionId}`)
        .setTitle('Set Activity Status');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('type').setLabel('Type: Playing, Watching, Competing').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('text').setLabel('Activity Text').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'state_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:presence:state_submit:${state.sessionId}`)
        .setTitle('Set Online State');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('status').setLabel('Status: online, idle, dnd').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'reset') {
      const defaultPresence = { type: 'Playing', text: 'a!help | /backup', status: 'online' };
      await setBotState('presence', defaultPresence);
      client.user.setPresence({
        activities: [{ name: defaultPresence.text, type: ActivityType.Playing }],
        status: 'online'
      });
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_PRESENCE_RESET',
        details: defaultPresence
      });
      return { status: 'Reset presence to defaults' };
    }

    return {};
  },

  async handleModalSubmit({ action, interaction, state, client }) {
    const current = getBotState('presence') || { type: 'Playing', text: 'a!help', status: 'online' };

    if (action === 'status_submit') {
      const rawType = interaction.fields.getTextInputValue('type')?.trim();
      const text = interaction.fields.getTextInputValue('text')?.trim();

      let actType = ActivityType.Playing;
      if (rawType.toLowerCase() === 'watching') actType = ActivityType.Watching;
      if (rawType.toLowerCase() === 'competing') actType = ActivityType.Competing;
      if (rawType.toLowerCase() === 'listening') actType = ActivityType.Listening;

      const updated = { ...current, type: rawType, text };
      await setBotState('presence', updated);

      client.user.setPresence({
        activities: [{ name: text, type: actType }],
        status: current.status || 'online'
      });

      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_PRESENCE_UPDATE',
        details: updated
      });

      return { status: `Presence updated to ${rawType} "${text}"` };
    }

    if (action === 'state_submit') {
      const status = interaction.fields.getTextInputValue('status')?.trim().toLowerCase();
      if (!['online', 'idle', 'dnd'].includes(status)) {
        return { status: 'Error: Status must be "online", "idle", or "dnd"' };
      }

      const updated = { ...current, status };
      await setBotState('presence', updated);

      client.user.setPresence({ status });

      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_PRESENCE_STATE_UPDATE',
        details: { status }
      });

      return { status: `Bot state updated to ${status.toUpperCase()}` };
    }

    return {};
  }
};

export default presenceTab;

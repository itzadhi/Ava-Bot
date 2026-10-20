import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { registry } from '../../../structures/CommandRegistry.js';
import { loadCommands } from '../../../structures/loader.js';
import { getBotState, setBotState } from '../../../db/botState.js';
import { logAudit } from '../../../db/audit.js';

export const commandsTab = {
  id: 'commands',
  label: 'Commands',
  async render({ state }) {
    const disabledList = getBotState('disabled_commands') || [];
    const totalCommands = registry.commands.size;

    const disabledNames = disabledList.map(d => typeof d === 'string' ? d : `${d.name} (${d.reason})`);

    const lines = [
      `**Total Registered Commands**: ${totalCommands}`,
      `**Disabled Commands**: ${disabledList.length}`,
      '',
      disabledNames.length > 0
        ? `**Disabled List**:\n${disabledNames.map(d => `• \`${d}\``).join('\n')}`
        : '_All commands are currently enabled and operational._'
    ];

    return {
      body: lines.join('\n'),
      subtext: 'Runtime Command Controls'
    };
  },

  buttons({ state }) {
    return [
      new ButtonBuilder()
        .setCustomId(`owner:commands:reload_all:${state.sessionId}`)
        .setLabel('Reload All')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`owner:commands:disable_modal:${state.sessionId}`)
        .setLabel('Disable Command')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`owner:commands:enable_modal:${state.sessionId}`)
        .setLabel('Enable Command')
        .setStyle(ButtonStyle.Success)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'reload_all') {
      registry.commands.clear();
      registry.aliases.clear();
      registry.categories.clear();
      const count = await loadCommands();
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_RELOAD_COMMANDS',
        details: { count }
      });
      return { status: `Successfully reloaded ${count} commands into memory` };
    }

    if (action === 'disable_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:commands:disable_submit:${state.sessionId}`)
        .setTitle('Disable Command');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('command').setLabel('Command Name').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('reason').setLabel('Reason for disabling').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'enable_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:commands:enable_submit:${state.sessionId}`)
        .setTitle('Enable Command');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('command').setLabel('Command Name').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    return {};
  },

  async handleModalSubmit({ action, interaction, state }) {
    const cmdName = interaction.fields.getTextInputValue('command')?.trim().toLowerCase();
    const currentDisabled = getBotState('disabled_commands') || [];

    if (action === 'disable_submit') {
      const reason = interaction.fields.getTextInputValue('reason')?.trim();
      const filtered = currentDisabled.filter(d => (typeof d === 'string' ? d : d.name) !== cmdName);
      filtered.push({ name: cmdName, reason });

      await setBotState('disabled_commands', filtered);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_COMMAND_DISABLED',
        details: { command: cmdName, reason }
      });

      return { status: `Command /${cmdName} disabled (${reason})` };
    }

    if (action === 'enable_submit') {
      const filtered = currentDisabled.filter(d => (typeof d === 'string' ? d : d.name) !== cmdName);
      await setBotState('disabled_commands', filtered);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_COMMAND_ENABLED',
        details: { command: cmdName }
      });

      return { status: `Command /${cmdName} re-enabled` };
    }

    return {};
  }
};

export default commandsTab;

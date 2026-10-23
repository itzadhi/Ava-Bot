import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { logAudit } from '../../../db/audit.js';

export const guildsTab = {
  id: 'guilds',
  label: 'Guilds',
  async render({ client, state }) {
    const page = state.guildsPage || 1;
    const limit = 5;

    const allGuilds = Array.from(client.guilds.cache.values())
      .sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));

    const totalPages = Math.max(1, Math.ceil(allGuilds.length / limit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    state.guildsPage = safePage;

    const slice = allGuilds.slice((safePage - 1) * limit, safePage * limit);
    const lines = slice.map((g, idx) => {
      const num = (safePage - 1) * limit + idx + 1;
      return `${num}. **${g.name}** (\`${g.id}\`)\n   Members: ${g.memberCount.toLocaleString()} • Owner: <@${g.ownerId}>`;
    });

    return {
      body: lines.length > 0 ? lines.join('\n') : '_No guilds connected._',
      subtext: `Page ${safePage}/${totalPages} • Sorted by Member Count`
    };
  },

  buttons({ state }) {
    const page = state.guildsPage || 1;
    return [
      new ButtonBuilder()
        .setCustomId(`owner:guilds:prev:${state.sessionId}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page <= 1),
      new ButtonBuilder()
        .setCustomId(`owner:guilds:next:${state.sessionId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:guilds:inspect_modal:${state.sessionId}`)
        .setLabel('Inspect')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`owner:guilds:leave_modal:${state.sessionId}`)
        .setLabel('Leave Guild')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, interaction, state, client }) {
    if (action === 'prev') {
      state.guildsPage = Math.max(1, (state.guildsPage || 1) - 1);
      return { status: `Moved to page ${state.guildsPage}` };
    }
    if (action === 'next') {
      state.guildsPage = (state.guildsPage || 1) + 1;
      return { status: `Moved to page ${state.guildsPage}` };
    }
    if (action === 'inspect_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:guilds:inspect_submit:${state.sessionId}`)
        .setTitle('Inspect Server');
      const input = new TextInputBuilder()
        .setCustomId('guild_id')
        .setLabel('Discord Server ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return { modalShown: true };
    }
    if (action === 'leave_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:guilds:leave_submit:${state.sessionId}`)
        .setTitle('Force Leave Server');
      const input = new TextInputBuilder()
        .setCustomId('guild_id')
        .setLabel('Guild ID to disconnect from')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return { modalShown: true };
    }
    return {};
  },

  async handleModalSubmit({ action, interaction, state, client }) {
    const guildId = interaction.fields.getTextInputValue('guild_id')?.trim();
    const guild = client.guilds.cache.get(guildId);

    if (action === 'inspect_submit') {
      if (!guild) {
        return { status: `Guild ${guildId} not found in bot cache` };
      }
      return {
        status: `Guild: ${guild.name} | Members: ${guild.memberCount} | Channels: ${guild.channels.cache.size} | Roles: ${guild.roles.cache.size}`
      };
    }

    if (action === 'leave_submit') {
      if (!guild) {
        return { status: `Guild ${guildId} not found in bot cache` };
      }
      const name = guild.name;
      await guild.leave();
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_FORCE_LEAVE_GUILD',
        details: { guildId, name }
      });
      return { status: `Successfully departed guild "${name}" (${guildId})` };
    }

    return {};
  }
};

export default guildsTab;

import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { getGuildSettings } from '../../../db/guilds.js';
import { infoCard, progressCard } from '../../../ui/cards.js';
import { addJob } from '../../../services/queue.js';
import { logAudit } from '../../../db/audit.js';

export const broadcastTab = {
  id: 'broadcast',
  label: 'Broadcast',
  async render({ state }) {
    if (state.broadcastDraft) {
      const { title, message } = state.broadcastDraft;
      const lines = [
        '**Draft Announcement Pending Confirmation**:',
        `**Title**: ${title}`,
        `**Content**: ${message}`,
        '',
        'Click "Confirm & Dispatch" to send to all server log channels (or server owners).'
      ];
      return {
        body: lines.join('\n'),
        subtext: 'Broadcast Draft Ready'
      };
    }

    if (state.broadcastProgress) {
      const { sent, failed, total } = state.broadcastProgress;
      return {
        body: `**Broadcasting**: ${sent} sent, ${failed} failed out of ${total} total servers.`,
        subtext: 'Live Dispatch Progress'
      };
    }

    return {
      body: 'No broadcast currently composed. Click "Compose" to write an announcement.',
      subtext: 'Global Broadcast System'
    };
  },

  buttons({ state }) {
    if (state.broadcastDraft) {
      return [
        new ButtonBuilder()
          .setCustomId(`owner:broadcast:confirm_dispatch:${state.sessionId}`)
          .setLabel('Confirm & Dispatch')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`owner:broadcast:cancel_draft:${state.sessionId}`)
          .setLabel('Cancel Draft')
          .setStyle(ButtonStyle.Secondary)
      ];
    }

    return [
      new ButtonBuilder()
        .setCustomId(`owner:broadcast:compose_modal:${state.sessionId}`)
        .setLabel('Compose')
        .setStyle(ButtonStyle.Primary)
    ];
  },

  async handleAction({ action, interaction, state, client }) {
    if (action === 'compose_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:broadcast:compose_submit:${state.sessionId}`)
        .setTitle('Compose System Broadcast');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('title').setLabel('Broadcast Title').setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('message').setLabel('Broadcast Message').setStyle(TextInputStyle.Paragraph).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'cancel_draft') {
      state.broadcastDraft = null;
      return { status: 'Broadcast draft cleared' };
    }

    if (action === 'confirm_dispatch') {
      const draft = state.broadcastDraft;
      if (!draft) return { status: 'No draft found to dispatch' };

      const guilds = Array.from(client.guilds.cache.values());
      state.broadcastProgress = { sent: 0, failed: 0, total: guilds.length };
      state.broadcastDraft = null;

      // Asynchronous background queued job
      (async () => {
        for (const g of guilds) {
          await addJob(async () => {
            try {
              const settings = await getGuildSettings(g.id);
              let channel = settings?.log_channel_id ? g.channels.cache.get(settings.log_channel_id) : null;
              if (!channel) {
                // Find system channel or first text channel
                channel = g.systemChannel || g.channels.cache.find(c => c.isTextBased() && c.permissionsFor(g.members.me)?.has('SendMessages'));
              }

              const payload = infoCard({
                title: draft.title,
                subtitle: 'Official Argoni Announcement',
                body: draft.message,
                subtext: 'System Broadcast'
              });

              if (channel) {
                await channel.send(payload);
                state.broadcastProgress.sent++;
              } else {
                // Fallback to guild owner DM
                const owner = await client.users.fetch(g.ownerId).catch(() => null);
                if (owner) {
                  await owner.send(payload);
                  state.broadcastProgress.sent++;
                } else {
                  state.broadcastProgress.failed++;
                }
              }
            } catch (_) {
              state.broadcastProgress.failed++;
            }
          });
        }

        await logAudit({
          userId: interaction.user.id,
          action: 'OWNER_BROADCAST_SENT',
          details: { title: draft.title, total: guilds.length }
        });
      })();

      return { status: `Dispatched broadcast to ${guilds.length} servers via rate-limited queue` };
    }

    return {};
  },

  async handleModalSubmit({ action, interaction, state }) {
    if (action === 'compose_submit') {
      const title = interaction.fields.getTextInputValue('title')?.trim();
      const message = interaction.fields.getTextInputValue('message')?.trim();
      state.broadcastDraft = { title, message };
      return { status: 'Broadcast draft saved. Review and confirm to send.' };
    }
    return {};
  }
};

export default broadcastTab;

import {
  autoRestoreChannel,
  autoRestoreAllChannels,
  getChannelVaultMessages,
  exportChannelChatlog,
  restoreChannelChatlog
} from './engine.js';
import {
  getChatlogById,
  deleteChatlogRecord
} from '../../db/chatlogs.js';
import { deleteSnapshot } from '../../db/storage.js';
import { logAudit } from '../../db/audit.js';
import { renderChatlogPanel, renderChannelRestorePrompt } from './panel.js';
import { successCard, errorCard, warnCard } from '../../ui/cards.js';
import { logger } from '../../utils/logger.js';

// Concurrency locks
const activeRestores = new Set();

export const chatlogComponents = [
  // 1. Instant 1-Click Auto-Restore for Current Channel
  {
    customId: 'chatlog_auto_restore_current:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          ...errorCard({
            title: 'Text Channel Required',
            reason: 'Auto-restore must be triggered from inside a text channel.',
            fix: 'Run /chatlog in the channel you want to restore.'
          }),
          ephemeral: true
        });
      }

      if (activeRestores.has(channel.id)) {
        return interaction.reply({
          ...warnCard({
            title: 'Restoration In Progress',
            subtitle: 'Recovery is already running for this channel.',
            body: 'Please wait a moment for the active restore stream to complete.'
          }),
          ephemeral: true
        });
      }

      await interaction.deferUpdate().catch(() => {});
      activeRestores.add(channel.id);

      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      try {
        const { count } = await autoRestoreChannel({
          guild,
          channel,
          user: interaction.user,
          onProgress: async (progressPayload) => {
            await interaction.editReply(progressPayload).catch(() => {});
          }
        });

        const panel = await renderChatlogPanel({ guild, channel });
        await interaction.editReply(panel);

        return interaction.followUp(successCard({
          title: 'Chat Restored Successfully',
          subtitle: `Recovered ${count} messages in #${channel.name}`,
          body: `All continuous messages, embeds, and bot cards were restored automatically via webhooks.`,
          ephemeral: true
        }));
      } catch (err) {
        logger.error({ err }, 'Error in autoRestoreChannel');
        return interaction.followUp(errorCard({
          title: 'Auto-Restore Failed',
          reason: err.message,
          fix: 'Ensure the bot has Manage Webhooks and View Channel permissions.',
          ephemeral: true
        }));
      } finally {
        activeRestores.delete(channel.id);
      }
    }
  },

  // 2. Full Automatic Server-Wide Restore Across All Channels
  {
    customId: 'chatlog_auto_restore_all:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});

      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      try {
        const { totalChannels, totalMessages } = await autoRestoreAllChannels({
          guild,
          user: interaction.user,
          onProgress: async (progressPayload) => {
            await interaction.editReply(progressPayload).catch(() => {});
          }
        });

        const panel = await renderChatlogPanel({ guild, channel: interaction.channel });
        await interaction.editReply(panel);

        return interaction.followUp(successCard({
          title: 'Server Chat Recovery Complete',
          subtitle: `Restored ${totalMessages} messages across ${totalChannels} channels`,
          body: `All server channels have been automatically populated with their chat history.`,
          ephemeral: true
        }));
      } catch (err) {
        return interaction.followUp(errorCard({
          title: 'Server Recovery Failed',
          reason: err.message,
          fix: 'Ensure the bot has Manage Webhooks permission across server channels.',
          ephemeral: true
        }));
      }
    }
  },

  // 3. Dropdown Channel Selector for Targeted Recovery
  {
    customId: 'chatlog_select_channel:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const rawVal = interaction.values[0];
      const targetChannelId = rawVal.replace('restore_target:', '');
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const targetChannel = guild.channels.cache.get(targetChannelId);

      if (!targetChannel) {
        return interaction.followUp(errorCard({
          title: 'Channel Not Found',
          reason: 'The selected channel could not be found.',
          fix: 'Select an active channel from the list.',
          ephemeral: true
        }));
      }

      const msgs = await getChannelVaultMessages({ guild, channel: targetChannel, limit: 100 });
      const prompt = renderChannelRestorePrompt({
        guild,
        channel: targetChannel,
        messageCount: msgs.length
      });

      return interaction.editReply(prompt);
    }
  },

  // 4. Confirm Restoration for Selected Channel
  {
    customId: 'chatlog_confirm_restore:*',
    type: 'button',
    execute: async (interaction, [channelId]) => {
      const guild = interaction.guild;
      const targetChannel = guild.channels.cache.get(channelId);
      if (!targetChannel) {
        return interaction.reply({
          ...errorCard({
            title: 'Channel Not Found',
            reason: 'Target channel does not exist.',
            fix: 'Select a valid channel from /chatlog.'
          }),
          ephemeral: true
        });
      }

      await interaction.deferUpdate().catch(() => {});

      try {
        const { count } = await autoRestoreChannel({
          guild,
          channel: targetChannel,
          user: interaction.user,
          onProgress: async (progressPayload) => {
            await interaction.editReply(progressPayload).catch(() => {});
          }
        });

        const panel = await renderChatlogPanel({ guild, channel: targetChannel });
        await interaction.editReply(panel);

        return interaction.followUp(successCard({
          title: 'Channel Restored',
          subtitle: `Recovered ${count} messages into #${targetChannel.name}`,
          body: `Automatic message recovery finished successfully.`,
          ephemeral: true
        }));
      } catch (err) {
        return interaction.followUp(errorCard({
          title: 'Restoration Failed',
          reason: err.message,
          fix: 'Verify Manage Webhooks permission.',
          ephemeral: true
        }));
      }
    }
  },

  // 5. Panel Refresh Button
  {
    customId: 'chatlog_btn_refresh:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const panel = await renderChatlogPanel({ guild, channel: interaction.channel });
      return interaction.editReply(panel);
    }
  },

  // Backwards Compatibility: chatlog_btn_create (Archive Channel)
  {
    customId: 'chatlog_btn_create:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ flags: 64, content: '⚠️ Trigger from inside a text channel.' });
      }

      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      try {
        const { count } = await autoRestoreChannel({ guild, channel, user: interaction.user });
        const panel = await renderChatlogPanel({ guild, channel });
        await interaction.editReply(panel);
        return interaction.followUp(successCard({
          title: 'Auto-Vault Synchronized',
          subtitle: `Preserved and verified ${count} messages`,
          body: `Real-time chat vault is synchronized for #${channel.name}.`,
          ephemeral: true
        }));
      } catch (err) {
        return interaction.followUp(errorCard({ title: 'Sync Failed', reason: err.message, ephemeral: true }));
      }
    }
  },

  // Backwards Compatibility: chatlog_btn_replay
  {
    customId: 'chatlog_btn_replay:*',
    type: 'button',
    execute: async (interaction, [chatlogId]) => {
      const channel = interaction.channel;
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({ flags: 64, content: '⚠️ Trigger from inside a text channel.' });
      }

      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.guild;

      try {
        const record = await getChatlogById(chatlogId);
        if (record) {
          await restoreChannelChatlog({ guild, channel, user: interaction.user, chatlogRecord: record });
        } else {
          await autoRestoreChannel({ guild, channel, user: interaction.user });
        }
        const panel = await renderChatlogPanel({ guild, channel });
        return interaction.editReply(panel);
      } catch (err) {
        return interaction.followUp(errorCard({ title: 'Replay Failed', reason: err.message, ephemeral: true }));
      }
    }
  },

  // Backwards Compatibility: chatlog_btn_back
  {
    customId: 'chatlog_btn_back:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const panel = await renderChatlogPanel({ guild, channel: interaction.channel });
      return interaction.editReply(panel);
    }
  }
];

export default chatlogComponents;

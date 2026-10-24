import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} from 'discord.js';
import { updateGuildSettings } from '../../db/guilds.js';
import {
  getBackupById,
  getGuildBackups,
  getUserBackups,
  setBackupLock,
  deleteBackupRecord
} from '../../db/backups.js';
import { downloadSnapshot, deleteSnapshot } from '../../db/storage.js';
import { createServerBackup } from './creator.js';
import { restoreServerBackup, validateRestorePermissions } from './restorer.js';
import {
  renderBackupStructure,
  renderBackupList,
  getUserConfig,
  userRestoreConfigs
} from './command.js';
import { restoreConsoleCard, confirmCard, errorCard, successCard, card } from '../../ui/cards.js';
import { formatBytes } from '../../utils/time.js';
import { logAudit } from '../../db/audit.js';

// In-flight operation guards to prevent double-click race conditions
const activeRestores = new Set();
const activeCreations = new Set();

export const backupComponents = [
  // 1. Interactive Dropdown Select Menu Inspector Handler
  {
    customId: 'bk_select_inspect:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const rawVal = interaction.values[0];
      const backupId = rawVal.replace('inspect:', '');
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const payload = await renderBackupStructure({ backupId, guild, user: interaction.user });
      return interaction.editReply(payload);
    }
  },

  // 2. Interactive Restore Module Multi-Select Menu Handler
  {
    customId: 'bk_select_modules:*',
    type: 'select',
    execute: async (interaction, [backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const key = `${interaction.user.id}:${backupId}`;
      userRestoreConfigs.set(key, new Set(interaction.values));
      const payload = await renderBackupStructure({ backupId, guild: interaction.guild, user: interaction.user });
      return interaction.editReply(payload);
    }
  },

  // 3. Delete Backup from Structure Inspector (Confirmation Prompt)
  {
    customId: 'bk_delete_snapshot:*',
    type: 'button',
    execute: async (interaction, [backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const record = await getBackupById(backupId);
      if (!record) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Not Found',
          reason: `Backup \`${backupId}\` could not be located in database.`,
          fix: 'Return to the backup list to view available snapshots.',
          ephemeral: true
        }));
      }
      if (record.locked) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Is Protected',
          reason: `Backup **${record.name}** (\`${backupId}\`) is currently **locked**.`,
          fix: 'Tap Unlock in the structure inspector before attempting to delete this snapshot.',
          ephemeral: true
        }));
      }

      const promptPayload = confirmCard({
        title: 'Confirm Snapshot Deletion',
        subtitle: `Are you sure you want to permanently delete "${record.name}"?`,
        details: [
          `> 🔑 **Backup ID**: \`${record.id}\``,
          `> 🏷️ **Name**: **${record.name}**`,
          `> 🌐 **Origin**: \`${record.guild_id}\``,
          '',
          '> ⚠️ **Warning**: This action cannot be undone. All roles, channels, permissions, and message data for this snapshot will be permanently purged from cloud storage.'
        ].join('\n'),
        confirmCustomId: `bk_confirm_delete:${interaction.user.id}:${backupId}`,
        cancelCustomId: `bk_cancel_delete:${interaction.user.id}:${backupId}`,
        confirmLabel: 'Permanently Delete',
        cancelLabel: 'Cancel & Keep',
        danger: true
      });

      return interaction.editReply(promptPayload);
    }
  },

  // 4. Delete Backup Directly from Front Panel
  {
    customId: 'bk_front_delete:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      const [guildBackups, userBackups] = await Promise.all([
        getGuildBackups(guild.id, { limit: 100, order: 'desc' }).catch(() => []),
        getUserBackups(interaction.user.id, { limit: 100, order: 'desc' }).catch(() => [])
      ]);

      const map = new Map();
      for (const b of userBackups) map.set(b.id, b);
      for (const b of guildBackups) map.set(b.id, b);
      const allBackups = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

      if (allBackups.length === 0) {
        return interaction.editReply(errorCard({
          title: 'No Snapshots Available',
          reason: 'There are no backups stored to delete.',
          fix: 'Create a backup first by tapping New Snapshot.',
          ephemeral: true
        }));
      }

      // If exactly 1 backup exists, immediately show confirmation prompt for that backup
      if (allBackups.length === 1) {
        const record = allBackups[0];
        if (record.locked) {
          return interaction.editReply(errorCard({
            title: 'Snapshot Is Protected',
            reason: `Backup **${record.name}** (\`${record.id}\`) is currently **locked**.`,
            fix: 'Select the backup from the list and tap Unlock before deleting.',
            ephemeral: true
          }));
        }

        const promptPayload = confirmCard({
          title: 'Confirm Snapshot Deletion',
          subtitle: `Are you sure you want to permanently delete "${record.name}"?`,
          details: [
            `> 🔑 **Backup ID**: \`${record.id}\``,
            `> 🏷️ **Name**: **${record.name}**`,
            '',
            '> ⚠️ **Warning**: This action cannot be undone. All roles, channels, and message data for this snapshot will be permanently purged from cloud storage.'
          ].join('\n'),
          confirmCustomId: `bk_confirm_delete:${interaction.user.id}:${record.id}`,
          cancelCustomId: `bk_cancel_delete:${interaction.user.id}:${record.id}`,
          confirmLabel: 'Permanently Delete',
          cancelLabel: 'Cancel & Keep',
          danger: true
        });
        return interaction.editReply(promptPayload);
      }

      // If multiple backups exist, present a dropdown menu to choose which backup to delete
      const deleteOptions = allBackups.slice(0, 25).map(b =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Delete: ${b.name.slice(0, 18)} (${b.id})`)
          .setValue(`delete_pick:${b.id}`)
          .setEmoji('🗑️')
          .setDescription(`${b.locked ? '🔒 Locked' : '🔓 Unlocked'} • ${formatBytes(b.size_bytes)}`)
      );

      const deleteRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`bk_select_delete:${guild.id}`)
          .setPlaceholder('🗑️ Select which snapshot to delete...')
          .addOptions(deleteOptions)
      );

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bk_return_to_list:${guild.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
      );

      const payload = card({
        title: 'Delete Backup Snapshot',
        glyph: '🗑️',
        subtitle: `Choose which snapshot to delete from ${guild.name}`,
        body: '> ⚠️ **Choose a backup to permanently delete** from the dropdown below.\n> Locked backups must be unlocked first before deletion.',
        subtext: 'Tap Cancel to return',
        rows: [deleteRow, cancelRow]
      });

      return interaction.editReply(payload);
    }
  },

  // 5. Select Backup to Delete from Dropdown
  {
    customId: 'bk_select_delete:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const rawVal = interaction.values[0];
      const backupId = rawVal.replace('delete_pick:', '');
      const record = await getBackupById(backupId);

      if (!record) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Not Found',
          reason: `Backup \`${backupId}\` was not found.`,
          fix: 'Return to /backup list to view active snapshots.',
          ephemeral: true
        }));
      }

      if (record.locked) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Is Protected',
          reason: `Backup **${record.name}** (\`${backupId}\`) is currently **locked**.`,
          fix: 'Select the backup from the list and tap Unlock before deleting.',
          ephemeral: true
        }));
      }

      const promptPayload = confirmCard({
        title: 'Confirm Snapshot Deletion',
        subtitle: `Are you sure you want to permanently delete "${record.name}"?`,
        details: [
          `> 🔑 **Backup ID**: \`${record.id}\``,
          `> 🏷️ **Name**: **${record.name}**`,
          '',
          '> ⚠️ **Warning**: This action cannot be undone. All roles, channels, and message data for this snapshot will be permanently purged from cloud storage.'
        ].join('\n'),
        confirmCustomId: `bk_confirm_delete:${interaction.user.id}:${backupId}`,
        cancelCustomId: `bk_cancel_delete:${interaction.user.id}:${backupId}`,
        confirmLabel: 'Permanently Delete',
        cancelLabel: 'Cancel & Keep',
        danger: true
      });

      return interaction.editReply(promptPayload);
    }
  },

  // 6. Confirmed Deletion Handler
  {
    customId: 'bk_confirm_delete:*:*',
    type: 'button',
    execute: async (interaction, [userId, backupId]) => {
      if (interaction.user.id !== userId) {
        return interaction.reply({ flags: 64, content: '⚠️ Only the user who initiated this deletion can confirm.' });
      }
      await interaction.deferUpdate().catch(() => {});
      const record = await getBackupById(backupId);
      if (record && !record.locked) {
        await deleteSnapshot(record.storage_path);
        await deleteBackupRecord(backupId);
        await logAudit({
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          action: 'BACKUP_DELETED',
          details: { backupId, name: record.name }
        });
      }

      const payload = await renderBackupList({ guild: interaction.guild, user: interaction.user, page: 1 });
      return interaction.editReply(payload);
    }
  },

  // 7. Cancel Deletion Handler
  {
    customId: 'bk_cancel_delete:*:*',
    type: 'button',
    execute: async (interaction, [userId, backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const payload = await renderBackupList({ guild: interaction.guild, user: interaction.user, page: 1 });
      return interaction.editReply(payload);
    }
  },

  // 8. Return to List Handler
  {
    customId: 'bk_return_to_list:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const payload = await renderBackupList({ guild, user: interaction.user, page: 1 });
      return interaction.editReply(payload);
    }
  },

  // 9. Quick Deploy from Structure Inspector -> Goes to Confirmation Console
  {
    customId: 'bk_quick_deploy:*',
    type: 'button',
    execute: async (interaction, [backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const record = await getBackupById(backupId);
      if (!record) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Not Found',
          reason: `Backup \`${backupId}\` could not be located in database.`,
          fix: 'Return to the backup list to view available snapshots.',
          ephemeral: true
        }));
      }

      const originGuild = interaction.client.guilds.cache.get(record.guild_id);
      const originName = originGuild ? originGuild.name : `Origin ID ${record.guild_id}`;
      const isCrossServer = record.guild_id !== interaction.guild.id;

      const userConfig = getUserConfig(interaction.user.id, backupId);
      const clean = userConfig.has('clean');

      const confirmMsg = restoreConsoleCard({
        stage: 'confirm',
        record,
        targetGuildName: interaction.guild.name,
        originGuildName: originName,
        isCrossServer,
        clean,
        confirmCustomId: `bk_confirm_deploy:${interaction.user.id}:${backupId}`,
        cancelCustomId: `bk_cancel_deploy:${interaction.user.id}:${backupId}`
      });
      return interaction.editReply(confirmMsg);
    }
  },

  // 10. Confirmation Deployment Execution with Double-Execution Prevention
  {
    customId: 'bk_confirm_deploy:*:*',
    type: 'button',
    execute: async (interaction, [userId, backupId]) => {
      if (interaction.user.id !== userId) {
        return interaction.reply({ flags: 64, content: '⚠️ Only the user who initiated this deployment can confirm.' });
      }

      const guildId = interaction.guild.id;
      if (activeRestores.has(guildId)) {
        return interaction.reply({
          flags: 64,
          content: '⚠️ A restore operation is already in progress for this server. Please wait for it to complete.'
        });
      }

      await interaction.deferUpdate().catch(() => {});

      const record = await getBackupById(backupId);
      if (!record) {
        return interaction.editReply(errorCard({
          title: 'Snapshot Not Found',
          reason: `Backup \`${backupId}\` was not found.`,
          fix: 'Return to /backup to select an existing snapshot.',
          ephemeral: true
        }));
      }

      const permCheck = validateRestorePermissions(interaction.guild);
      if (!permCheck.valid) {
        return interaction.editReply(errorCard({
          title: 'Missing Bot Permissions',
          reason: `AVA is missing required permissions: ${permCheck.missing.join(', ')}`,
          fix: 'Grant Administrator or Manage Roles / Manage Channels permissions to AVA.',
          ephemeral: true
        }));
      }

      activeRestores.add(guildId);

      const originGuild = interaction.client.guilds.cache.get(record.guild_id);
      const originName = originGuild ? originGuild.name : `Origin ID ${record.guild_id}`;
      const isCrossServer = record.guild_id !== interaction.guild.id;

      const userConfig = getUserConfig(userId, backupId);
      const clean = userConfig.has('clean');
      const options = {
        clean,
        roles: userConfig.has('roles'),
        channels: userConfig.has('channels'),
        perms: userConfig.has('perms'),
        emojis: userConfig.has('emojis'),
        settings: userConfig.has('settings'),
        messages: userConfig.has('messages')
      };

      const startTime = Date.now();

      await interaction.editReply(restoreConsoleCard({
        stage: 'running',
        record,
        targetGuildName: interaction.guild.name,
        originGuildName: originName,
        doneSteps: 0,
        totalSteps: 5,
        currentPhaseText: 'Fetching and decompressing snapshot...'
      }));

      try {
        const snapshot = await downloadSnapshot(record.storage_path, false);
        const result = await restoreServerBackup({
          guild: interaction.guild,
          user: interaction.user,
          snapshot,
          clean,
          options,
          preserveChannelId: interaction.channelId,
          onProgress: async (p) => {
            await interaction.editReply(restoreConsoleCard({
              stage: 'running',
              record,
              targetGuildName: interaction.guild.name,
              originGuildName: originName,
              doneSteps: p.doneSteps,
              totalSteps: p.totalSteps,
              currentPhaseText: p.currentPhaseText,
              checklist: p.checklist
            })).catch(() => {});
          }
        });

        const durationSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
        const completedManifest = (result.completedSteps || []).map(s => `• ✅ ${s}`);

        return interaction.editReply(restoreConsoleCard({
          stage: 'complete',
          record,
          targetGuildName: interaction.guild.name,
          originGuildName: originName,
          isCrossServer,
          durationSec,
          completedManifest
        }));
      } catch (err) {
        return interaction.editReply(restoreConsoleCard({
          stage: 'error',
          record,
          targetGuildName: interaction.guild.name,
          originGuildName: originName,
          errorMessage: err.message,
          errorFix: 'Ensure AVA bot role is positioned above roles being created, then retry.',
          checklist: err.checklist || []
        }));
      } finally {
        activeRestores.delete(guildId);
      }
    }
  },

  // 11. Cancel Deployment Execution
  {
    customId: 'bk_cancel_deploy:*:*',
    type: 'button',
    execute: async (interaction, [userId, backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const payload = await renderBackupStructure({ backupId, guild: interaction.guild, user: interaction.user });
      return interaction.editReply(payload);
    }
  },

  // 12. Toggle Lock from Structure Inspector
  {
    customId: 'bk_toggle_lock:*',
    type: 'button',
    execute: async (interaction, [backupId]) => {
      await interaction.deferUpdate().catch(() => {});
      const record = await getBackupById(backupId);
      if (!record) return;
      const newLock = !record.locked;
      await setBackupLock(backupId, newLock);
      const payload = await renderBackupStructure({ backupId, guild: interaction.guild, user: interaction.user });
      return interaction.editReply(payload);
    }
  },

  // 13. Legacy Scope Switch Handler (delegates cleanly to unified list)
  {
    customId: 'bk_scope:*:*',
    type: 'button',
    execute: async (interaction, [targetScope, guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const payload = await renderBackupList({
        guild,
        user: interaction.user,
        page: 1
      });
      return interaction.editReply(payload);
    }
  },

  // 14. Interactive Paginator Handler (Supports First, Prev, Indicator, Next, Last)
  {
    customId: 'bk_page_*:*:*',
    type: 'button',
    execute: async (interaction, [guildId, direction, targetPage]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const pageNum = parseInt(targetPage, 10) || 1;
      const payload = await renderBackupList({
        guild,
        user: interaction.user,
        page: pageNum
      });
      return interaction.editReply(payload);
    }
  },

  // 15. Quick Create Snapshot from Panel with Double-Click Guard
  {
    customId: 'bk_quick_create:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      const targetGuildId = guildId || interaction.guild.id;
      if (activeCreations.has(targetGuildId)) {
        return interaction.reply({
          flags: 64,
          content: '⚠️ Snapshot creation is already in progress for this server. Please wait a moment.'
        });
      }

      await interaction.deferUpdate().catch(() => {});
      activeCreations.add(targetGuildId);

      const guild = interaction.client.guilds.cache.get(targetGuildId) || interaction.guild;
      try {
        const { id } = await createServerBackup({
          guild,
          user: interaction.user,
          name: `${guild.name.slice(0, 20)} Backup`,
          options: { roles: true, channels: true, settings: true, emojis: true, stickers: true, messages: true }
        });
        const payload = await renderBackupStructure({ backupId: id, guild, user: interaction.user });
        return interaction.editReply(payload);
      } catch (err) {
        return interaction.followUp({ flags: 64, content: `Backup creation failed: ${err.message}` });
      } finally {
        activeCreations.delete(targetGuildId);
      }
    }
  },

  // 16. Refresh Panel
  {
    customId: 'bk_refresh:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const payload = await renderBackupList({ guild, user: interaction.user, page: 1 });
      return interaction.editReply(payload);
    }
  },

  // 17. Prompt Channel Selection for Backup Logs
  {
    customId: 'bk_btn_set_channel:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(`bk_sel_log_channel:${guild.id}`)
        .setPlaceholder('📢 Select Backup & Audit Log Channel')
        .setChannelTypes(ChannelType.GuildText);

      const cancelRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`bk_return_to_list:${guild.id}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('⬅️')
      );

      const payload = card({
        title: 'Configure Backup Channel',
        glyph: '📢',
        subtitle: `Set notifications channel for ${guild.name}`,
        body: '> Choose a text channel from the menu below where backup snapshots, restore logs, and safety reports will be sent.',
        subtext: null,
        rows: [new ActionRowBuilder().addComponents(channelSelect), cancelRow]
      });

      return interaction.editReply(payload);
    }
  },

  // 18. Save Selected Backup Log Channel
  {
    customId: 'bk_sel_log_channel:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const channelId = interaction.values[0];
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      await updateGuildSettings(guild.id, { log_channel_id: channelId });
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'log_channel_id', value: channelId }
      });

      const payload = await renderBackupList({ guild, user: interaction.user, page: 1 });
      return interaction.editReply(payload);
    }
  }
];

export default backupComponents;

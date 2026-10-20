import { ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { getBackupById, deleteBackupRecord } from '../../../db/backups.js';
import { deleteSnapshot } from '../../../db/storage.js';
import { db } from '../../../db/client.js';
import { formatBytes } from '../../../utils/time.js';
import { logAudit } from '../../../db/audit.js';

export const backupsTab = {
  id: 'backups',
  label: 'Backups',
  async render({ state }) {
    const { data: allBackups } = await db.from('backups').select('id, size_bytes, guild_id, created_at');
    const totalCount = allBackups?.length || 0;
    const totalBytes = allBackups?.reduce((sum, b) => sum + (Number(b.size_bytes) || 0), 0) || 0;

    const guildCounts = {};
    for (const b of (allBackups || [])) {
      guildCounts[b.guild_id] = (guildCounts[b.guild_id] || 0) + 1;
    }
    const topGuilds = Object.entries(guildCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([gid, count]) => `• Guild \`${gid}\`: ${count} snapshots`);

    const lines = [
      `**Total Stored Backups**: ${totalCount}`,
      `**Total Storage Consumption**: ${formatBytes(totalBytes)}`,
      '',
      '**Top Guilds by Backup Count**:',
      topGuilds.length > 0 ? topGuilds.join('\n') : '_None_'
    ];

    return {
      body: lines.join('\n'),
      subtext: 'Global Backup Management'
    };
  },

  buttons({ state }) {
    return [
      new ButtonBuilder()
        .setCustomId(`owner:backups:lookup_modal:${state.sessionId}`)
        .setLabel('Lookup ID')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`owner:backups:delete_modal:${state.sessionId}`)
        .setLabel('Force Delete')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`owner:backups:refresh:${state.sessionId}`)
        .setLabel('Refresh Stats')
        .setStyle(ButtonStyle.Secondary)
    ];
  },

  async handleAction({ action, interaction, state }) {
    if (action === 'lookup_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:backups:lookup_submit:${state.sessionId}`)
        .setTitle('Lookup Backup Record');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('backup_id').setLabel('Backup ID (e.g. A7K2-9QXM)').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    if (action === 'delete_modal') {
      const modal = new ModalBuilder()
        .setCustomId(`owner:backups:delete_submit:${state.sessionId}`)
        .setTitle('Force Delete Backup');
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('backup_id').setLabel('Backup ID to permanently wipe').setStyle(TextInputStyle.Short).setRequired(true)
        )
      );
      await interaction.showModal(modal);
      return { modalShown: true };
    }

    return { status: 'Backups statistics refreshed' };
  },

  async handleModalSubmit({ action, interaction, state }) {
    const backupId = interaction.fields.getTextInputValue('backup_id')?.trim().toUpperCase();

    if (action === 'lookup_submit') {
      const record = await getBackupById(backupId);
      if (!record) {
        return { status: `Backup ${backupId} not found in database.` };
      }
      return {
        status: `Backup: ${record.name} | Guild: ${record.guild_id} | Size: ${formatBytes(record.size_bytes)} | Locked: ${record.locked}`
      };
    }

    if (action === 'delete_submit') {
      const record = await getBackupById(backupId);
      if (!record) {
        return { status: `Backup ${backupId} not found.` };
      }

      await deleteSnapshot(record.storage_path);
      await deleteBackupRecord(backupId);
      await logAudit({
        userId: interaction.user.id,
        action: 'OWNER_FORCE_DELETE_BACKUP',
        details: { backupId, guildId: record.guild_id, name: record.name }
      });

      return { status: `Permanently deleted backup ${backupId} (${record.name})` };
    }

    return {};
  }
};

export default backupsTab;

import { getGuildSettings, updateGuildSettings, clearGuildSettingsCache } from '../../db/guilds.js';
import { logAudit } from '../../db/audit.js';
import { renderSettingsPanel } from './panel.js';
import { confirmCard } from '../../ui/cards.js';

export const settingsComponents = [
  // 1. Toggle Chatlog Archiving
  {
    customId: 'set_toggle_chatlog:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const settings = await getGuildSettings(guild.id);
      const newEnabled = !settings.chatlog_enabled;
      await updateGuildSettings(guild.id, { chatlog_enabled: newEnabled });
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'chatlog_enabled', value: newEnabled }
      });

      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 2. Toggle Message Sync
  {
    customId: 'set_toggle_sync:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const settings = await getGuildSettings(guild.id);
      const newEnabled = !settings.message_sync_enabled;
      await updateGuildSettings(guild.id, { message_sync_enabled: newEnabled });
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'message_sync_enabled', value: newEnabled }
      });

      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 3. Toggle Prefix Commands
  {
    customId: 'set_toggle_prefix:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const settings = await getGuildSettings(guild.id);
      const newEnabled = !settings.prefix_commands_enabled;
      await updateGuildSettings(guild.id, { prefix_commands_enabled: newEnabled });
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'prefix_commands_enabled', value: newEnabled }
      });

      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 4. Reset Settings Prompt (Confirmation Dialog)
  {
    customId: 'set_btn_reset:*',
    type: 'button',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;

      const promptPayload = confirmCard({
        title: 'Confirm Settings Reset',
        subtitle: `Reset all configurations for "${guild.name}" to defaults?`,
        details: [
          '> ⚠️ **The following changes will occur**:',
          '> • Prefix will reset to default (`a!`)',
          '> • Prefix commands will be re-enabled',
          '> • Chatlog Vault archiving will be disabled',
          '> • Message Sync engine will be disabled',
          '> • Configured log channel & backup role will be cleared',
          '',
          '> Tap **Confirm Reset** to apply defaults, or **Cancel** to keep current settings.'
        ].join('\n'),
        confirmCustomId: `set_confirm_reset:${interaction.user.id}:${guild.id}`,
        cancelCustomId: `set_cancel_reset:${interaction.user.id}:${guild.id}`,
        confirmLabel: 'Confirm Reset',
        cancelLabel: 'Cancel',
        danger: true
      });

      return interaction.editReply(promptPayload);
    }
  },

  // 5. Confirmed Settings Reset Execution
  {
    customId: 'set_confirm_reset:*:*',
    type: 'button',
    execute: async (interaction, [userId, guildId]) => {
      if (interaction.user.id !== userId) {
        return interaction.reply({ flags: 64, content: '⚠️ Only the user who initiated this reset can confirm.' });
      }
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      await updateGuildSettings(guild.id, {
        prefix: 'a!',
        prefix_commands_enabled: true,
        backup_role_id: null,
        log_channel_id: null,
        chatlog_enabled: false,
        message_sync_enabled: false,
        locale: 'en-US'
      });
      clearGuildSettingsCache(guild.id);
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_RESET',
        details: { resetBy: interaction.user.tag }
      });

      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 6. Cancel Settings Reset Handler
  {
    customId: 'set_cancel_reset:*:*',
    type: 'button',
    execute: async (interaction, [userId, guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 7. Select Backup / Audit Log Channel
  {
    customId: 'set_sel_log_channel:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const channelId = interaction.values[0];
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      await updateGuildSettings(guild.id, { log_channel_id: channelId });
      clearGuildSettingsCache(guild.id);
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'log_channel_id', value: channelId }
      });
      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  },

  // 8. Select Backup Manager Role
  {
    customId: 'set_sel_backup_role:*',
    type: 'select',
    execute: async (interaction, [guildId]) => {
      await interaction.deferUpdate().catch(() => {});
      const roleId = interaction.values[0];
      const guild = interaction.client.guilds.cache.get(guildId) || interaction.guild;
      await updateGuildSettings(guild.id, { backup_role_id: roleId });
      clearGuildSettingsCache(guild.id);
      await logAudit({
        guildId: guild.id,
        userId: interaction.user.id,
        action: 'SETTINGS_UPDATE',
        details: { field: 'backup_role_id', value: roleId }
      });
      const payload = await renderSettingsPanel({ guild });
      return interaction.editReply(payload);
    }
  }
];

export default settingsComponents;

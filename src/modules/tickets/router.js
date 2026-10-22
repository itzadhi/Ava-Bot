import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import { errorCard, successCard, infoCard } from '../../ui/cards.js';
import { container } from '../../utils/ui/components.js';
import {
  getTicketById,
  getTicketByChannel,
  recoverTicketFromChannel,
  updateTicket,
  getTicketSettings,
  updateTicketSettings,
  getTicketCategories,
  getTicketCategory,
  saveTicketCategory,
  getTicketPanels,
  getTicketPanel,
  saveTicketPanel,
  deleteTicketPanel
} from '../../db/tickets.js';
import { handleOpenTicketFlow, buildOpenTicketReasonModal } from './create.js';
import {
  isTicketStaff,
  handleClaimToggle,
  handleCloseTicket,
  handleCloseRequest,
  handleLockToggle,
  handleChangePriority,
  handleModifyUserAccess,
  handleAddStaffNote
} from './actions.js';
import { generateAndSaveTranscript } from './transcript.js';
import { buildRatingFeedbackModal, handleRatingSubmission } from './ratings.js';
import { renderTicketSettingsDashboard } from './settings.js';
import {
  renderPanelManagerDashboard,
  buildPublishedPanelCard,
  renderPanelImageConfigCard,
  pendingPanelUploads
} from './panel.js';
import { logger } from '../../utils/logger.js';

/**
 * Central Interaction Router for all Ticket System components (tkt:*)
 */
export async function handleTicketInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId || !customId.startsWith('tkt:')) return false;

  const parts = customId.split(':');
  // Format: tkt:<subsystem>:<action>:<arg1>:<arg2>...
  const [, subsystem, action, arg1, arg2, arg3] = parts;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. PUBLIC PANEL INTERACTIONS (Opening Tickets)
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'panel') {
      if (action === 'open') {
        const panelId = arg1;
        const categoryId = arg2;
        const modal = await buildOpenTicketReasonModal(categoryId, panelId);
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'sel') {
        const panelId = arg1;
        const categoryId = interaction.values?.[0] || 'default';

        // Asynchronously reset panel dropdown menu state on client
        if (interaction.message?.editable) {
          Promise.resolve().then(async () => {
            try {
              const [panel, categories] = await Promise.all([
                getTicketPanel(panelId),
                getTicketCategories(interaction.guildId)
              ]);
              if (panel) {
                const refreshed = await buildPublishedPanelCard({ panel, categories });
                await interaction.message.edit(refreshed).catch(() => {});
              }
            } catch (_) {}
          });
        }

        const modal = await buildOpenTicketReasonModal(categoryId, panelId);
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'single') {
        const panelId = arg1;
        const categories = await getTicketCategories(interaction.guildId);
        const targetCategory = categories.find(c => c.is_enabled !== false) || null;
        const modal = await buildOpenTicketReasonModal(targetCategory?.id || 'default', panelId);
        await interaction.showModal(modal);
        return true;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. MODAL SUBMISSION FOR OPENING TICKET (Reason & Custom Questions)
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'modal_open') {
      const categoryId = action; // in tkt:modal_open:<categoryId>:<panelId>
      const panelId = arg1 || '0';

      const questionAnswers = {};
      let reason = '';

      if (interaction.isModalSubmit()) {
        try {
          reason = interaction.fields.getTextInputValue('ticket_reason') || interaction.fields.getTextInputValue('reason') || '';
        } catch (_) {}

        for (let i = 0; i < 5; i++) {
          try {
            const val = interaction.fields.getTextInputValue(`q_${i}`);
            if (val) {
              const label = interaction.components[i]?.components?.[0]?.data?.label || `Question ${i + 1}`;
              questionAnswers[label] = val;
            }
          } catch (_) {}
        }
      }

      if (reason) {
        questionAnswers['Reason'] = reason;
      }

      await handleOpenTicketFlow({ interaction, categoryId, panelId, questionAnswers, reason });
      return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. IN-TICKET CONTROLS (Buttons & Tools Dropdown)
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'ctl') {
      let ticketId = arg1;
      let ticket = await getTicketById(ticketId, interaction.guildId, interaction.channelId);
      if (!ticket && interaction.guildId && interaction.channelId) {
        ticket = await getTicketByChannel(interaction.guildId, interaction.channelId);
      }
      if ((!ticket || ticket.id?.startsWith('temp_')) && interaction.channel) {
        ticket = await recoverTicketFromChannel(interaction.channel);
      }
      if (ticket) {
        ticketId = ticket.id;
      }

      // Claim / Unclaim
      if (action === 'claim') {
        await handleClaimToggle(interaction, ticketId);
        return true;
      }

      // Close Button clicked -> Show Modal for Reason
      if (action === 'close') {
        const modal = new ModalBuilder()
          .setCustomId(`tkt:ctl:close_modal:${ticketId}`)
          .setTitle('Close Ticket');

        const reasonInput = new TextInputBuilder()
          .setCustomId('close_reason')
          .setLabel('Reason for Closing (Optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter why this ticket is being closed...')
          .setRequired(false)
          .setMaxLength(500);

        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        await interaction.showModal(modal);
        return true;
      }

      // Close Modal Submit
      if (action === 'close_modal') {
        const reason = interaction.fields.getTextInputValue('close_reason')?.trim() || null;
        await handleCloseTicket(interaction, ticketId, reason);
        return true;
      }

      // Close Request
      if (action === 'close_req') {
        await handleCloseRequest(interaction, ticketId);
        return true;
      }

      // Confirm Close Request
      if (action === 'close_req_yes') {
        await handleCloseTicket(interaction, ticketId, 'Confirmed by owner from close request');
        return true;
      }

      // Decline Close Request
      if (action === 'close_req_no') {
        await interaction.reply(container({
          title: 'Ticket Maintained',
          lines: [`❌ <@${interaction.user.id}> opted to keep this ticket open.`],
          ephemeral: true
        }));
        return true;
      }

      // Priority Button clicked -> Show priority selection
      if (action === 'priority') {
        const select = new StringSelectMenuBuilder()
          .setCustomId(`tkt:ctl:prio_sel:${ticketId}`)
          .setPlaceholder('Set ticket priority...')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('Low').setValue('low').setEmoji('⚪'),
            new StringSelectMenuOptionBuilder().setLabel('Normal').setValue('normal').setEmoji('🟢'),
            new StringSelectMenuOptionBuilder().setLabel('High').setValue('high').setEmoji('🟠'),
            new StringSelectMenuOptionBuilder().setLabel('Urgent').setValue('urgent').setEmoji('🔴')
          );
        await interaction.reply(container({
          title: 'Set Ticket Priority',
          lines: ['Select a priority level for this ticket below:'],
          rows: [new ActionRowBuilder().addComponents(select)],
          ephemeral: true
        }));
        return true;
      }

      // Priority Select Menu Submit
      if (action === 'prio_sel') {
        const newPrio = interaction.values?.[0] || 'normal';
        await handleChangePriority(interaction, ticketId, newPrio);
        return true;
      }

      // Tools Select Menu Option
      if (action === 'tools_sel') {
        const selected = interaction.values?.[0];

        if (selected === 'lock_toggle') {
          await handleLockToggle(interaction, ticketId);
          return true;
        }

        if (selected === 'add_user' || selected === 'remove_user') {
          const userSelect = new UserSelectMenuBuilder()
            .setCustomId(`tkt:ctl:${selected}_sel:${ticketId}`)
            .setPlaceholder(`Select user to ${selected === 'add_user' ? 'add' : 'remove'}...`);
          await interaction.reply(container({
            title: selected === 'add_user' ? 'Add User to Ticket' : 'Remove User from Ticket',
            lines: [`Choose a member to **${selected === 'add_user' ? 'add to' : 'remove from'}** this ticket:`],
            rows: [new ActionRowBuilder().addComponents(userSelect)],
            ephemeral: true
          }));
          return true;
        }

        if (selected === 'add_role' || selected === 'remove_role') {
          const roleSelect = new RoleSelectMenuBuilder()
            .setCustomId(`tkt:ctl:${selected}_sel:${ticketId}`)
            .setPlaceholder(`Select role to ${selected === 'add_role' ? 'add' : 'remove'}...`);
          await interaction.reply(container({
            title: selected === 'add_role' ? 'Add Role to Ticket' : 'Remove Role from Ticket',
            lines: [`Choose a role to **${selected === 'add_role' ? 'grant access' : 'revoke access'}**:`],
            rows: [new ActionRowBuilder().addComponents(roleSelect)],
            ephemeral: true
          }));
          return true;
        }

        if (selected === 'transfer') {
          const staffSelect = new UserSelectMenuBuilder()
            .setCustomId(`tkt:ctl:transfer_sel:${ticketId}`)
            .setPlaceholder('Select staff member to transfer claim to...');
          await interaction.reply(container({
            title: 'Transfer Ticket Claim',
            lines: ['Select the staff member to transfer this ticket to:'],
            rows: [new ActionRowBuilder().addComponents(staffSelect)],
            ephemeral: true
          }));
          return true;
        }

        if (selected === 'rename') {
          const modal = new ModalBuilder()
            .setCustomId(`tkt:ctl:rename_mod:${ticketId}`)
            .setTitle('Rename Ticket Channel');
          const nameInput = new TextInputBuilder()
            .setCustomId('new_name')
            .setLabel('New Channel Name')
            .setStyle(TextInputStyle.Short)
            .setValue(interaction.channel?.name || 'ticket')
            .setRequired(true)
            .setMaxLength(95);
          modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
          await interaction.showModal(modal);
          return true;
        }

        if (selected === 'note') {
          const modal = new ModalBuilder()
            .setCustomId(`tkt:ctl:note_mod:${ticketId}`)
            .setTitle('Add Staff Note');
          const noteInput = new TextInputBuilder()
            .setCustomId('note_text')
            .setLabel('Internal Note (Visible to staff only)')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000);
          modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
          await interaction.showModal(modal);
          return true;
        }

        if (selected === 'transcript') {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const channel = interaction.channel;
          const trn = await generateAndSaveTranscript(channel, ticket);
          await interaction.editReply(container({
            title: 'Transcript Generated',
            lines: [
              `📄 **Transcript Generated:** \`${trn.messageCount}\` messages saved.`,
              ...(trn.url ? [`[Click here to view online](${trn.url})`] : ['Archived in database records.'])
            ],
            ephemeral: true
          }));
          return true;
        }

        if (selected === 'reopen') {
          await updateTicket(ticketId, { status: 'open', closed_by: null, closed_at: null });
          await interaction.reply(successCard({
            title: 'Ticket Reopened',
            subtitle: `🔓 **Ticket #${ticket.ticket_number}** has been reopened.`
          }));
          return true;
        }
      }

      // Add / Remove User selection submit
      if (action === 'add_user_sel' || action === 'remove_user_sel') {
        const targetUserId = interaction.values?.[0];
        await handleModifyUserAccess(interaction, ticketId, targetUserId, action === 'add_user_sel');
        return true;
      }

      // Add / Remove Role selection submit
      if (action === 'add_role_sel' || action === 'remove_role_sel') {
        const roleId = interaction.values?.[0];
        const channel = interaction.channel;
        if (action === 'add_role_sel') {
          await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
          await interaction.reply(successCard({
            title: 'Role Access Granted',
            subtitle: `🛡️ Granted <@&${roleId}> access to this ticket.`
          }));
        } else {
          await channel.permissionOverwrites.delete(roleId).catch(() => {});
          await interaction.reply(successCard({
            title: 'Role Access Revoked',
            subtitle: `🚫 Revoked <@&${roleId}> access from this ticket.`
          }));
        }
        return true;
      }

      // Transfer Claim
      if (action === 'transfer_sel') {
        const targetUserId = interaction.values?.[0];
        await updateTicket(ticketId, { claimed_by: targetUserId, status: 'claimed' });
        await refreshTicketControlCard(interaction.channel, ticketId);
        await interaction.reply(successCard({
          title: 'Claim Transferred',
          subtitle: `👑 Ticket claim transferred to <@${targetUserId}>.`
        }));
        return true;
      }

      // Rename Modal submit
      if (action === 'rename_mod') {
        const newName = interaction.fields.getTextInputValue('new_name')?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'ticket';
        await interaction.channel.setName(newName).catch(() => {});
        await interaction.reply(successCard({
          title: 'Ticket Renamed',
          subtitle: `✏️ Renamed ticket channel to **${newName}**.`
        }));
        return true;
      }

      // Note Modal submit
      if (action === 'note_mod') {
        const noteText = interaction.fields.getTextInputValue('note_text')?.trim();
        await handleAddStaffNote(interaction, ticketId, noteText);
        return true;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. STAR RATINGS & REVIEWS
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'rate') {
      const guildId = action; // tkt:rate:<guildId>:<ticketId>:<stars>
      const ticketId = arg1;
      const stars = arg2;

      const modal = buildRatingFeedbackModal(guildId, ticketId, stars);
      await interaction.showModal(modal);
      return true;
    }

    if (subsystem === 'rate_modal') {
      const guildId = action; // tkt:rate_modal:<guildId>:<ticketId>:<stars>
      const ticketId = arg1;
      const stars = arg2;

      const review = interaction.fields.getTextInputValue('review_text')?.trim() || null;
      const guild = interaction.client.guilds.cache.get(guildId);
      const ticket = await getTicketById(ticketId);

      if (guild && ticket) {
        const res = await handleRatingSubmission({
          guild,
          user: interaction.user,
          ticket,
          stars,
          feedback: review
        });
        await interaction.reply(res);
        return true;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. SETTINGS DASHBOARD (tkt:cfg:*)
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'cfg') {
      if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(errorCard({
          title: 'Permission Denied',
          reason: 'Manage Server permission is required.',
          ephemeral: true
        }));
      }

      const guild = interaction.guild;

      if (action === 'tab_sel') {
        await interaction.deferUpdate().catch(() => {});
        const activeTab = interaction.values?.[0] || 'general';
        const payload = await renderTicketSettingsDashboard({ guild, activeTab });
        return interaction.editReply(payload);
      }

      if (action === 'toggle_enabled') {
        await interaction.deferUpdate().catch(() => {});
        const s = await getTicketSettings(guild.id);
        const updated = await updateTicketSettings(guild.id, { enabled: !s.enabled });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'general',
          note: updated.enabled ? 'Ticket system is now enabled.' : 'Ticket system is now disabled.'
        });
        return interaction.editReply(payload);
      }

      if (action === 'support_roles_sel') {
        await interaction.deferUpdate().catch(() => {});
        const selectedRoles = interaction.values || [];
        await updateTicketSettings(guild.id, { support_role_ids: selectedRoles });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'staff',
          note: `Support roles updated (${selectedRoles.length} assigned).`
        });
        return interaction.editReply(payload);
      }

      if (action === 'log_chan_sel') {
        await interaction.deferUpdate().catch(() => {});
        const channelId = interaction.values?.[0];
        await updateTicketSettings(guild.id, { log_channel_id: channelId });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'channels',
          note: `Ticket audit logs will be sent to <#${channelId}>.`
        });
        return interaction.editReply(payload);
      }

      if (action === 'trn_chan_sel') {
        await interaction.deferUpdate().catch(() => {});
        const channelId = interaction.values?.[0];
        await updateTicketSettings(guild.id, { transcript_channel_id: channelId });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'channels',
          note: `Transcripts will be saved to <#${channelId}>.`
        });
        return interaction.editReply(payload);
      }

      if (action === 'toggle_autoclose') {
        await interaction.deferUpdate().catch(() => {});
        const s = await getTicketSettings(guild.id);
        const sequence = [0, 24, 48, 72];
        const currentIdx = sequence.indexOf(s.autoclose_hours || 0);
        const nextHours = sequence[(currentIdx + 1) % sequence.length];
        await updateTicketSettings(guild.id, {
          autoclose_hours: nextHours,
          autoclose_warning_hours: nextHours > 0 ? 6 : 0
        });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'autoclose',
          note: nextHours > 0 ? `Auto-close set to ${nextHours}h with 6h warning.` : 'Auto-close disabled.'
        });
        return interaction.editReply(payload);
      }

      if (action === 'toggle_ratings') {
        await interaction.deferUpdate().catch(() => {});
        const s = await getTicketSettings(guild.id);
        const updated = await updateTicketSettings(guild.id, { rating_enabled: !s.rating_enabled });
        const payload = await renderTicketSettingsDashboard({
          guild,
          activeTab: 'ratings',
          note: updated.rating_enabled ? 'Post-close rating prompts enabled.' : 'Ratings disabled.'
        });
        return interaction.editReply(payload);
      }

      if (action === 'close_dashboard') {
        await interaction.deferUpdate().catch(() => {});
        return interaction.deleteReply().catch(() => {});
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. PANEL MANAGER (tkt:mgr:*)
    // ─────────────────────────────────────────────────────────────────────────
    if (subsystem === 'mgr') {
      if (!interaction.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(errorCard({
          title: 'Permission Denied',
          reason: 'Manage Server permission is required.',
          ephemeral: true
        }));
      }

      const guild = interaction.guild;

      if (action === 'panel_sel') {
        await interaction.deferUpdate().catch(() => {});
        const selectedPanelId = interaction.values?.[0];
        const payload = await renderPanelManagerDashboard(guild, selectedPanelId);
        return interaction.editReply(payload);
      }

      if (action === 'cat_sel') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (panel) {
          const selectedCategories = interaction.values || [];
          const updated = await saveTicketPanel({ ...panel, category_ids: selectedCategories });
          if (panel.channel_id && panel.message_id) {
            try {
              const targetChan = guild.channels.cache.get(panel.channel_id);
              const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
              if (msg) {
                const categories = await getTicketCategories(guild.id);
                const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
                await msg.edit(updatedCard).catch(() => {});
              }
            } catch (_) {}
          }
        }
        const payload = await renderPanelManagerDashboard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'deploy_chan') {
        const panelId = arg1;
        const targetChannelId = interaction.values?.[0];
        const targetChannel = guild.channels.cache.get(targetChannelId);

        if (!targetChannel || !targetChannel.isTextBased()) {
          return interaction.reply(errorCard({
            title: 'Invalid Channel',
            reason: 'The selected channel is invalid or not a text channel.',
            ephemeral: true
          }));
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const [panel, categories] = await Promise.all([
          getTicketPanel(panelId),
          getTicketCategories(guild.id)
        ]);

        const publishedCard = await buildPublishedPanelCard({ panel, categories });
        const sentMessage = await targetChannel.send(publishedCard);

        await saveTicketPanel({
          ...panel,
          channel_id: targetChannel.id,
          message_id: sentMessage.id
        });

        return interaction.editReply(successCard({
          title: 'Ticket Panel Published',
          subtitle: `Successfully published ticket panel to <#${targetChannel.id}>.`
        }));
      }

      if (action === 'create_btn') {
        const modal = new ModalBuilder()
          .setCustomId('tkt:mgr:create_modal')
          .setTitle('Create Ticket Panel');

        const titleInput = new TextInputBuilder()
          .setCustomId('panel_title')
          .setLabel('Panel Title')
          .setStyle(TextInputStyle.Short)
          .setValue('Support Tickets')
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('panel_desc')
          .setLabel('Panel Description')
          .setStyle(TextInputStyle.Paragraph)
          .setValue('Need help? Open a ticket below to speak with staff.')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput)
        );
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'create_modal') {
        await interaction.deferUpdate().catch(() => {});
        const title = interaction.fields.getTextInputValue('panel_title')?.trim() || 'Support Tickets';
        const description = interaction.fields.getTextInputValue('panel_desc')?.trim() || '';

        const newPanel = await saveTicketPanel({
          guild_id: guild.id,
          channel_id: '',
          title,
          description,
          style: 'select'
        });

        const payload = await renderPanelManagerDashboard(guild, newPanel.id);
        return interaction.editReply(payload);
      }

      if (action === 'edit_btn') {
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (!panel) return true;

        const modal = new ModalBuilder()
          .setCustomId(`tkt:mgr:edit_modal:${panel.id}`)
          .setTitle('Edit Panel Content');

        const titleInput = new TextInputBuilder()
          .setCustomId('panel_title')
          .setLabel('Panel Title')
          .setStyle(TextInputStyle.Short)
          .setValue(panel.title || 'Support Tickets')
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('panel_desc')
          .setLabel('Panel Description')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(panel.description || '')
          .setRequired(false);

        const emojiInput = new TextInputBuilder()
          .setCustomId('panel_emoji')
          .setLabel('Panel / Button Emoji')
          .setStyle(TextInputStyle.Short)
          .setValue(panel.button_emoji || '🎫')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(emojiInput)
        );
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'edit_modal') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (panel) {
          const title = interaction.fields.getTextInputValue('panel_title')?.trim() || panel.title;
          const description = interaction.fields.getTextInputValue('panel_desc')?.trim() || '';
          const emoji = interaction.fields.getTextInputValue('panel_emoji')?.trim() || '🎫';

          const updated = await saveTicketPanel({
            ...panel,
            title,
            description,
            button_emoji: emoji
          });

          if (panel.channel_id && panel.message_id) {
            try {
              const targetChan = guild.channels.cache.get(panel.channel_id);
              const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
              if (msg) {
                const categories = await getTicketCategories(guild.id);
                const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
                await msg.edit(updatedCard).catch(() => {});
              }
            } catch (_) {}
          }
        }
        const payload = await renderPanelManagerDashboard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'img_btn') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const payload = await renderPanelImageConfigCard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'arm_drop') {
        const panelId = arg1;
        const imgType = arg2; // 'banner' or 'thumbnail'
        pendingPanelUploads.set(interaction.user.id, {
          panelId,
          type: imgType,
          channelId: interaction.channelId,
          expiresAt: Date.now() + 60000
        });

        const typeLabel = imgType === 'banner' ? 'Banner' : 'Thumbnail';
        return interaction.reply({
          ...infoCard({
            title: `Upload ${typeLabel} (Drag & Drop)`,
            subtitle: `**Drag and drop or upload your image file directly into this channel now.**\n` +
                      `• Target: **${imgType === 'banner' ? 'Top Media Banner' : 'Header Thumbnail Icon'}**\n` +
                      `• Formats: PNG, JPG, GIF, WebP\n` +
                      `• Waiting for your upload (60s timer)...`
          }),
          ephemeral: true
        });
      }

      if (action === 'img_modal_open') {
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (!panel) return true;

        const modal = new ModalBuilder()
          .setCustomId(`tkt:mgr:img_modal:${panel.id}`)
          .setTitle('Set Panel Banner & Thumbnail URLs');

        const bannerInput = new TextInputBuilder()
          .setCustomId('panel_banner')
          .setLabel('Banner Image URL (Top Media Banner)')
          .setPlaceholder('https://example.com/banner.png')
          .setStyle(TextInputStyle.Short)
          .setValue(panel.banner_url || '')
          .setRequired(false);

        const thumbInput = new TextInputBuilder()
          .setCustomId('panel_thumb')
          .setLabel('Thumbnail Image URL (Header Icon)')
          .setPlaceholder('https://example.com/thumbnail.png')
          .setStyle(TextInputStyle.Short)
          .setValue(panel.thumbnail_url || '')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(bannerInput),
          new ActionRowBuilder().addComponents(thumbInput)
        );
        await interaction.showModal(modal);
        return true;
      }

      if (action === 'img_modal') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (panel) {
          const banner = interaction.fields.getTextInputValue('panel_banner')?.trim() || null;
          const thumb = interaction.fields.getTextInputValue('panel_thumb')?.trim() || null;

          const updated = await saveTicketPanel({
            ...panel,
            banner_url: banner,
            thumbnail_url: thumb
          });

          if (panel.channel_id && panel.message_id) {
            try {
              const targetChan = guild.channels.cache.get(panel.channel_id);
              const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
              if (msg) {
                const categories = await getTicketCategories(guild.id);
                const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
                await msg.edit(updatedCard).catch(() => {});
              }
            } catch (_) {}
          }
        }
        const payload = await renderPanelImageConfigCard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'clear_images') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (panel) {
          const updated = await saveTicketPanel({
            ...panel,
            banner_url: null,
            thumbnail_url: null
          });

          if (panel.channel_id && panel.message_id) {
            try {
              const targetChan = guild.channels.cache.get(panel.channel_id);
              const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
              if (msg) {
                const categories = await getTicketCategories(guild.id);
                const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
                await msg.edit(updatedCard).catch(() => {});
              }
            } catch (_) {}
          }
        }
        const payload = await renderPanelImageConfigCard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'back_dash') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const payload = await renderPanelManagerDashboard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'style_btn') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        const panel = await getTicketPanel(panelId);
        if (panel) {
          const newStyle = panel.style === 'buttons' ? 'select' : 'buttons';
          const updated = await saveTicketPanel({ ...panel, style: newStyle });

          if (panel.channel_id && panel.message_id) {
            try {
              const targetChan = guild.channels.cache.get(panel.channel_id);
              const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
              if (msg) {
                const categories = await getTicketCategories(guild.id);
                const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
                await msg.edit(updatedCard).catch(() => {});
              }
            } catch (_) {}
          }
        }
        const payload = await renderPanelManagerDashboard(guild, panelId);
        return interaction.editReply(payload);
      }

      if (action === 'del_btn') {
        await interaction.deferUpdate().catch(() => {});
        const panelId = arg1;
        await deleteTicketPanel(panelId);
        const payload = await renderPanelManagerDashboard(guild);
        return interaction.editReply(payload);
      }
    }

    return false;
  } catch (err) {
    logger.error({ err, customId }, 'Error handling ticket interaction');
    return false;
  }
}

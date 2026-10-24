import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import { ticketDb } from '../../db/tickets.js';
import { theme } from '../../config/theme.js';
import * as format from '../../utils/ui/format.js';
import { successCard, errorCard } from '../../ui/cards.js';
import { renderTicketSettingsDashboard } from '../../modules/tickets/settings.js';
import { renderPanelManagerDashboard, buildPublishedPanelCard } from '../../modules/tickets/panel.js';
import { checkStaffAccess } from '../../modules/tickets/categories.js';
import {
  handleClaimToggle,
  handleCloseTicket,
  handleLockToggle,
  handleChangePriority,
  handleModifyUserAccess,
  handleAddStaffNote
} from '../../modules/tickets/actions.js';
import { buildTicketControlCard, refreshTicketControlCard } from '../../modules/tickets/controls.js';
import { sendTicketLog } from '../../modules/tickets/logs.js';
import { perm } from '../../core/permissions/permApply.js';

export default {
  name: 'ticket',
  aliases: ['tickets', 'tkt'],
  description: 'Complete production-grade ticket support & management system',
  category: 'tickets',
  cooldown: 2,
  subcommands: [
    {
      name: 'panel',
      description: 'Open ticket panel manager or configure panel banner and thumbnail',
      args: [
        { name: 'banner', description: 'Drag & drop image file or enter URL for banner', type: 'attachment', required: false },
        { name: 'thumbnail', description: 'Drag & drop image file or enter URL for thumbnail', type: 'attachment', required: false },
        { name: 'banner_url', description: 'Direct image URL for panel top banner', type: 'string', required: false },
        { name: 'thumbnail_url', description: 'Direct image URL for panel thumbnail', type: 'string', required: false }
      ]
    },
    {
      name: 'banner',
      description: 'Set the banner image for the current ticket or active panel (drag & drop or URL)',
      args: [
        { name: 'image', description: 'Drag and drop image file for banner', type: 'attachment', required: false },
        { name: 'url', description: 'Direct image URL for banner', type: 'string', required: false }
      ]
    },
    {
      name: 'thumbnail',
      description: 'Set the thumbnail image for the current ticket or active panel (drag & drop or URL)',
      args: [
        { name: 'image', description: 'Drag and drop image file for thumbnail', type: 'attachment', required: false },
        { name: 'url', description: 'Direct image URL for thumbnail', type: 'string', required: false }
      ]
    },
    {
      name: 'settings',
      description: 'Open the interactive ticket configuration dashboard',
      args: []
    },
    {
      name: 'stats',
      description: 'Display server ticket analytics, resolution metrics and staff leaderboard',
      args: []
    },
    {
      name: 'list',
      description: 'List active open tickets across the server',
      args: [
        { name: 'status', description: 'Filter by status (open, closed, claimed)', type: 'string', required: false }
      ]
    },
    {
      name: 'info',
      description: 'Show detailed information and metadata for the current ticket channel',
      args: []
    },
    {
      name: 'claim',
      description: 'Claim the current ticket to indicate you are handling it',
      args: []
    },
    {
      name: 'unclaim',
      description: 'Release your claim on the current ticket',
      args: []
    },
    {
      name: 'close',
      description: 'Close the current ticket channel with an optional reason',
      args: [
        { name: 'reason', description: 'Reason for closing this ticket', type: 'string', required: false }
      ]
    },
    {
      name: 'reopen',
      description: 'Reopen a closed ticket before deletion',
      args: []
    },
    {
      name: 'add',
      description: 'Add a user or role to the current ticket channel',
      args: [
        { name: 'user', description: 'User to grant access to', type: 'user', required: false },
        { name: 'role', description: 'Role to grant access to', type: 'role', required: false }
      ]
    },
    {
      name: 'remove',
      description: 'Remove a user or role from the current ticket channel',
      args: [
        { name: 'user', description: 'User to revoke access from', type: 'user', required: false },
        { name: 'role', description: 'Role to revoke access from', type: 'role', required: false }
      ]
    },
    {
      name: 'rename',
      description: 'Rename the current ticket channel',
      args: [
        { name: 'name', description: 'New channel name', type: 'string', required: true }
      ]
    },
    {
      name: 'priority',
      description: 'Change the priority level of the current ticket',
      args: [
        { name: 'level', description: 'Priority level (low, normal, high, urgent)', type: 'string', required: true }
      ]
    },
    {
      name: 'note',
      description: 'Add an internal staff note to this ticket (saved in database)',
      args: [
        { name: 'content', description: 'Note content', type: 'string', required: true }
      ]
    },
    {
      name: 'blacklist',
      description: 'Add, remove or list blacklisted users/roles for tickets',
      args: [
        { name: 'action', description: 'Action: add, remove, or list', type: 'string', required: true },
        { name: 'target', description: 'User or Role ID/mention to target', type: 'string', required: false },
        { name: 'reason', description: 'Reason for blacklisting', type: 'string', required: false }
      ]
    },
    {
      name: 'macro',
      description: 'Use, list, create or delete canned macro responses',
      args: [
        { name: 'action', description: 'Action: use, list, add, or delete', type: 'string', required: true },
        { name: 'name', description: 'Macro trigger name', type: 'string', required: false },
        { name: 'text', description: 'Macro content (for add)', type: 'string', required: false }
      ]
    },
    {
      name: 'reviews',
      description: 'View customer satisfaction ratings and reviews leaderboard',
      args: []
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'Ticket commands can only be executed inside a Discord server.',
        ephemeral: true
      }));
    }

    const sub = (ctx.args.subcommand || '').toLowerCase();

    // 1. Panel Manager Dashboard & Image Config
    if (sub === 'panel') {
      const hasPerm = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || ctx.guild.ownerId === ctx.user.id;
      if (!hasPerm) {
        return ctx.reply(errorCard({
          title: 'Permission Denied',
          reason: 'You need the `Manage Server` permission to configure ticket panels.',
          ephemeral: true
        }));
      }

      const bannerArg = (typeof ctx.args.banner === 'object' ? ctx.args.banner?.url : ctx.args.banner) || ctx.args.banner_url || null;
      const thumbArg = (typeof ctx.args.thumbnail === 'object' ? ctx.args.thumbnail?.url : ctx.args.thumbnail) || ctx.args.thumbnail_url || null;

      if (bannerArg || thumbArg) {
        const panels = await ticketDb.getPanels(ctx.guild.id);
        const targetPanel = panels[0] || await ticketDb.savePanel({
          guild_id: ctx.guild.id,
          title: 'Support Tickets',
          description: 'Need help? Select an option below to open a ticket.',
          style: 'select'
        });

        const updated = await ticketDb.savePanel({
          ...targetPanel,
          ...(bannerArg ? { banner_url: bannerArg } : {}),
          ...(thumbArg ? { thumbnail_url: thumbArg } : {})
        });

        if (targetPanel.channel_id && targetPanel.message_id) {
          try {
            const chan = ctx.guild.channels.cache.get(targetPanel.channel_id);
            const msg = await chan?.messages.fetch(targetPanel.message_id).catch(() => null);
            if (msg) {
              const categories = await ticketDb.getCategories(ctx.guild.id);
              const refreshed = await buildPublishedPanelCard({ panel: updated, categories });
              await msg.edit(refreshed).catch(() => {});
            }
          } catch (_) {}
        }

        const lines = [];
        if (bannerArg) lines.push(`• **Banner:** [Preview Link](${bannerArg})`);
        if (thumbArg) lines.push(`• **Thumbnail:** [Preview Link](${thumbArg})`);

        return ctx.reply(successCard({
          title: 'Panel Images Configured',
          subtitle: `Updated image configuration for **${format.escapeMarkdown(updated.title)}**.`,
          body: lines.join('\n'),
          ephemeral: true
        }));
      }

      const panelPayload = await renderPanelManagerDashboard(ctx.guild);
      return ctx.reply(panelPayload);
    }

    // Set Banner (Inside ticket channel or server panel)
    if (sub === 'banner') {
      const url = (typeof ctx.args.image === 'object' ? ctx.args.image?.url : ctx.args.image) || ctx.args.url?.trim() || null;
      if (!url || !url.startsWith('http')) {
        return ctx.reply(errorCard({
          title: 'Invalid Image',
          reason: 'Please drag & drop an image file or provide a valid direct image URL.',
          ephemeral: true
        }));
      }

      const currentTicket = await ticketDb.getTicketByChannel(ctx.guild.id, ctx.channel.id);
      if (currentTicket) {
        await ticketDb.updateTicket(currentTicket.id, { banner_url: url });
        await refreshTicketControlCard(ctx.channel, currentTicket.id);
        return ctx.reply(successCard({
          title: 'Ticket Banner Set',
          subtitle: `Updated top banner for **Ticket #${currentTicket.ticket_number}**.\n[View Image](${url})`,
          ephemeral: false
        }));
      }

      const hasPerm = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || ctx.guild.ownerId === ctx.user.id;
      if (!hasPerm) {
        return ctx.reply(errorCard({
          title: 'Permission Denied',
          reason: 'You need the `Manage Server` permission to configure panel images.',
          ephemeral: true
        }));
      }

      const panels = await ticketDb.getPanels(ctx.guild.id);
      const targetPanel = panels[0] || await ticketDb.savePanel({
        guild_id: ctx.guild.id,
        title: 'Support Tickets',
        description: 'Need help? Select an option below to open a ticket.',
        style: 'select'
      });

      const updated = await ticketDb.savePanel({ ...targetPanel, banner_url: url });
      if (targetPanel.channel_id && targetPanel.message_id) {
        try {
          const chan = ctx.guild.channels.cache.get(targetPanel.channel_id);
          const msg = await chan?.messages.fetch(targetPanel.message_id).catch(() => null);
          if (msg) {
            const categories = await ticketDb.getCategories(ctx.guild.id);
            const refreshed = await buildPublishedPanelCard({ panel: updated, categories });
            await msg.edit(refreshed).catch(() => {});
          }
        } catch (_) {}
      }

      return ctx.reply(successCard({
        title: 'Panel Banner Set',
        subtitle: `Updated banner for panel **${format.escapeMarkdown(updated.title)}**.\n[View Image](${url})`,
        ephemeral: true
      }));
    }

    // Set Thumbnail (Inside ticket channel or server panel)
    if (sub === 'thumbnail') {
      const url = (typeof ctx.args.image === 'object' ? ctx.args.image?.url : ctx.args.image) || ctx.args.url?.trim() || null;
      if (!url || !url.startsWith('http')) {
        return ctx.reply(errorCard({
          title: 'Invalid Image',
          reason: 'Please drag & drop an image file or provide a valid direct image URL.',
          ephemeral: true
        }));
      }

      const currentTicket = await ticketDb.getTicketByChannel(ctx.guild.id, ctx.channel.id);
      if (currentTicket) {
        await ticketDb.updateTicket(currentTicket.id, { thumbnail_url: url });
        await refreshTicketControlCard(ctx.channel, currentTicket.id);
        return ctx.reply(successCard({
          title: 'Ticket Thumbnail Set',
          subtitle: `Updated thumbnail icon for **Ticket #${currentTicket.ticket_number}**.\n[View Image](${url})`,
          ephemeral: false
        }));
      }

      const hasPerm = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || ctx.guild.ownerId === ctx.user.id;
      if (!hasPerm) {
        return ctx.reply(errorCard({
          title: 'Permission Denied',
          reason: 'You need the `Manage Server` permission to configure panel images.',
          ephemeral: true
        }));
      }

      const panels = await ticketDb.getPanels(ctx.guild.id);
      const targetPanel = panels[0] || await ticketDb.savePanel({
        guild_id: ctx.guild.id,
        title: 'Support Tickets',
        description: 'Need help? Select an option below to open a ticket.',
        style: 'select'
      });

      const updated = await ticketDb.savePanel({ ...targetPanel, thumbnail_url: url });
      if (targetPanel.channel_id && targetPanel.message_id) {
        try {
          const chan = ctx.guild.channels.cache.get(targetPanel.channel_id);
          const msg = await chan?.messages.fetch(targetPanel.message_id).catch(() => null);
          if (msg) {
            const categories = await ticketDb.getCategories(ctx.guild.id);
            const refreshed = await buildPublishedPanelCard({ panel: updated, categories });
            await msg.edit(refreshed).catch(() => {});
          }
        } catch (_) {}
      }

      return ctx.reply(successCard({
        title: 'Panel Thumbnail Set',
        subtitle: `Updated thumbnail for panel **${format.escapeMarkdown(updated.title)}**.\n[View Image](${url})`,
        ephemeral: true
      }));
    }

    // 2. Settings Dashboard
    if (sub === 'settings') {
      const hasPerm = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || ctx.guild.ownerId === ctx.user.id;
      if (!hasPerm) {
        return ctx.reply(errorCard({
          title: 'Permission Denied',
          reason: 'You need the `Manage Server` permission to open ticket settings.',
          ephemeral: true
        }));
      }
      const settingsPayload = await renderTicketSettingsDashboard({ guild: ctx.guild, activeTab: 'general' });
      return ctx.reply(settingsPayload);
    }

    // 3. Ticket Stats
    if (sub === 'stats') {
      return handleStatsCommand(ctx);
    }

    // 4. Ticket Reviews / Leaderboard
    if (sub === 'reviews') {
      return handleReviewsCommand(ctx);
    }

    // 5. Ticket List
    if (sub === 'list') {
      return handleListCommand(ctx);
    }

    // 6. Blacklist Manager
    if (sub === 'blacklist') {
      return handleBlacklistCommand(ctx);
    }

    // 7. Macro Manager
    if (sub === 'macro') {
      return handleMacroCommand(ctx);
    }

    // --- Channel-Specific Commands Below ---
    let ticket = await ticketDb.getTicketByChannel(ctx.guild.id, ctx.channel.id);
    if (!ticket && ctx.channel.name?.startsWith('ticket-')) {
      ticket = await ticketDb.recoverTicketFromChannel(ctx.channel).catch(() => null);
    }
    if (!ticket) {
      return ctx.reply(errorCard({
        title: 'Not a Ticket Channel',
        reason: 'This channel is not an active ticket. Ticket actions must be run inside a ticket channel.',
        fix: 'Run this command inside a ticket created by AVA, or use `/ticket panel` or `/ticket settings`.',
        ephemeral: true
      }));
    }

    const category = ticket.category_id ? await ticketDb.getCategory(ticket.category_id) : null;
    const isStaff = await checkStaffAccess({ member: ctx.member, category, guildId: ctx.guild.id });

    // 8. Info
    if (sub === 'info') {
      return handleInfoCommand(ctx, ticket, category);
    }

    // 9. Claim / Unclaim
    if (sub === 'claim' || sub === 'unclaim') {
      if (!isStaff) {
        return ctx.reply(errorCard({
          title: 'Staff Only',
          reason: 'Only configured support staff members can claim or unclaim tickets.',
          ephemeral: true
        }));
      }
      return handleClaimToggle({
        ticket,
        member: ctx.member,
        channel: ctx.channel
      }).then(res => {
        if (!res.success) return ctx.reply(errorCard({ title: 'Claim Failed', reason: res.error, ephemeral: true }));
        return ctx.reply(successCard({
          title: res.claimed ? 'Ticket Claimed' : 'Ticket Unclaimed',
          subtitle: res.claimed ? `Ticket claimed by <@${ctx.user.id}>.` : 'Ticket claim released.',
          ephemeral: false
        }));
      });
    }

    // 10. Close
    if (sub === 'close') {
      const isOwner = ticket.owner_id === ctx.user.id;
      if (!isOwner && !isStaff) {
        return ctx.reply(errorCard({
          title: 'Permission Denied',
          reason: 'Only the ticket creator or staff members can close this ticket.',
          ephemeral: true
        }));
      }
      const reason = ctx.args.reason || 'Closed via command';
      return handleCloseTicket({
        ticket,
        member: ctx.member,
        channel: ctx.channel,
        reason,
        client: ctx.client
      }).then(res => {
        if (!res.success) return ctx.reply(errorCard({ title: 'Close Failed', reason: res.error, ephemeral: true }));
        return ctx.reply(successCard({
          title: 'Ticket Closed',
          subtitle: `Ticket closed by <@${ctx.user.id}>.\nReason: ${format.quote(reason)}`,
          ephemeral: false
        }));
      });
    }

    // 11. Reopen
    if (sub === 'reopen') {
      if (!isStaff) {
        return ctx.reply(errorCard({
          title: 'Staff Only',
          reason: 'Only support staff members can reopen tickets.',
          ephemeral: true
        }));
      }
      if (ticket.status !== 'closed') {
        return ctx.reply(errorCard({
          title: 'Already Open',
          reason: 'This ticket is already open.',
          ephemeral: true
        }));
      }

      await ticketDb.updateTicket(ticket.id, {
        status: 'open',
        closed_at: null,
        closed_by: null,
        close_reason: null
      });

      // Restore channel permission for owner
      await perm.apply({
        guildId: ctx.guild.id,
        feature: 'tickets',
        targetType: 'channel',
        targetId: ctx.channel.id,
        op: 'edit_channel_overwrite',
        field: 'permissionOverwrites',
        oldValue: ctx.channel.permissionOverwrites?.cache?.get(ticket.owner_id),
        newValue: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true },
        reason: `AVA Tickets: Reopen ticket #${ticket.ticket_number}`,
        execute: () => ctx.channel.permissionOverwrites.edit(ticket.owner_id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true
        })
      }).catch(() => {});

      await buildTicketControlCard({ ticket: { ...ticket, status: 'open' }, guild: ctx.guild }).then(card => {
        return ctx.channel.send(card);
      }).catch(() => {});

      await sendTicketLog(ctx.guild, 'ticket_reopened', {
        ticket,
        staff: ctx.member,
        details: [{ label: 'Action', value: 'Reopened by staff member' }]
      }).catch(() => {});

      return ctx.reply(successCard({
        title: 'Ticket Reopened',
        subtitle: `Ticket #${ticket.ticket_number} has been reopened by <@${ctx.user.id}>.`,
        ephemeral: false
      }));
    }

    // 12. Add User / Role
    if (sub === 'add') {
      if (!isStaff && ticket.owner_id !== ctx.user.id) {
        return ctx.reply(errorCard({ title: 'Permission Denied', reason: 'You do not have access to add members.', ephemeral: true }));
      }
      const targetUserId = ctx.args.user;
      const targetRoleId = ctx.args.role;
      if (!targetUserId && !targetRoleId) {
        return ctx.reply(errorCard({ title: 'Missing Target', reason: 'Please specify a user or role to add.', ephemeral: true }));
      }

      if (targetUserId) {
        const res = await handleModifyUserAccess({ ticket, member: ctx.member, channel: ctx.channel, targetUserId, action: 'add' });
        if (!res.success) return ctx.reply(errorCard({ title: 'Failed to Add User', reason: res.error, ephemeral: true }));
        return ctx.reply(successCard({ title: 'User Added', subtitle: `Granted <@${targetUserId}> access to this ticket.` }));
      }

      if (targetRoleId) {
        await perm.apply({
          guildId: ctx.guild.id,
          feature: 'tickets',
          targetType: 'channel',
          targetId: ctx.channel.id,
          op: 'edit_channel_overwrite',
          field: 'permissionOverwrites',
          oldValue: ctx.channel.permissionOverwrites?.cache?.get(targetRoleId),
          newValue: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true },
          reason: `AVA Tickets: Add role ${targetRoleId} to ticket #${ticket.ticket_number}`,
          execute: () => ctx.channel.permissionOverwrites.edit(targetRoleId, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true
          })
        }).catch(() => {});
        return ctx.reply(successCard({ title: 'Role Added', subtitle: `Granted <@&${targetRoleId}> access to this ticket.` }));
      }
    }

    // 13. Remove User / Role
    if (sub === 'remove') {
      if (!isStaff) {
        return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Only staff can remove members from tickets.', ephemeral: true }));
      }
      const targetUserId = ctx.args.user;
      const targetRoleId = ctx.args.role;
      if (!targetUserId && !targetRoleId) {
        return ctx.reply(errorCard({ title: 'Missing Target', reason: 'Please specify a user or role to remove.', ephemeral: true }));
      }

      if (targetUserId) {
        const res = await handleModifyUserAccess({ ticket, member: ctx.member, channel: ctx.channel, targetUserId, action: 'remove' });
        if (!res.success) return ctx.reply(errorCard({ title: 'Failed to Remove User', reason: res.error, ephemeral: true }));
        return ctx.reply(successCard({ title: 'User Removed', subtitle: `Revoked access for <@${targetUserId}>.` }));
      }

      if (targetRoleId) {
        await perm.apply({
          guildId: ctx.guild.id,
          feature: 'tickets',
          targetType: 'channel',
          targetId: ctx.channel.id,
          op: 'delete_channel_overwrite',
          field: 'permissionOverwrites',
          oldValue: ctx.channel.permissionOverwrites?.cache?.get(targetRoleId),
          newValue: null,
          reason: `AVA Tickets: Remove role ${targetRoleId} from ticket #${ticket.ticket_number}`,
          execute: () => ctx.channel.permissionOverwrites.delete(targetRoleId)
        }).catch(() => {});
        return ctx.reply(successCard({ title: 'Role Removed', subtitle: `Revoked access for <@&${targetRoleId}>.` }));
      }
    }

    // 14. Rename
    if (sub === 'rename') {
      if (!isStaff) {
        return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Only staff can rename tickets.', ephemeral: true }));
      }
      const newName = (ctx.args.name || '').trim();
      if (!newName || newName.length < 2) {
        return ctx.reply(errorCard({ title: 'Invalid Name', reason: 'Channel name must be at least 2 characters.', ephemeral: true }));
      }
      await ctx.channel.setName(newName).catch(err => {
        return ctx.reply(errorCard({ title: 'Rename Failed', reason: err.message, ephemeral: true }));
      });
      return ctx.reply(successCard({ title: 'Ticket Renamed', subtitle: `Channel renamed to \`${newName}\`.` }));
    }

    // 15. Priority
    if (sub === 'priority') {
      if (!isStaff) {
        return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Only staff can change ticket priority.', ephemeral: true }));
      }
      const level = (ctx.args.level || '').toLowerCase();
      if (!['low', 'normal', 'high', 'urgent'].includes(level)) {
        return ctx.reply(errorCard({
          title: 'Invalid Priority',
          reason: 'Priority must be one of: `low`, `normal`, `high`, `urgent`.',
          ephemeral: true
        }));
      }
      const res = await handleChangePriority({ ticket, member: ctx.member, channel: ctx.channel, newPriority: level });
      if (!res.success) return ctx.reply(errorCard({ title: 'Priority Change Failed', reason: res.error, ephemeral: true }));
      return ctx.reply(successCard({ title: 'Priority Updated', subtitle: `Ticket priority changed to **${level.toUpperCase()}**.` }));
    }

    // 16. Staff Note
    if (sub === 'note') {
      if (!isStaff) {
        return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Only staff members can add internal notes.', ephemeral: true }));
      }
      const content = (ctx.args.content || '').trim();
      if (!content) {
        return ctx.reply(errorCard({ title: 'Empty Note', reason: 'Please provide note text.', ephemeral: true }));
      }
      const res = await handleAddStaffNote({ ticket, member: ctx.member, channel: ctx.channel, noteContent: content });
      if (!res.success) return ctx.reply(errorCard({ title: 'Failed to Save Note', reason: res.error, ephemeral: true }));
      return ctx.reply(successCard({
        title: 'Internal Note Added',
        subtitle: `Note saved to ticket #${ticket.ticket_number} database record.`,
        details: [{ label: 'Note', value: format.quote(content) }],
        ephemeral: true
      }));
    }

    // Fallback: Default to info
    return handleInfoCommand(ctx, ticket, category);
  }
};

/**
 * Renders ticket info card
 */
async function handleInfoCommand(ctx, ticket, category) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🎫 Ticket #${ticket.ticket_number} Overview`)
  );

  const notes = await ticketDb.getStaffNotes(ctx.guild.id, ticket.id);

  const lines = [
    `${theme.emojis.dot} **Status:** \`${(ticket.status || 'open').toUpperCase()}\``,
    `${theme.emojis.dot} **Owner:** <@${ticket.owner_id}> (\`${ticket.owner_id}\`)`,
    `${theme.emojis.dot} **Category:** ${category?.name || 'General Support'}`,
    `${theme.emojis.dot} **Priority:** \`${(ticket.priority || 'normal').toUpperCase()}\``,
    `${theme.emojis.dot} **Claimed By:** ${ticket.claimed_by ? `<@${ticket.claimed_by}>` : '_Unclaimed_'}`,
    `${theme.emojis.dot} **Created At:** <t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:F> (<t:${Math.floor(new Date(ticket.created_at).getTime() / 1000)}:R>)`,
    `${theme.emojis.dot} **Staff Notes:** \`${notes.length}\` note(s) logged`
  ];

  if (ticket.close_reason) {
    lines.push(`${theme.emojis.dot} **Close Reason:** ${format.quote(ticket.close_reason)}`);
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  if (notes.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`### 📝 Internal Staff Notes\n` + notes.map(n => `- **<@${n.staff_id}>** (<t:${Math.floor(new Date(n.created_at).getTime() / 1000)}:R>): ${format.escapeMarkdown(n.content)}`).join('\n'))
    );
  }

  return ctx.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  });
}

/**
 * Renders server ticket statistics overview
 */
async function handleStatsCommand(ctx) {
  const stats = await ticketDb.getStats(ctx.guild.id);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 📊 Ticket Analytics & Performance`)
  );

  const total = stats.total || 0;
  const open = stats.open || 0;
  const closed = stats.closed || 0;
  const resolutionRate = total > 0 ? Math.round((closed / total) * 100) : 0;

  // Build ANSI progress bar
  const filled = Math.min(10, Math.floor(resolutionRate / 10));
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  const text = [
    `Performance overview and support workload for **${format.escapeMarkdown(ctx.guild.name)}**.`,
    '',
    `### 📈 Volume Breakdown`,
    `${theme.emojis.dot} **Total Tickets:** \`${total}\``,
    `${theme.emojis.dot} **Active Open:** \`${open}\``,
    `${theme.emojis.dot} **Resolved / Closed:** \`${closed}\``,
    `${theme.emojis.dot} **Resolution Rate:** \`${resolutionRate}%\``,
    '```ansi',
    `\u001b[32m${bar}\u001b[0m ${resolutionRate}%`,
    '```',
    `### ⏱️ Response & Handling Metrics`,
    `${theme.emojis.dot} **Avg First Response:** \`${stats.avg_response_time_minutes || 0} min\``,
    `${theme.emojis.dot} **Avg Resolution Time:** \`${stats.avg_resolution_time_minutes || 0} min\``,
    `${theme.emojis.dot} **Avg Customer Rating:** \`⭐ ${(stats.avg_rating || 0).toFixed(1)} / 5.0\` (\`${stats.total_ratings || 0}\` reviews)`
  ].join('\n');

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  return ctx.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  });
}

/**
 * Renders customer reviews leaderboard
 */
async function handleReviewsCommand(ctx) {
  const leaderboard = await ticketDb.getStaffLeaderboard(ctx.guild.id, 10);
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ⭐ Customer Satisfaction & Staff Leaderboard`)
  );

  if (leaderboard.length === 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('_No staff reviews or closed ticket ratings recorded yet._')
    );
  } else {
    const lines = leaderboard.map((s, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `\`#${idx + 1}\``;
      const stars = '⭐'.repeat(Math.round(s.avg_rating || 5));
      return `${medal} <@${s.staff_id}> — **${(s.avg_rating || 5).toFixed(1)}** ${stars} (${s.total_reviews} reviews | ${s.claimed_count || 0} claimed)`;
    });

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  return ctx.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  });
}

/**
 * Lists tickets with optional status filter
 */
async function handleListCommand(ctx) {
  const status = ctx.args.status || 'open';
  const tickets = await ticketDb.getTickets(ctx.guild.id, { status });
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🎫 Active Server Tickets (${status.toUpperCase()})`)
  );

  if (tickets.length === 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`_No tickets matching status \`${status}\`._`)
    );
  } else {
    const lines = tickets.slice(0, 15).map(t => {
      const claimStr = t.claimed_by ? `<@${t.claimed_by}>` : '_Unclaimed_';
      return `${theme.emojis.dot} <#${t.channel_id}> — Owner: <@${t.owner_id}> | Claimed: ${claimStr} | Priority: \`${t.priority || 'normal'}\``;
    });

    if (tickets.length > 15) {
      lines.push(`-# ...and ${tickets.length - 15} more ticket(s).`);
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  return ctx.reply({
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  });
}

/**
 * Blacklist manager command
 */
async function handleBlacklistCommand(ctx) {
  const hasPerm = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild) || ctx.guild.ownerId === ctx.user.id;
  if (!hasPerm) {
    return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Manage Server permission required.', ephemeral: true }));
  }

  const action = (ctx.args.action || 'list').toLowerCase();

  if (action === 'list') {
    const list = await ticketDb.getBlacklist(ctx.guild.id);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 🚫 Ticket Blacklist Entries`)
    );

    if (list.length === 0) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_No users or roles currently blacklisted._'));
    } else {
      const lines = list.map(b => {
        const targetStr = b.target_type === 'role' ? `<@&${b.target_id}>` : `<@${b.target_id}>`;
        return `${theme.emojis.dot} ${targetStr} (\`${b.target_type}\`) — Reason: ${format.quote(b.reason || 'None')}`;
      });
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }

    return ctx.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container]
    });
  }

  const targetId = (ctx.args.target || '').replace(/[<@!&>]/g, '').trim();
  if (!targetId) {
    return ctx.reply(errorCard({ title: 'Missing Target', reason: 'Please specify a target user or role.', ephemeral: true }));
  }

  if (action === 'add') {
    const reason = ctx.args.reason || 'Blacklisted by staff';
    const isRole = ctx.guild.roles.cache.has(targetId);
    const targetType = isRole ? 'role' : 'user';

    await ticketDb.addToBlacklist({
      guild_id: ctx.guild.id,
      target_id: targetId,
      target_type: targetType,
      reason,
      added_by: ctx.user.id
    });

    return ctx.reply(successCard({
      title: 'Target Blacklisted',
      subtitle: `Target \`${targetId}\` has been restricted from creating tickets.`,
      details: [{ label: 'Reason', value: format.quote(reason) }]
    }));
  }

  if (action === 'remove') {
    await ticketDb.removeFromBlacklist(ctx.guild.id, targetId);
    return ctx.reply(successCard({
      title: 'Blacklist Entry Removed',
      subtitle: `Target \`${targetId}\` has been unblacklisted.`
    }));
  }

  return ctx.reply(errorCard({ title: 'Invalid Action', reason: 'Use `add`, `remove`, or `list`.' }));
}

/**
 * Macro manager command
 */
async function handleMacroCommand(ctx) {
  const isStaff = ctx.member?.permissions?.has(PermissionFlagsBits.ManageMessages) || ctx.guild.ownerId === ctx.user.id;
  if (!isStaff) {
    return ctx.reply(errorCard({ title: 'Staff Only', reason: 'Only staff can manage or use ticket macros.', ephemeral: true }));
  }

  const action = (ctx.args.action || 'list').toLowerCase();

  if (action === 'list') {
    const macros = await ticketDb.getMacros(ctx.guild.id);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 📋 Ticket Canned Responses / Macros`));

    if (macros.length === 0) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent('_No macros created yet. Use `/ticket macro action:add`._'));
    } else {
      const lines = macros.map(m => `${theme.emojis.dot} **\`${m.name}\`**: ${format.escapeMarkdown(m.content.slice(0, 100))}${m.content.length > 100 ? '...' : ''}`);
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }

    return ctx.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container]
    });
  }

  const name = (ctx.args.name || '').trim().toLowerCase();
  if (!name) {
    return ctx.reply(errorCard({ title: 'Missing Macro Name', reason: 'Please provide a macro name.', ephemeral: true }));
  }

  if (action === 'use') {
    const macros = await ticketDb.getMacros(ctx.guild.id);
    const found = macros.find(m => m.name.toLowerCase() === name);
    if (!found) {
      return ctx.reply(errorCard({ title: 'Macro Not Found', reason: `No macro named \`${name}\` exists.`, ephemeral: true }));
    }

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(found.content)
    );
    return ctx.reply({
      flags: MessageFlags.IsComponentsV2,
      components: [container]
    });
  }

  if (action === 'add') {
    const text = ctx.args.text;
    if (!text) {
      return ctx.reply(errorCard({ title: 'Missing Content', reason: 'Please provide macro content text.', ephemeral: true }));
    }
    await ticketDb.saveMacro({
      guild_id: ctx.guild.id,
      name,
      content: text,
      created_by: ctx.user.id
    });
    return ctx.reply(successCard({
      title: 'Macro Saved',
      subtitle: `Macro \`${name}\` saved successfully. Use with \`/ticket macro action:use name:${name}\`.`
    }));
  }

  if (action === 'delete') {
    await ticketDb.deleteMacro(ctx.guild.id, name);
    return ctx.reply(successCard({
      title: 'Macro Deleted',
      subtitle: `Macro \`${name}\` has been removed.`
    }));
  }

  return ctx.reply(errorCard({ title: 'Invalid Action', reason: 'Use `use`, `list`, `add`, or `delete`.' }));
}

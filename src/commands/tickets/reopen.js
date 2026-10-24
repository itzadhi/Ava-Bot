import { ticketDb } from '../../db/tickets.js';
import { checkStaffAccess } from '../../modules/tickets/categories.js';
import { buildTicketControlCard } from '../../modules/tickets/controls.js';
import { sendTicketLog } from '../../modules/tickets/logs.js';
import { successCard, errorCard } from '../../ui/cards.js';
import { perm } from '../../core/permissions/permApply.js';

export default {
  name: 'reopen',
  aliases: ['tktreopen'],
  description: 'Reopen a closed ticket before deletion',
  category: 'tickets',
  cooldown: 3,
  args: [],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be run inside a Discord server.',
        ephemeral: true
      }));
    }

    const ticket = await ticketDb.getTicketByChannel(ctx.guild.id, ctx.channel.id);
    if (!ticket) {
      return ctx.reply(errorCard({
        title: 'Not a Ticket Channel',
        reason: 'This command can only be used inside an active ticket channel.',
        ephemeral: true
      }));
    }

    const category = ticket.category_id ? await ticketDb.getCategory(ticket.category_id) : null;
    const isStaff = await checkStaffAccess({ member: ctx.member, category, guildId: ctx.guild.id });

    if (!isStaff) {
      return ctx.reply(errorCard({
        title: 'Staff Only',
        reason: 'Only support staff members can reopen closed tickets.',
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

    // Restore owner permissions
    await perm.apply({
      guildId: ctx.guild.id,
      feature: 'tickets',
      targetType: 'channel',
      targetId: ctx.channel.id,
      op: 'edit_channel_overwrite',
      field: 'permissionOverwrites',
      oldValue: ctx.channel.permissionOverwrites?.cache?.get(ticket.owner_id),
      newValue: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true },
      reason: `AVA Tickets: Restore owner permissions on reopen #${ticket.ticket_number}`,
      execute: () => ctx.channel.permissionOverwrites.edit(ticket.owner_id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      })
    }).catch(() => {});

    // Send fresh control card
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
};

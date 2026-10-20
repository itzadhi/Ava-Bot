import { ticketDb } from '../../db/tickets.js';
import { checkStaffAccess } from '../../modules/tickets/categories.js';
import { handleCloseTicket } from '../../modules/tickets/actions.js';
import * as format from '../../utils/ui/format.js';
import { successCard, errorCard } from '../../ui/cards.js';

export default {
  name: 'close',
  aliases: ['tktclose'],
  description: 'Close the current ticket channel with an optional reason',
  category: 'tickets',
  cooldown: 3,
  args: [
    {
      name: 'reason',
      description: 'Reason for closing this ticket',
      type: 'string',
      required: false
    }
  ],
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
    const isOwner = ticket.owner_id === ctx.user.id;

    if (!isOwner && !isStaff) {
      return ctx.reply(errorCard({
        title: 'Permission Denied',
        reason: 'Only the ticket creator or server support staff can close this ticket.',
        ephemeral: true
      }));
    }

    const reason = ctx.args.reason || 'Closed via command';
    const res = await handleCloseTicket({
      ticket,
      member: ctx.member,
      channel: ctx.channel,
      reason,
      client: ctx.client
    });

    if (!res.success) {
      return ctx.reply(errorCard({
        title: 'Close Failed',
        reason: res.error,
        ephemeral: true
      }));
    }

    return ctx.reply(successCard({
      title: 'Ticket Closed',
      subtitle: `Ticket closed by <@${ctx.user.id}>.\nReason: ${format.quote(reason)}`,
      ephemeral: false
    }));
  }
};

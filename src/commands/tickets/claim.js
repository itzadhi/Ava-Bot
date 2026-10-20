import { ticketDb } from '../../db/tickets.js';
import { checkStaffAccess } from '../../modules/tickets/categories.js';
import { handleClaimToggle } from '../../modules/tickets/actions.js';
import { successCard, errorCard } from '../../ui/cards.js';

export default {
  name: 'claim',
  aliases: ['tktclaim'],
  description: 'Claim or release claim on the current ticket channel',
  category: 'tickets',
  cooldown: 2,
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
        reason: 'Only configured support staff members can claim tickets.',
        ephemeral: true
      }));
    }

    const res = await handleClaimToggle({
      ticket,
      member: ctx.member,
      channel: ctx.channel
    });

    if (!res.success) {
      return ctx.reply(errorCard({
        title: 'Claim Failed',
        reason: res.error,
        ephemeral: true
      }));
    }

    return ctx.reply(successCard({
      title: res.claimed ? 'Ticket Claimed' : 'Ticket Unclaimed',
      subtitle: res.claimed ? `Ticket claimed by <@${ctx.user.id}>.` : 'Ticket claim released.',
      ephemeral: false
    }));
  }
};

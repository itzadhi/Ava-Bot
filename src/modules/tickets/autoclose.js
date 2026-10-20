import { db } from '../../db/client.js';
import {
  getTicketSettings,
  updateTicket,
  getTicketByChannel,
  getUserOpenTickets
} from '../../db/tickets.js';
import { handleCloseTicket } from './actions.js';
import { sendTicketLog } from './logs.js';
import { container } from '../../utils/ui/components.js';
import { logger } from '../../utils/logger.js';

let intervalId = null;

/**
 * Periodically scans open tickets and auto-warns or auto-closes inactive ones
 */
export async function scanInactiveTickets(client) {
  if (!client?.guilds?.cache) return;

  try {
    const { data: openTickets, error } = await db
      .from('tickets')
      .select('*')
      .in('status', ['open', 'claimed', 'locked']);

    if (error || !openTickets) return;

    for (const ticket of openTickets) {
      const guild = client.guilds.cache.get(ticket.guild_id);
      if (!guild) continue;

      const settings = await getTicketSettings(ticket.guild_id);
      const autocloseHours = settings.autoclose_hours || 0;
      if (autocloseHours <= 0) continue;

      const warningHours = settings.autoclose_warning_hours || 0;
      const lastActive = new Date(ticket.last_message_at || ticket.created_at).getTime();
      const now = Date.now();
      const elapsedHours = (now - lastActive) / (1000 * 60 * 60);

      const channel = guild.channels.cache.get(ticket.channel_id);
      if (!channel) continue;

      // 1. Send warning if within warning window and warning hasn't been sent yet
      if (warningHours > 0 && !ticket.warning_sent_at) {
        const threshold = autocloseHours - warningHours;
        if (elapsedHours >= threshold && elapsedHours < autocloseHours) {
          const noticeCard = container({
            title: 'Inactivity Notice',
            lines: [
              `⚠️ <@${ticket.owner_id}>, this ticket has been inactive for **${Math.floor(elapsedHours)} hours**.`,
              `It will automatically be closed in **${warningHours} hours** if no response is received.`
            ]
          });
          await channel.send(noticeCard).catch(() => {});

          await updateTicket(ticket.id, { warning_sent_at: new Date().toISOString() });
          continue;
        }
      }

      // 2. Auto-close if exceeded autocloseHours
      if (elapsedHours >= autocloseHours) {
        logger.info({ ticketId: ticket.id, guildId: guild.id }, 'Auto-closing inactive ticket');
        const fakeInteraction = {
          guild,
          channel,
          member: guild.members.me,
          user: guild.members.me?.user || client.user,
          reply: async (payload) => {
            if (channel?.send) await channel.send(payload).catch(() => {});
          }
        };

        await handleCloseTicket(fakeInteraction, ticket.id, `Auto-closed after ${autocloseHours}h of inactivity`).catch(err => {
          logger.warn({ err, ticketId: ticket.id }, 'Failed to auto-close inactive ticket');
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Error scanning inactive tickets');
  }
}

/**
 * Handles member leaving server: auto-closes any open tickets owned by that member
 */
export async function handleMemberLeave(member) {
  if (!member?.guild) return;

  try {
    const openTickets = await getUserOpenTickets(member.guild.id, member.id);
    for (const ticket of openTickets) {
      const channel = member.guild.channels.cache.get(ticket.channel_id);
      const fakeInteraction = {
        guild: member.guild,
        channel,
        member: member.guild.members.me,
        user: member.guild.members.me?.user || member.client.user,
        reply: async (payload) => {
          if (channel?.send) await channel.send(payload).catch(() => {});
        }
      };

      await handleCloseTicket(fakeInteraction, ticket.id, 'Ticket owner left the server').catch(() => {});
    }
  } catch (err) {
    logger.warn({ err, userId: member.id }, 'Error handling member departure for tickets');
  }
}

/**
 * Handles Discord channel deletion: cleans up database ticket state
 */
export async function handleChannelDelete(channel) {
  if (!channel?.id) return;

  try {
    const ticket = await getTicketByChannel(channel.guild?.id, channel.id);
    if (ticket && ticket.status !== 'closed') {
      await updateTicket(ticket.id, {
        status: 'closed',
        closed_by: 'system',
        closed_at: new Date().toISOString(),
        close_reason: 'Channel deleted manually'
      });
      logger.info({ ticketId: ticket.id, channelId: channel.id }, 'Cleaned up ticket record on channel deletion');
    }
  } catch (err) {
    logger.warn({ err, channelId: channel.id }, 'Error cleaning up ticket on channel deletion');
  }
}

/**
 * Starts the periodic inactivity scanner interval
 */
export function startTicketScheduler(client, intervalMs = 10 * 60 * 1000) {
  if (intervalId) clearInterval(intervalId);
  intervalId = setInterval(() => {
    scanInactiveTickets(client).catch(() => {});
  }, intervalMs);
  logger.info('Ticket inactivity scheduler started');
}

/**
 * Stops the scheduler
 */
export function stopTicketScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

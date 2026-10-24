import { z } from 'zod';
import { handleTicketInteraction } from './router.js';
import { scanInactiveTickets, startTicketScheduler, stopTicketScheduler } from './autoclose.js';

export const moduleManifest = {
  id: 'tickets',
  name: 'Tickets',
  version: '1.0.0',
  description: 'Enterprise ticket management system with dynamic forms, transcripts, ratings, and auto-close',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'tkt:*',
      type: 'any',
      async execute(interaction, args) {
        return handleTicketInteraction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [
    {
      name: 'ticket-inactivity-scan',
      expression: '*/10 * * * *',
      run: async (client) => {
        if (!client?.guilds?.cache) return;
        await scanInactiveTickets(client).catch(() => {});
      }
    }
  ],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    maxOpenPerUser: z.number().default(3),
    inactivityHours: z.number().default(24)
  }),
  copy: {
    ticketCreated: 'Your support ticket has been opened.',
    ticketClosed: 'Ticket has been resolved and archived.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Ticket engine active' };
  },
  async onLoad({ client, logger }) {
    if (client) {
      startTicketScheduler(client);
      logger.debug('Tickets module loaded and scheduler started.');
    }
  },
  async onUnload({ logger }) {
    stopTicketScheduler();
    logger?.debug?.('Tickets scheduler stopped.');
  }
};

export { handleTicketInteraction, scanInactiveTickets, startTicketScheduler, stopTicketScheduler };
export default moduleManifest;

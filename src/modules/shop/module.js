import { z } from 'zod';
import { handleShopInteraction } from './index.js';
import { startShopExpiryJob, stopShopExpiryJob } from './jobs/expiry.js';

export const moduleManifest = {
  id: 'shop',
  name: 'Shop',
  version: '1.0.0',
  description: 'Automated digital storefront, inventory management, order delivery, and crypto/card checkout',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'shop:*',
      type: 'any',
      async execute(interaction, args) {
        return handleShopInteraction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    currency: z.string().default('USD')
  }),
  copy: {
    orderPlaced: 'Your shop order has been placed successfully.',
    delivered: 'Your order delivery details have been dispatched.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Storefront engine active' };
  },
  async onLoad({ logger }) {
    logger.debug('Shop module loaded.');
  },
  async onUnload({ logger }) {
    stopShopExpiryJob();
    logger?.debug?.('Shop expiry sweeper stopped.');
  }
};

export { handleShopInteraction, startShopExpiryJob, stopShopExpiryJob };
export default moduleManifest;

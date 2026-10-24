import { z } from 'zod';
import { handleAutoModInteraction } from './router.js';
import { scanMessage } from './engine.js';
import { initAutoModCache } from '../../db/automod.js';

export const moduleManifest = {
  id: 'automod',
  name: 'AutoMod',
  version: '1.0.0',
  description: 'Multi-layer automated message moderation, anti-spam, invite filters, and regex detection',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'automod:*',
      type: 'any',
      async execute(interaction, args) {
        return handleAutoModInteraction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    invites: z.boolean().default(false),
    links: z.boolean().default(false),
    words: z.boolean().default(false),
    spam: z.boolean().default(false),
    caps: z.boolean().default(false)
  }),
  copy: {
    ruleAdded: 'AutoMod rule updated successfully.'
  },
  async healthCheck() {
    return { healthy: true, details: 'AutoMod engine active' };
  },
  async onLoad({ client, logger }) {
    if (client) {
      await initAutoModCache(client).catch(err => {
        logger.warn({ err }, 'Error warming automod cache');
      });
      logger.debug('AutoMod module loaded.');
    }
  },
  async onUnload() {}
};

export { handleAutoModInteraction, scanMessage, initAutoModCache };
export default moduleManifest;

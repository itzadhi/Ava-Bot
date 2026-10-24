import { z } from 'zod';
import { handleAntiNukeInteraction } from './router.js';
import { initAntiNukeCache } from '../../db/antinuke.js';
import { resumeActiveLockdowns } from './lockdown.js';

export const moduleManifest = {
  id: 'antinuke',
  name: 'AntiNuke',
  version: '1.0.0',
  description: 'Autonomous disaster recovery, mass-deletion rollback, raid lockdown, and rogue admin defense',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'antinuke:*',
      type: 'any',
      async execute(interaction, args) {
        return handleAntiNukeInteraction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(false),
    action: z.enum(['ban', 'kick', 'strip', 'timeout']).default('ban'),
    channelThreshold: z.number().default(3),
    roleThreshold: z.number().default(3),
    banThreshold: z.number().default(3),
    windowSeconds: z.number().default(10)
  }),
  copy: {
    activated: 'Anti-Nuke protection is currently active and monitoring server integrity.',
    mitigated: 'Incident detected and automatically neutralized.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Anti-Nuke defense system active' };
  },
  async onLoad({ client, logger }) {
    if (client) {
      await initAntiNukeCache(client).catch(err => {
        logger.warn({ err }, 'Error preloading AntiNuke cache');
      });
      await resumeActiveLockdowns(client).catch(err => {
        logger.warn({ err }, 'Error resuming active lockdowns');
      });
      logger.debug('AntiNuke module loaded.');
    }
  },
  async onUnload() {}
};

export { handleAntiNukeInteraction };
export default moduleManifest;

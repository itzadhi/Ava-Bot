import { z } from 'zod';
import { handleBoostMemberUpdate } from './tracker.js';
import { buildBoostPanel } from './panel.js';

export const moduleManifest = {
  id: 'boosts',
  name: 'Boosts',
  version: '1.0.0',
  description: 'Server boost event announcements, thank-you cards, and custom vanity rewards',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {
    guildMemberUpdate: handleBoostMemberUpdate
  },
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(false),
    channelId: z.string().nullable().default(null)
  }),
  copy: {
    boostAnnounced: 'Server boost announced.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Boost tracking active' };
  },
  async onLoad({ logger }) {
    logger.debug('Boosts module loaded.');
  },
  async onUnload() {}
};

export { handleBoostMemberUpdate, buildBoostPanel };
export default moduleManifest;


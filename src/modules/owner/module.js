import { z } from 'zod';
import { openOwnerPanel, handleOwnerInteraction } from './panel.js';

export const moduleManifest = {
  id: 'owner',
  name: 'Owner Control',
  version: '1.0.0',
  description: 'Global bot administration, broadcast broadcasts, premium tier grants, and telemetry',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'owner:*',
      type: 'any',
      async execute(interaction, args) {
        return handleOwnerInteraction(interaction, args);
      }
    }
  ],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true)
  }),
  copy: {
    dispatched: 'Owner command executed.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Owner administration active' };
  },
  async onLoad({ logger }) {
    logger.debug('Owner module loaded.');
  },
  async onUnload() {}
};

export { openOwnerPanel, handleOwnerInteraction };
export default moduleManifest;


import { z } from 'zod';
import { handleDashboardInteraction } from './index.js';

export const moduleManifest = {
  id: 'panel',
  name: 'Dashboard Panels',
  version: '1.0.0',
  description: 'Dynamic server button panels, action triggers, and central dashboard menus',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'dash:*',
      type: 'any',
      async execute(interaction, args) {
        return handleDashboardInteraction(interaction, args);
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
    dispatched: 'Action performed successfully.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Dashboard panels active' };
  },
  async onLoad({ logger }) {
    logger.debug('Dashboard panels module loaded.');
  },
  async onUnload() {}
};

export { handleDashboardInteraction };
export default moduleManifest;


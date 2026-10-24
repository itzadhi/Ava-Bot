import { z } from 'zod';
import { startHelpSession, handleHelpInteraction } from './panel.js';

export const moduleManifest = {
  id: 'help',
  name: 'Help',
  version: '1.0.0',
  description: 'Interactive help directory and category explorer for AVA commands and features',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'help:*',
      type: 'any',
      async execute(interaction, args) {
        return handleHelpInteraction(interaction, args);
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
    title: 'Command & Feature Manual'
  },
  async healthCheck() {
    return { healthy: true, details: 'Help manual online' };
  },
  async onLoad({ logger }) {
    logger.debug('Help module loaded.');
  },
  async onUnload() {}
};

export { startHelpSession, handleHelpInteraction };
export default moduleManifest;


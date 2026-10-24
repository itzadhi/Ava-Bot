import { z } from 'zod';
import { handlePermifyInteraction, validateRoleSelection } from './router.js';
import { autoRepairPermissionsAndTickets } from './repair.js';

export const moduleManifest = {
  id: 'permify',
  name: 'Permify',
  version: '1.0.0',
  description: 'Server permission synchronization and automated permission repair architecture',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'permify:*',
      type: 'any',
      async execute(interaction, args) {
        return handlePermifyInteraction(interaction, args);
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
    applied: 'Permissions successfully synchronized.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Permission architecture operational' };
  },
  async onLoad({ logger }) {
    logger.debug('Permify module loaded.');
  },
  async onUnload() {}
};

export { handlePermifyInteraction, validateRoleSelection, autoRepairPermissionsAndTickets };
export default moduleManifest;

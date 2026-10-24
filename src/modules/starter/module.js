import { starterModule } from './index.js';
import { z } from 'zod';

export const moduleManifest = {
  id: 'starter',
  name: 'Starter',
  version: '1.0.0',
  description: 'Interactive starter reference module for Components V2 and Supabase state',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: starterModule.commands || [],
  components: starterModule.components || [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    maxClicks: z.number().default(1000)
  }),
  copy: {
    title: 'Starter Module',
    noteSaved: 'Note has been saved successfully.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Starter module active' };
  },
  async onLoad({ logger }) {
    logger.debug('Starter module loaded.');
  },
  async onUnload() {}
};

export default moduleManifest;

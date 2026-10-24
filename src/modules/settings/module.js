import { settingsComponents } from './components.js';
import { z } from 'zod';

export const moduleManifest = {
  id: 'settings',
  name: 'Settings',
  version: '1.0.0',
  description: 'Centralized server configuration panel and one-tap toggles',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: settingsComponents || [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    prefix: z.string().default('!'),
    timezone: z.string().default('UTC')
  }),
  copy: {
    saved: 'Server settings have been saved.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Settings subsystem active' };
  },
  async onLoad({ logger }) {
    logger.debug('Settings module loaded.');
  },
  async onUnload() {}
};

export default moduleManifest;

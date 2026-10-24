import { chatlogComponents } from './components.js';
import { z } from 'zod';

export const moduleManifest = {
  id: 'chatlog',
  name: 'Chatlog',
  version: '1.0.0',
  description: 'Encrypted channel message export, replay, and management module',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: chatlogComponents || [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    retentionDays: z.number().default(30)
  }),
  copy: {
    exported: 'Chatlog exported successfully.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Chatlog module active' };
  },
  async onLoad({ logger }) {
    logger.debug('Chatlog module loaded.');
  },
  async onUnload() {}
};

export default moduleManifest;

import { z } from 'zod';
import { renderStaffPanel } from './panel.js';

export const moduleManifest = {
  id: 'staff',
  name: 'Staff & Mod',
  version: '1.0.0',
  description: 'Staff quick-action moderation dashboard, warnings, timeouts, kicks, and bans',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true)
  }),
  copy: {
    executed: 'Moderation action executed.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Staff moderation dashboard active' };
  },
  async onLoad({ logger }) {
    logger.debug('Staff module loaded.');
  },
  async onUnload() {}
};

export { renderStaffPanel };
export default moduleManifest;


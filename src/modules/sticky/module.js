import { z } from 'zod';
import { handleStickyMessage } from './engine.js';
import { buildStickyPanel } from './panel.js';

export const moduleManifest = {
  id: 'sticky',
  name: 'Sticky Messages',
  version: '1.0.0',
  description: 'Persistent sticky messages locked to the bottom of active chat channels',
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
    saved: 'Sticky note updated.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Sticky messages engine operational' };
  },
  async onLoad({ logger }) {
    logger.debug('Sticky messages module loaded.');
  },
  async onUnload() {}
};

export { handleStickyMessage, buildStickyPanel };
export default moduleManifest;


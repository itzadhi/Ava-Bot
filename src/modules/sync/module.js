import { z } from 'zod';
import { handleMessageSync, handleRoleAssignSync } from './dispatcher.js';

export const moduleManifest = {
  id: 'sync',
  name: 'Multi-Server Sync',
  version: '1.0.0',
  description: 'Cross-server configuration, role, and channel template replication engine',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {
    messageCreate: handleMessageSync,
    guildMemberUpdate: handleRoleAssignSync
  },
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true)
  }),
  copy: {
    synced: 'Network synchronized.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Sync subsystem operational' };
  },
  async onLoad({ logger }) {
    logger.debug('Sync module loaded.');
  },
  async onUnload() {}
};

export { handleMessageSync, handleRoleAssignSync };
export default moduleManifest;


import { backupModule } from './index.js';
import { z } from 'zod';

export const moduleManifest = {
  id: 'backup',
  name: 'Backup',
  version: '1.0.0',
  description: 'Universal cross-server snapshot, restore, and automated rotation engine',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: backupModule.commands || [],
  components: backupModule.components || [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    maxBackupsPerGuild: z.number().default(10)
  }),
  copy: {
    backupCreated: 'Server backup snapshot created successfully.',
    backupRestored: 'Server backup restoration has completed.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Backup system ready' };
  },
  async onLoad({ logger }) {
    logger.debug('Backup module loaded.');
  },
  async onUnload() {}
};

export default moduleManifest;

import { z } from 'zod';
import { handleStickyRoleMemberRejoin, handleStickyRoleMemberLeave } from './engine.js';
import { buildStickyRolesPanel } from './panel.js';

export const moduleManifest = {
  id: 'stickyroles',
  name: 'Sticky Roles',
  version: '1.0.0',
  description: 'Automatically re-assigns roles to members when they re-join the server',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {
    guildMemberAdd: handleStickyRoleMemberRejoin,
    guildMemberRemove: handleStickyRoleMemberLeave
  },
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(false)
  }),
  copy: {
    restored: 'Roles successfully restored.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Sticky roles engine operational' };
  },
  async onLoad({ logger }) {
    logger.debug('Sticky roles module loaded.');
  },
  async onUnload() {}
};

export { handleStickyRoleMemberRejoin, handleStickyRoleMemberLeave, buildStickyRolesPanel };
export default moduleManifest;


import { z } from 'zod';
import { handleAutoRoleMemberJoin } from './engine.js';
import { buildAutoRolePanel } from './panel.js';

export const moduleManifest = {
  id: 'autorole',
  name: 'AutoRole',
  version: '1.0.0',
  description: 'Automated role assignment engine for new members and bots with hierarchy protection',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [
    {
      customId: 'autorole:*',
      type: 'any',
      async execute(interaction, args) {
        return handleAutoRoleInteraction(interaction, args);
      }
    }
  ],
  events: {
    guildMemberAdd: handleAutoRoleMemberJoin
  },
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(false),
    memberRoles: z.array(z.string()).default([]),
    botRole: z.string().nullable().default(null)
  }),
  copy: {
    assigned: 'Role assigned automatically upon join.'
  },
  async healthCheck() {
    return { healthy: true, details: 'AutoRole engine active' };
  },
  async onLoad({ logger }) {
    logger.debug('AutoRole module loaded.');
  },
  async onUnload() {}
};

export { handleAutoRoleMemberJoin, buildAutoRolePanel };
export default moduleManifest;

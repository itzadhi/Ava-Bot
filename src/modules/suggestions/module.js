import { z } from 'zod';
import {
  handleSuggestionVote,
  handleSuggestionModeration,
  checkStaffPermission,
  buildSuggestionCard,
  postSuggestionMessage
} from './index.js';

export const moduleManifest = {
  id: 'suggestions',
  name: 'Suggestions',
  version: '1.0.0',
  description: 'Server community suggestions, upvoting/downvoting, staff approvals, and status tracking',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    channelId: z.string().nullable().default(null)
  }),
  copy: {
    submitted: 'Your suggestion has been posted for community review.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Suggestions system active' };
  },
  async onLoad({ logger }) {
    logger.debug('Suggestions module loaded.');
  },
  async onUnload() {}
};

export {
  handleSuggestionVote,
  handleSuggestionModeration,
  checkStaffPermission,
  buildSuggestionCard,
  postSuggestionMessage
};
export default moduleManifest;

import { z } from 'zod';
import {
  buildFeedbackCard,
  buildFeedbackModal,
  handleFeedbackModalSubmit,
  handleFeedbackSkipImage,
  handleFeedbackAction,
  handleFeedbackReplySubmit,
  postFeedbackMessage
} from './index.js';

export const moduleManifest = {
  id: 'feedback',
  name: 'Feedback',
  version: '1.0.0',
  description: 'Community feedback submission, star ratings, image proof attachments, and staff response workflow',
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
    submitted: 'Thank you for your feedback!'
  },
  async healthCheck() {
    return { healthy: true, details: 'Feedback system active' };
  },
  async onLoad({ logger }) {
    logger.debug('Feedback module loaded.');
  },
  async onUnload() {}
};

export {
  buildFeedbackCard,
  buildFeedbackModal,
  handleFeedbackModalSubmit,
  handleFeedbackSkipImage,
  handleFeedbackAction,
  handleFeedbackReplySubmit,
  postFeedbackMessage
};
export default moduleManifest;

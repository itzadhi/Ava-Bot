import { z } from 'zod';
import { handleVoiceStateUpdate, reconcileTempChannels } from './jtc.js';

export const moduleManifest = {
  id: 'voice',
  name: 'Voice & JTC',
  version: '1.0.0',
  description: 'Dynamic temporary voice channel (Join-to-Create) engine with permission controls and TTS',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {
    voiceStateUpdate: handleVoiceStateUpdate
  },
  jobs: [],
  migrations: [],
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    creatorChannelId: z.string().nullable().default(null)
  }),
  copy: {
    channelCreated: 'Your personal temporary voice channel has been created.'
  },
  async healthCheck() {
    return { healthy: true, details: 'Voice architecture active' };
  },
  async onLoad({ client, logger }) {
    if (client) {
      await reconcileTempChannels(client).catch(err => {
        logger.warn({ err }, 'Error during voice channel startup reconciliation');
      });
      logger.debug('Voice module loaded.');
    }
  },
  async onUnload() {}
};

export { handleVoiceStateUpdate, reconcileTempChannels };
export default moduleManifest;

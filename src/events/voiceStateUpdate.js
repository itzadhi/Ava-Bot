import { handleVoiceStateUpdate } from '../modules/voice/jtc.js';
import { logger } from '../utils/logger.js';

export async function onVoiceStateUpdate(oldState, newState) {
  try {
    await handleVoiceStateUpdate(oldState, newState);
  } catch (err) {
    logger.error({ err }, 'Error in voiceStateUpdate handler');
  }
}

export default onVoiceStateUpdate;

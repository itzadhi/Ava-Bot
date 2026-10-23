import * as googleTTS from 'google-tts-api';
import { Readable } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { getVoice, applyAudioFilter } from './voices.js';

// Ensure ffmpeg-static path is registered for audio transcoding
if (ffmpegPath && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegPath;
}

/**
 * Base abstract TTS Provider
 */
export class TTSProvider {
  /**
   * Synthesizes text into an audio Buffer or Readable stream
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.language='en']
   * @param {string} [options.voice='en-us']
   * @param {number} [options.speed=1]
   * @returns {Promise<{ stream: import('node:stream').Readable, buffer: Buffer, format: string, voice: string }>}
   */
  async synthesize(text, options = {}) {
    throw new Error('Method synthesize() must be implemented by provider');
  }
}

/**
 * Enhanced Multi-Voice Google Translate & Local DSP TTS Provider
 * Supports multiple regional accents & DSP character voices without API keys or paid accounts.
 */
export class GoogleTTSProvider extends TTSProvider {
  constructor(defaultLang = 'en') {
    super();
    this.defaultLang = defaultLang;
  }

  /**
   * Synthesizes audio with optional character audio filtering
   * @param {string} text
   * @param {object} [options]
   * @param {string} [options.language]
   * @param {string} [options.voice]
   * @returns {Promise<{ stream: import('node:stream').Readable, buffer: Buffer, format: string, voice: string }>}
   */
  async synthesize(text, options = {}) {
    const rawVoice = options.voice || options.language || this.defaultLang || 'en';
    const voiceConfig = getVoice(rawVoice);
    const lang = voiceConfig.baseLang || 'en';

    const cleanText = text.slice(0, 200).trim();
    if (!cleanText) {
      throw new Error('TTS text cannot be empty');
    }

    let initialBuffer = null;

    try {
      // Fetch base64 audio from free Google TTS endpoint
      const base64Audio = await googleTTS.getAudioBase64(cleanText, {
        lang,
        slow: false,
        host: 'https://translate.google.com',
        timeout: 10000
      });

      initialBuffer = Buffer.from(base64Audio, 'base64');
    } catch (err) {
      // Fallback: try direct audio URL stream
      const audioUrl = googleTTS.getAudioUrl(cleanText, {
        lang,
        slow: false,
        host: 'https://translate.google.com'
      });

      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Google TTS request failed with HTTP ${response.status}`, { cause: err });
      }
      const arrayBuffer = await response.arrayBuffer();
      initialBuffer = Buffer.from(arrayBuffer);
    }

    // Apply local FFmpeg DSP filter if the voice profile specifies one (e.g. Robot, Chipmunk, Demon)
    let finalBuffer = initialBuffer;
    if (voiceConfig.filter) {
      finalBuffer = await applyAudioFilter(initialBuffer, voiceConfig.filter);
    }

    const stream = Readable.from(finalBuffer);
    return {
      stream,
      buffer: finalBuffer,
      format: 'mp3',
      voice: voiceConfig.id
    };
  }
}

export const defaultTTSProvider = new GoogleTTSProvider('en');
export default defaultTTSProvider;

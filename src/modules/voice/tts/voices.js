import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { logger } from '../../../utils/logger.js';

/**
 * Master catalog of TTS voices available out of the box with zero API keys or external paid accounts.
 * Combines regional accents (via free web TTS) and local FFmpeg DSP audio filters.
 */
export const TTS_VOICES = {
  // ── CHARACTER & FX VOICES (Processed locally via FFmpeg DSP - 0 External APIs) ──
  robot: {
    id: 'robot',
    name: 'Cyber Robot',
    emoji: '🤖',
    category: 'Character & FX',
    description: 'Cybernetic android voice with metallic chorus & flanger',
    baseLang: 'en',
    filter: 'chorus=0.7:0.9:55:0.4:0.25:2,flanger=delay=5:speed=2,treble=g=4',
    aliases: ['cyborg', 'droid', 'android', 'bot']
  },
  chipmunk: {
    id: 'chipmunk',
    name: 'Chipmunk',
    emoji: '🐿️',
    category: 'Character & FX',
    description: 'High-pitched cute and energetic chipmunk voice',
    baseLang: 'en',
    filter: 'asetrate=44100*1.38,atempo=1/1.38',
    aliases: ['high', 'cute', 'squeaky']
  },
  deep: {
    id: 'deep',
    name: 'Deep Demon',
    emoji: '👹',
    category: 'Character & FX',
    description: 'Low-pitched ominous resonant demon voice',
    baseLang: 'en',
    filter: 'asetrate=44100*0.72,atempo=1/0.72,bass=g=6',
    aliases: ['demon', 'monster', 'low', 'evil', 'baritone']
  },
  giant: {
    id: 'giant',
    name: 'Titan Giant',
    emoji: '🗿',
    category: 'Character & FX',
    description: 'Ultra-deep rumbling titan voice with heavy low-end bass',
    baseLang: 'en',
    filter: 'asetrate=44100*0.6,atempo=1/0.6,bass=g=8',
    aliases: ['titan', 'colossus', 'huge']
  },
  radio: {
    id: 'radio',
    name: 'Walkie-Talkie',
    emoji: '📻',
    category: 'Character & FX',
    description: 'Vintage tactical walkie-talkie & radio filter',
    baseLang: 'en',
    filter: 'highpass=f=900,lowpass=f=3100,volume=1.5',
    aliases: ['walkie', 'police', 'military', 'comm']
  },
  echo: {
    id: 'echo',
    name: 'Grand Echo',
    emoji: '🌌',
    category: 'Character & FX',
    description: 'Deep cavernous cathedral echo & spatial reverb',
    baseLang: 'en',
    filter: 'aecho=0.8:0.88:60:0.4',
    aliases: ['cave', 'reverb', 'hall', 'space']
  },
  fast: {
    id: 'fast',
    name: 'Turbo Announcer',
    emoji: '⚡',
    category: 'Character & FX',
    description: 'Fast-paced speedrun commentary voice',
    baseLang: 'en',
    filter: 'atempo=1.4',
    aliases: ['speedy', 'quick', 'turbo']
  },
  slow: {
    id: 'slow',
    name: 'Sloth Calm',
    emoji: '🦥',
    category: 'Character & FX',
    description: 'Relaxed slow-motion calm voice',
    baseLang: 'en',
    filter: 'atempo=0.75',
    aliases: ['sloth', 'chill', 'sleepy']
  },
  helium: {
    id: 'helium',
    name: 'Helium Balloon',
    emoji: '🎈',
    category: 'Character & FX',
    description: 'Ultra high-pitch squeak like inhaling helium',
    baseLang: 'en',
    filter: 'asetrate=44100*1.55,atempo=1/1.55',
    aliases: ['squeak', 'balloon']
  },
  whisper: {
    id: 'whisper',
    name: 'Whisper Soft',
    emoji: '🤫',
    category: 'Character & FX',
    description: 'Muffled low-pass soft tone',
    baseLang: 'en',
    filter: 'lowpass=f=1200,volume=1.3',
    aliases: ['soft', 'quiet']
  },
  alien: {
    id: 'alien',
    name: 'Sci-Fi Alien',
    emoji: '👽',
    category: 'Character & FX',
    description: 'Extraterrestrial warbled vibrato tone',
    baseLang: 'en',
    filter: 'vibrato=f=8:d=0.5,chorus=0.5:0.9:50:0.4:0.25:2',
    aliases: ['extraterrestrial', 'ufo']
  },
  telephone: {
    id: 'telephone',
    name: 'Vintage Phone',
    emoji: '☎️',
    category: 'Character & FX',
    description: 'Analog telephone receiver line quality',
    baseLang: 'en',
    filter: 'highpass=f=400,lowpass=f=3400,acontrast=30',
    aliases: ['phone', 'call']
  },

  // ── REGIONAL ACCENTS & LANGUAGES (Free Web Endpoints - 0 API Keys) ──
  'en-us': {
    id: 'en-us',
    name: 'American English',
    emoji: '🇺🇸',
    category: 'Accents & Languages',
    description: 'Standard United States English accent',
    baseLang: 'en',
    filter: null,
    aliases: ['us', 'american', 'en', 'usa', 'default']
  },
  'en-uk': {
    id: 'en-uk',
    name: 'British English',
    emoji: '🇬🇧',
    category: 'Accents & Languages',
    description: 'United Kingdom British English accent',
    baseLang: 'en-GB',
    filter: null,
    aliases: ['uk', 'british', 'gb', 'england']
  },
  'en-au': {
    id: 'en-au',
    name: 'Australian English',
    emoji: '🇦🇺',
    category: 'Accents & Languages',
    description: 'Australian accent',
    baseLang: 'en-AU',
    filter: null,
    aliases: ['au', 'australian', 'aussie']
  },
  'en-in': {
    id: 'en-in',
    name: 'Indian English',
    emoji: '🇮🇳',
    category: 'Accents & Languages',
    description: 'Indian English accent',
    baseLang: 'en-IN',
    filter: null,
    aliases: ['in', 'indian', 'india']
  },
  'en-ca': {
    id: 'en-ca',
    name: 'Canadian English',
    emoji: '🇨🇦',
    category: 'Accents & Languages',
    description: 'Canadian English accent',
    baseLang: 'en-CA',
    filter: null,
    aliases: ['ca', 'canadian', 'canada']
  },
  ja: {
    id: 'ja',
    name: 'Japanese',
    emoji: '🇯🇵',
    category: 'Accents & Languages',
    description: 'Japanese pronunciation and voice',
    baseLang: 'ja',
    filter: null,
    aliases: ['japanese', 'jp']
  },
  es: {
    id: 'es',
    name: 'Spanish',
    emoji: '🇪🇸',
    category: 'Accents & Languages',
    description: 'Spanish pronunciation and voice',
    baseLang: 'es',
    filter: null,
    aliases: ['spanish', 'esp']
  },
  fr: {
    id: 'fr',
    name: 'French',
    emoji: '🇫🇷',
    category: 'Accents & Languages',
    description: 'French pronunciation and voice',
    baseLang: 'fr',
    filter: null,
    aliases: ['french', 'fra']
  },
  de: {
    id: 'de',
    name: 'German',
    emoji: '🇩🇪',
    category: 'Accents & Languages',
    description: 'German pronunciation and voice',
    baseLang: 'de',
    filter: null,
    aliases: ['german', 'ger']
  },
  it: {
    id: 'it',
    name: 'Italian',
    emoji: '🇮🇹',
    category: 'Accents & Languages',
    description: 'Italian pronunciation and voice',
    baseLang: 'it',
    filter: null,
    aliases: ['italian', 'ita']
  },
  ru: {
    id: 'ru',
    name: 'Russian',
    emoji: '🇷🇺',
    category: 'Accents & Languages',
    description: 'Russian pronunciation and voice',
    baseLang: 'ru',
    filter: null,
    aliases: ['russian', 'rus']
  },
  ko: {
    id: 'ko',
    name: 'Korean',
    emoji: '🇰🇷',
    category: 'Accents & Languages',
    description: 'Korean pronunciation and voice',
    baseLang: 'ko',
    filter: null,
    aliases: ['korean', 'kor']
  },
  pt: {
    id: 'pt',
    name: 'Portuguese',
    emoji: '🇵🇹',
    category: 'Accents & Languages',
    description: 'Portuguese pronunciation and voice',
    baseLang: 'pt',
    filter: null,
    aliases: ['portuguese', 'por']
  },
  hi: {
    id: 'hi',
    name: 'Hindi',
    emoji: '🇮🇳',
    category: 'Accents & Languages',
    description: 'Hindi pronunciation and voice',
    baseLang: 'hi',
    filter: null,
    aliases: ['hindi']
  },
  zh: {
    id: 'zh',
    name: 'Chinese',
    emoji: '🇨🇳',
    category: 'Accents & Languages',
    description: 'Chinese (Mandarin) pronunciation and voice',
    baseLang: 'zh-CN',
    filter: null,
    aliases: ['chinese', 'mandarin', 'cmn']
  },
  ar: {
    id: 'ar',
    name: 'Arabic',
    emoji: '🇸🇦',
    category: 'Accents & Languages',
    description: 'Arabic pronunciation and voice',
    baseLang: 'ar',
    filter: null,
    aliases: ['arabic']
  },
  nl: {
    id: 'nl',
    name: 'Dutch',
    emoji: '🇳🇱',
    category: 'Accents & Languages',
    description: 'Dutch pronunciation and voice',
    baseLang: 'nl',
    filter: null,
    aliases: ['dutch']
  },
  tr: {
    id: 'tr',
    name: 'Turkish',
    emoji: '🇹🇷',
    category: 'Accents & Languages',
    description: 'Turkish pronunciation and voice',
    baseLang: 'tr',
    filter: null,
    aliases: ['turkish']
  },
  sv: {
    id: 'sv',
    name: 'Swedish',
    emoji: '🇸🇪',
    category: 'Accents & Languages',
    description: 'Swedish pronunciation and voice',
    baseLang: 'sv',
    filter: null,
    aliases: ['swedish']
  },
  pl: {
    id: 'pl',
    name: 'Polish',
    emoji: '🇵🇱',
    category: 'Accents & Languages',
    description: 'Polish pronunciation and voice',
    baseLang: 'pl',
    filter: null,
    aliases: ['polish']
  }
};

/**
 * Resolves a voice by its ID, code, or alias
 * @param {string} [idOrAlias]
 * @returns {typeof TTS_VOICES['en-us']}
 */
export function getVoice(idOrAlias) {
  if (!idOrAlias || typeof idOrAlias !== 'string') {
    return TTS_VOICES['en-us'];
  }

  const query = idOrAlias.toLowerCase().trim();

  // 1. Direct match on ID
  if (TTS_VOICES[query]) {
    return TTS_VOICES[query];
  }

  // 2. Case-insensitive alias match
  for (const voice of Object.values(TTS_VOICES)) {
    if (voice.id.toLowerCase() === query) return voice;
    if (voice.aliases && voice.aliases.some(a => a.toLowerCase() === query)) {
      return voice;
    }
  }

  // 3. Fallback: if it starts with 'en' or other language code
  if (query.startsWith('en')) return TTS_VOICES['en-us'];

  return TTS_VOICES['en-us'];
}

/**
 * Returns all available voices grouped by category
 * @returns {Record<string, Array<typeof TTS_VOICES['en-us']>>}
 */
export function listVoicesByCategory() {
  const categories = {
    'Character & FX': [],
    'Accents & Languages': []
  };

  for (const voice of Object.values(TTS_VOICES)) {
    if (!categories[voice.category]) {
      categories[voice.category] = [];
    }
    categories[voice.category].push(voice);
  }

  return categories;
}

/**
 * Returns a flat array of all voice choices for slash commands
 * @returns {Array<{ name: string, value: string }>}
 */
export function getVoiceChoices() {
  return Object.values(TTS_VOICES).map(v => ({
    name: `${v.emoji} ${v.name} (${v.id})`,
    value: v.id
  }));
}

/**
 * Applies a local FFmpeg audio filter to an audio buffer in real time with zero external API calls.
 * If FFmpeg fails or is unavailable, resolves with the input buffer safely.
 * @param {Buffer} inputBuffer
 * @param {string} filterString
 * @returns {Promise<Buffer>}
 */
export function applyAudioFilter(inputBuffer, filterString) {
  if (!filterString || !ffmpegPath || !Buffer.isBuffer(inputBuffer)) {
    return Promise.resolve(inputBuffer);
  }

  return new Promise((resolve) => {
    try {
      const ff = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-af', filterString,
        '-f', 'mp3',
        'pipe:1'
      ]);

      const chunks = [];
      let hasError = false;

      ff.stdout.on('data', chunk => chunks.push(chunk));
      
      ff.on('error', (err) => {
        hasError = true;
        logger.warn({ err }, 'Failed to spawn FFmpeg process for TTS audio filtering, falling back to clean audio');
        resolve(inputBuffer);
      });

      ff.on('close', (code) => {
        if (!hasError && code === 0 && chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          resolve(inputBuffer);
        }
      });

      ff.stdin.on('error', () => {
        // Suppress EPIPE errors if FFmpeg terminates early
        resolve(inputBuffer);
      });

      ff.stdin.end(inputBuffer);
    } catch (err) {
      logger.warn({ err }, 'Exception while running audio filter, returning original audio');
      resolve(inputBuffer);
    }
  });
}

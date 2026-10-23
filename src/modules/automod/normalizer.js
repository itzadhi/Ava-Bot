import safeRegex from 'safe-regex2';

// Cyrillic & Greek homoglyphs mapping to Latin
const HOMOGLYPHS = {
  'а': 'a', 'а': 'a', 'в': 'b', 'с': 'c', 'е': 'e', 'н': 'h', 'і': 'i',
  'ј': 'j', 'к': 'k', 'м': 'm', 'о': 'o', 'р': 'p', 'ѕ': 's', 'т': 't',
  'у': 'y', 'х': 'x', 'г': 'r', 'і': 'i', 'ї': 'i', 'ѵ': 'v', 'α': 'a',
  'β': 'b', 'γ': 'y', 'ε': 'e', 'η': 'n', 'ι': 'i', 'κ': 'k', 'ο': 'o',
  'ρ': 'p', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w'
};

// Leetspeak mapping
const LEETSPEAK = {
  '@': 'a', '4': 'a', '^': 'a',
  '8': 'b', 'ß': 'b',
  '(': 'c', '<': 'c', '{': 'c', '[': 'c',
  '3': 'e', '€': 'e',
  '9': 'g', '6': 'g',
  '#': 'h',
  '1': 'i', '!': 'i', '|': 'i', 'l': 'i',
  '0': 'o',
  '5': 's', '$': 's', 'z': 's',
  '7': 't', '+': 't',
  'v': 'u', 'µ': 'u'
};

/**
 * Strips zero-width chars and invisible unicode separators
 * @param {string} text
 * @returns {string}
 */
export function stripZeroWidth(text) {
  if (!text) return '';
  return text.replace(/[\u200B-\u200F\uFEFF\u202A-\u202E\u00AD\u2060-\u206F\u180E]/g, '');
}

/**
 * Masks the middle letters of a prohibited word or slur for logs
 * e.g. "bitch" -> "b***h", "ass" -> "a*s", "it" -> "i*"
 * @param {string} word
 * @returns {string}
 */
export function maskSlur(word) {
  if (!word || typeof word !== 'string') return '***';
  const clean = word.trim();
  if (clean.length <= 2) return `${clean[0]}*`;
  return `${clean[0]}${'*'.repeat(clean.length - 2)}${clean[clean.length - 1]}`;
}

/**
 * Comprehensive normalization pipeline:
 * 1. Unicode NFKC normalization
 * 2. Lowercase
 * 3. Strip zero-width & invisible characters
 * 4. Strip diacritical marks/accents
 * 5. Map homoglyphs (Cyrillic/Greek to ASCII)
 * 6. Map Leetspeak (symbols/digits to Latin letters)
 * 7. Collapse character repetitions (e.g. "fuuuuck" -> "fuck")
 * 8. Detect and collapse separated letters (e.g. "f.u.c.k", "f u c k", "f_u_c_k" -> "fuck")
 *
 * @param {string} text
 * @returns {{ raw: string, normalized: string, deSpaced: string, collapsed: string }}
 */
export function normalizeText(text) {
  if (!text || typeof text !== 'string') {
    return { raw: '', normalized: '', deSpaced: '', collapsed: '' };
  }

  // 1. Unicode NFKC & lowercase
  let str = text.normalize('NFKC').toLowerCase();

  // 2. Strip zero-width characters
  str = stripZeroWidth(str);

  // 3. Strip diacritics
  str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 4. Map homoglyphs
  let homoglyphMapped = '';
  for (const char of str) {
    homoglyphMapped += HOMOGLYPHS[char] || char;
  }

  // 5. Map leetspeak
  let leetMapped = '';
  for (const char of homoglyphMapped) {
    leetMapped += LEETSPEAK[char] || char;
  }

  // 6. Collapse repeated characters (3+ identical into 1)
  const collapsed = leetMapped.replace(/(.)\1{2,}/g, '$1$1');

  // 7. Detect separated letters: "f u c k" or "f.u.c.k" or "f_u_c_k"
  // Match single letters separated by space or punctuation
  const deSpaced = collapsed.replace(/\b([a-z])[\s._\-~*#^/\\|]+([a-z])\b/gi, '$1$2')
                            .replace(/\b([a-z])[\s._\-~*#^/\\|]+([a-z])\b/gi, '$1$2')
                            .replace(/\b([a-z])[\s._\-~*#^/\\|]+([a-z])\b/gi, '$1$2');

  return {
    raw: text,
    normalized: leetMapped,
    deSpaced,
    collapsed
  };
}

/**
 * Checks if a word or phrase matches text considering match type and allowlist
 * @param {string} text Raw or normalized text
 * @param {string} pattern The banned word or pattern
 * @param {'word'|'substring'|'wildcard'} matchType
 * @param {string[]} allowlist List of false-positive words allowed
 * @returns {{ matched: boolean, term?: string }}
 */
export function testWordMatch(text, pattern, matchType = 'word', allowlist = []) {
  if (!text || !pattern) return { matched: false };
  const target = pattern.trim().toLowerCase();
  if (!target) return { matched: false };

  const norm = normalizeText(text);
  const candidates = [norm.normalized, norm.deSpaced, norm.collapsed, text.toLowerCase()];

  // Check allowlist
  for (const allowed of allowlist) {
    const cleanAllowed = (allowed || '').trim().toLowerCase();
    if (!cleanAllowed) continue;
    // If the target word is merely part of an allowed word present in text, bypass
    if (cleanAllowed.includes(target)) {
      for (const cand of candidates) {
        if (cand.includes(cleanAllowed)) {
          return { matched: false };
        }
      }
    }
  }

  // Wildcard match (e.g. "bad*")
  if (matchType === 'wildcard' || target.includes('*')) {
    const regexSafe = target.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    const regex = new RegExp(`\\b${regexSafe}\\b`, 'i');
    for (const cand of candidates) {
      if (regex.test(cand)) return { matched: true, term: target };
    }
    return { matched: false };
  }

  // Substring match
  if (matchType === 'substring') {
    for (const cand of candidates) {
      if (cand.includes(target)) {
        return { matched: true, term: target };
      }
    }
    return { matched: false };
  }

  // Whole word match by default
  const wordRegex = new RegExp(`(?:\\b|_|\\W)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\b|_|\\W)`, 'i');
  for (const cand of candidates) {
    if (wordRegex.test(` ${cand} `)) {
      return { matched: true, term: target };
    }
  }

  return { matched: false };
}

/**
 * Validates a custom regular expression pattern for syntax and ReDoS safety
 * @param {string} pattern
 * @param {string} [flags='i']
 * @returns {{ valid: boolean, error?: string, regex?: RegExp }}
 */
export function validateRegexPattern(pattern, flags = 'i') {
  if (!pattern || typeof pattern !== 'string') {
    return { valid: false, error: 'Pattern cannot be empty' };
  }

  if (pattern.length > 200) {
    return { valid: false, error: 'Pattern exceeds maximum length of 200 characters' };
  }

  // 1. Syntax check
  let compiled;
  try {
    compiled = new RegExp(pattern, flags);
  } catch (err) {
    return { valid: false, error: `Invalid Regular Expression syntax: ${err.message}` };
  }

  // 2. ReDoS check via safe-regex2
  try {
    const isSafe = safeRegex(pattern);
    if (!isSafe) {
      return {
        valid: false,
        error: 'Pattern rejected: Catastrophic backtracking detected (potential ReDoS risk).'
      };
    }
  } catch (_) {
    return { valid: false, error: 'Safety verification failed for this regex.' };
  }

  return { valid: true, regex: compiled };
}

/**
 * Safely executes a regular expression against text with an execution timeout guard
 * @param {RegExp} regex
 * @param {string} text
 * @param {number} [timeoutMs=50]
 * @returns {{ matched: boolean, matchText?: string }}
 */
export function safeRegexExec(regex, text, timeoutMs = 50) {
  if (!regex || !text) return { matched: false };

  const start = Date.now();
  try {
    const match = regex.exec(text);
    if (Date.now() - start > timeoutMs) {
      return { matched: false };
    }
    if (match) {
      return { matched: true, matchText: match[0], match };
    }
  } catch (_) {
    return { matched: false };
  }

  return { matched: false };
}

export default {
  stripZeroWidth,
  maskSlur,
  normalizeText,
  testWordMatch,
  validateRegexPattern,
  safeRegexExec
};

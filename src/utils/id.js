import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Excludes 0, 1, I, O to prevent confusion

/**
 * Generates a short, human-friendly ID (e.g. A7K2-9QXM)
 * @param {number} segmentLength Length of each segment
 * @param {number} segments Number of segments
 * @returns {string}
 */
export function generateShortId(segmentLength = 4, segments = 2) {
  const parts = [];
  const randomBytes = crypto.randomBytes(segmentLength * segments);
  let byteIndex = 0;

  for (let i = 0; i < segments; i++) {
    let segment = '';
    for (let j = 0; j < segmentLength; j++) {
      const byte = randomBytes[byteIndex++];
      segment += ALPHABET[byte % ALPHABET.length];
    }
    parts.push(segment);
  }

  return parts.join('-');
}

export default generateShortId;

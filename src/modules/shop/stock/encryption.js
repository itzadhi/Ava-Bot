import crypto from 'node:crypto';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM

/**
 * Resolves the 32-byte encryption key buffer from hex or utf-8 string
 * @param {string} [customKey]
 * @returns {Buffer}
 */
export function resolveKey(customKey = null) {
  const rawKey = customKey || config.SHOP_ENCRYPTION_KEY || config.DATA_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error('SHOP_ENCRYPTION_KEY_MISSING: Cannot handle item stock without SHOP_ENCRYPTION_KEY set in .env');
  }

  // If 64 hex characters (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }

  // Otherwise SHA-256 hash to guarantee exactly 32 bytes
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts a stock item deliverable (account, license key, credentials) using AES-256-GCM
 * @param {string} plainText
 * @param {string} [customKey]
 * @returns {{ ciphertext: string, iv: string, tag: string }}
 */
export function encryptItem(plainText, customKey = null) {
  if (typeof plainText !== 'string' || !plainText) {
    throw new Error('Plain text item content is required for encryption');
  }

  const key = resolveKey(customKey);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(plainText, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const tag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext,
    iv: iv.toString('hex'),
    tag
  };
}

/**
 * Decrypts a stock item deliverable using AES-256-GCM
 * @param {{ ciphertext: string, iv: string, tag: string }} item
 * @param {string} [customKey]
 * @returns {string}
 */
export function decryptItem({ ciphertext, iv, tag }, customKey = null) {
  if (!ciphertext || !iv || !tag) {
    throw new Error('Invalid encrypted item payload: ciphertext, iv, and tag are required');
  }

  const key = resolveKey(customKey);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Safely masks a deliverable item for logging, dashboards, or receipts without exposing secrets.
 * e.g., 'ABCDE-FGHIJ-KLMNO-PQRST' -> 'ABCDE-****-****-QRST'
 * e.g., 'user@gmail.com:pass123' -> 'use****@gmail.com:****'
 * @param {string} itemText
 * @returns {string}
 */
export function maskItem(itemText) {
  if (!itemText || typeof itemText !== 'string') return '****';
  const trimmed = itemText.trim();
  if (trimmed.length <= 6) return '****';

  // If email:password
  if (trimmed.includes(':') && trimmed.includes('@')) {
    const [email, pass] = trimmed.split(':');
    const [name, domain] = email.split('@');
    const maskedName = name.slice(0, 2) + '****';
    return `${maskedName}@${domain || '****'}:****`;
  }

  // If delimited license key (hyphenated)
  if (trimmed.includes('-')) {
    const parts = trimmed.split('-');
    if (parts.length >= 3) {
      return `${parts[0]}-${parts.slice(1, -1).map(() => '****').join('-')}-${parts[parts.length - 1]}`;
    }
  }

  // Generic string
  const start = trimmed.slice(0, 3);
  const end = trimmed.slice(-3);
  return `${start}****${end}`;
}

/**
 * Generates a cryptographically secure 32-byte hex key for .env SHOP_ENCRYPTION_KEY
 * @returns {string}
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

export default {
  resolveKey,
  encryptItem,
  decryptItem,
  maskItem,
  generateEncryptionKey
};

import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { config } from '../config.js';

const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.gunzip);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derives a consistent 32-byte key from DATA_ENCRYPTION_KEY using SHA-256
 */
function getKey() {
  return crypto.createHash('sha256').update(String(config.DATA_ENCRYPTION_KEY)).digest();
}

/**
 * Encrypts a Buffer or string using AES-256-GCM
 * @param {Buffer|string} data 
 * @returns {Buffer} [IV (12 bytes) + AuthTag (16 bytes) + EncryptedData]
 */
export function encryptData(data) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const inputBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts a Buffer produced by encryptData
 * @param {Buffer} buffer 
 * @returns {Buffer}
 */
export function decryptData(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }
  const key = getKey();
  const iv = buffer.subarray(0, IV_LENGTH);
  const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Compresses an object or string to gzipped buffer
 * @param {object|string} data 
 * @returns {Promise<Buffer>}
 */
export async function compressJson(data) {
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return gzipAsync(Buffer.from(str, 'utf8'));
}

/**
 * Decompresses a gzipped buffer to parsed JSON object
 * @param {Buffer} buffer 
 * @returns {Promise<any>}
 */
export async function decompressJson(buffer) {
  const decompressed = await gunzipAsync(buffer);
  return JSON.parse(decompressed.toString('utf8'));
}

/**
 * Compresses and then encrypts an object
 * @param {object|string} data 
 * @returns {Promise<Buffer>}
 */
export async function compressAndEncrypt(data) {
  const compressed = await compressJson(data);
  return encryptData(compressed);
}

/**
 * Decrypts and decompresses a buffer back to an object
 * @param {Buffer} buffer 
 * @returns {Promise<any>}
 */
export async function decryptAndDecompress(buffer) {
  const decrypted = decryptData(buffer);
  return decompressJson(decrypted);
}

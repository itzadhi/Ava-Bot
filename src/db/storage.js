import { db } from './client.js';
import { logger } from '../utils/logger.js';
import { compressJson, decompressJson, compressAndEncrypt, decryptAndDecompress } from '../services/crypto.js';

const BUCKET_NAME = 'backups';

let bucketChecked = false;

export async function ensureBucketExists() {
  if (bucketChecked) return;
  try {
    const { data: bucket, error } = await db.storage.getBucket(BUCKET_NAME);
    if (error || !bucket) {
      logger.info(`Storage bucket "${BUCKET_NAME}" not found, creating bucket...`);
      const { error: createError } = await db.storage.createBucket(BUCKET_NAME, {
        public: false
      });
      if (!createError || createError.message?.includes('already exists')) {
        logger.info(`✓ Private storage bucket "${BUCKET_NAME}" ready`);
      }
    }
    bucketChecked = true;
  } catch (err) {
    logger.warn({ err }, 'Warning during storage bucket verification');
  }
}

/**
 * Uploads a snapshot object to Supabase storage (gzipped)
 * @param {string} storagePath 
 * @param {object} snapshotData 
 * @param {boolean} encrypt Whether to apply AES-256-GCM encryption (e.g. for chatlogs/message sync)
 * @returns {Promise<{ path: string, sizeBytes: number }>}
 */
export async function uploadSnapshot(storagePath, snapshotData, encrypt = false) {
  await ensureBucketExists();

  const buffer = encrypt
    ? await compressAndEncrypt(snapshotData)
    : await compressJson(snapshotData);

  let { data, error } = await db.storage
    .from(BUCKET_NAME)
    .upload(storagePath, buffer, {
      contentType: 'application/gzip',
      upsert: true
    });

  if (error && error.message?.toLowerCase().includes('bucket not found')) {
    bucketChecked = false;
    await ensureBucketExists();
    const retry = await db.storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, {
        contentType: 'application/gzip',
        upsert: true
      });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    logger.error({ error, storagePath }, 'Error uploading snapshot to Supabase storage');
    throw error;
  }

  return {
    path: storagePath,
    sizeBytes: buffer.length
  };
}

/**
 * Downloads and parses a snapshot from Supabase storage
 * @param {string} storagePath 
 * @param {boolean} encrypted Whether the snapshot was encrypted
 * @returns {Promise<any>}
 */
export async function downloadSnapshot(storagePath, encrypted = false) {
  const { data, error } = await db.storage
    .from(BUCKET_NAME)
    .download(storagePath);

  if (error || !data) {
    logger.error({ error, storagePath }, 'Error downloading snapshot from Supabase storage');
    throw error || new Error('No data received from storage');
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (encrypted) {
    return decryptAndDecompress(buffer);
  } else {
    return decompressJson(buffer);
  }
}

/**
 * Deletes a snapshot file from Supabase storage
 * @param {string|string[]} paths 
 */
export async function deleteSnapshot(paths) {
  const toDelete = Array.isArray(paths) ? paths : [paths];
  const { data, error } = await db.storage
    .from(BUCKET_NAME)
    .remove(toDelete);

  if (error) {
    logger.error({ error, paths: toDelete }, 'Error deleting snapshot from Supabase storage');
  }
  return data;
}

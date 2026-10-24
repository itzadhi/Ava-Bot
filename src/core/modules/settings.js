import { logger } from '../../utils/logger.js';

/**
 * Validates module settings against its Zod schema.
 * If validation fails or settings are missing, safely logs and falls back to defaultSettings.
 * Never throws or crashes the bot.
 * 
 * @param {string} moduleId
 * @param {object} rawSettings
 * @param {import('zod').ZodSchema} [schema]
 * @param {object} [defaultSettings={}]
 * @returns {object} Validated settings object
 */
export function validateSettings(moduleId, rawSettings = {}, schema = null, defaultSettings = {}) {
  const mergedWithDefaults = {
    ...defaultSettings,
    ...(typeof rawSettings === 'object' && rawSettings !== null ? rawSettings : {})
  };

  if (!schema) {
    return mergedWithDefaults;
  }

  try {
    const parsed = schema.safeParse(mergedWithDefaults);
    if (parsed.success) {
      return parsed.data;
    }

    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    logger.warn(
      { module: moduleId },
      `Settings schema validation failed for module "${moduleId}": ${issues}. Using default values.`
    );
    return { ...defaultSettings };
  } catch (err) {
    logger.error(
      { module: moduleId, err },
      `Unexpected error validating settings for module "${moduleId}". Using default values.`
    );
    return { ...defaultSettings };
  }
}

import { z } from 'zod';

/**
 * Standard AVA Module Contract Schema
 * Every module in /src/modules/<name>/module.js must conform to this schema.
 */
export const ModuleManifestSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'Module id must be lowercase alphanumeric with hyphens or underscores'),
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional().default(''),
  dependsOn: z.array(z.string()).optional().default([]),
  defaultEnabled: z.boolean().optional().default(true),
  intents: z.array(z.any()).optional().default([]),
  commands: z.array(z.any()).optional().default([]),
  components: z.array(z.any()).optional().default([]),
  events: z.record(z.any()).optional().default({}),
  jobs: z.array(z.object({
    name: z.string().min(1),
    expression: z.string().min(1),
    run: z.function()
  })).optional().default([]),
  migrations: z.array(z.string()).optional().default([]),
  settingsSchema: z.any().optional(),
  defaultSettings: z.record(z.any()).optional().default({}),
  copy: z.record(z.any()).optional().default({}),
  healthCheck: z.function().optional(),
  onLoad: z.function().optional(),
  onUnload: z.function().optional()
});

/**
 * Validates and normalizes a module manifest
 * @param {object} manifest
 * @returns {{ valid: boolean, manifest: object, error: string|null }}
 */
export function validateModuleManifest(manifest) {
  try {
    const parsed = ModuleManifestSchema.parse(manifest);
    return { valid: true, manifest: parsed, error: null };
  } catch (err) {
    return {
      valid: false,
      manifest: null,
      error: err.errors ? err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') : err.message
    };
  }
}

/**
 * Helper to define an AVA module with contract verification
 * @param {object} definition
 * @returns {object}
 */
export function defineAvaModule(definition) {
  const result = validateModuleManifest(definition);
  if (!result.valid) {
    throw new Error(`[Module Contract] Invalid module manifest for "${definition?.id || 'unknown'}": ${result.error}`);
  }
  return result.manifest;
}

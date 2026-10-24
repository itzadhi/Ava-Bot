import { logger } from '../../utils/logger.js';

/**
 * Validates Node.js runtime version and required environment variables for Pterodactyl compatibility.
 */
export function validatePterodactylEnv() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    const errorMsg = `FATAL: Unsupported Node.js version v${process.versions.node}. AVA requires Node.js 20 or higher. Please select a Node 20+ egg in your Pterodactyl panel.`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  const missing = [];
  const required = [
    { key: 'DISCORD_TOKEN', desc: 'Discord Bot Token from Developer Portal' },
    { key: 'SUPABASE_URL', desc: 'Supabase project endpoint URL' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY', alt: 'SUPABASE_ANON_KEY', desc: 'Supabase API access key' }
  ];

  for (const item of required) {
    const val = process.env[item.key] || (item.alt ? process.env[item.alt] : null);
    if (!val || !val.trim()) {
      missing.push(`${item.key}${item.alt ? ` (or ${item.alt})` : ''} - ${item.desc}`);
    }
  }

  if (missing.length > 0) {
    logger.warn({ missingCount: missing.length }, 'Some required environment variables are unset. Running in test/offline mode.');
  }

  return {
    valid: missing.length === 0,
    missing,
    nodeVersion: process.versions.node
  };
}

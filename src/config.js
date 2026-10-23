import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required').default('dummy_token_for_tests'),
  CLIENT_ID: z.string().min(1, 'CLIENT_ID is required').default('000000000000000000'),
  OWNER_IDS: z.string().default('').transform(val => 
    val.split(',').map(s => s.trim()).filter(Boolean)
  ),
  DEFAULT_PREFIX: z.string().min(1).max(5).default('a!'),
  OWNER_PREFIX: z.string().min(1).max(5).default('ao!'),
  SUPABASE_URL: z.string().url().default('https://placeholder-project.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default('placeholder_service_role_key'),
  SUPABASE_SECRET_KEY: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_JWKS_URL: z.string().optional(),
  DATA_ENCRYPTION_KEY: z.string().min(16, 'DATA_ENCRYPTION_KEY must be at least 16 chars').default('0123456789abcdef0123456789abcdef'),
  SHOP_ENCRYPTION_KEY: z.string().min(16, 'SHOP_ENCRYPTION_KEY must be at least 16 chars').optional(),
  SUPPORT_SERVER_URL: z.string().url().default('https://discord.gg/argoni'),
  INVITE_URL: z.string().url().default('https://discord.com/oauth2/authorize?client_id=argoni'),
  PRIVACY_URL: z.string().url().default('https://argoni.app/privacy'),
  TERMS_URL: z.string().url().default('https://argoni.app/terms'),
  WEBSITE_URL: z.string().url().default('https://argoni.app'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;

// Resolve service role / secret key
if (!config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_ROLE_KEY === 'placeholder_service_role_key') {
  if (config.SUPABASE_SECRET_KEY) {
    config.SUPABASE_SERVICE_ROLE_KEY = config.SUPABASE_SECRET_KEY;
  }
}

/**
 * Validates that live credentials (token, Supabase keys) are set before connecting
 * @returns {boolean}
 */
export function validateLiveCredentials() {
  const missing = [];
  if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN.startsWith('dummy_')) {
    missing.push('DISCORD_TOKEN');
  }
  if (!process.env.SUPABASE_URL || process.env.SUPABASE_URL.includes('placeholder')) {
    missing.push('SUPABASE_URL');
  }
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secretKey || secretKey.includes('placeholder')) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY');
  }
  return {
    valid: missing.length === 0,
    missing
  };
}

export default config;

import { db } from './client.js';
import { updateGuildSettings, getGuildSettings } from './guilds.js';
import { logger } from '../utils/logger.js';

export async function createPremiumCode({ code, tier, duration_days, uses_left = 1, created_by }) {
  const { data, error } = await db
    .from('premium_codes')
    .insert({
      code: code.toUpperCase(),
      tier,
      duration_days,
      uses_left,
      created_by,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    logger.error({ error, code }, 'Error creating premium code');
    throw error;
  }
  return data;
}

export async function getPremiumCode(code) {
  const { data, error } = await db
    .from('premium_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  if (error) {
    logger.error({ error, code }, 'Error fetching premium code');
    return null;
  }
  return data;
}

export async function redeemPremiumCode(code, guildId) {
  const codeRecord = await getPremiumCode(code);
  if (!codeRecord) {
    return { success: false, reason: 'Invalid premium redemption code' };
  }

  if (codeRecord.uses_left <= 0) {
    return { success: false, reason: 'This code has already reached its maximum usage limit' };
  }

  const durationMs = codeRecord.duration_days * 24 * 60 * 60 * 1000;
  const currentSettings = await getGuildSettings(guildId);
  const now = Date.now();

  let newUntil;
  if (currentSettings.premium_until && new Date(currentSettings.premium_until).getTime() > now) {
    newUntil = new Date(new Date(currentSettings.premium_until).getTime() + durationMs).toISOString();
  } else {
    newUntil = new Date(now + durationMs).toISOString();
  }

  // Decrement uses
  await db
    .from('premium_codes')
    .update({ uses_left: codeRecord.uses_left - 1 })
    .eq('code', codeRecord.code);

  // Update guild tier and expiration
  const updatedGuild = await updateGuildSettings(guildId, {
    premium_tier: codeRecord.tier,
    premium_until: newUntil
  });

  return {
    success: true,
    tier: codeRecord.tier,
    until: newUntil,
    guild: updatedGuild
  };
}

export async function grantGuildTier(guildId, tier, durationDays) {
  const durationMs = durationDays * 24 * 60 * 60 * 1000;
  const newUntil = new Date(Date.now() + durationMs).toISOString();

  return updateGuildSettings(guildId, {
    premium_tier: tier,
    premium_until: newUntil
  });
}

export async function revokeGuildTier(guildId) {
  return updateGuildSettings(guildId, {
    premium_tier: 'free',
    premium_until: null
  });
}

export async function listRecentCodes(limit = 10) {
  const { data, error } = await db
    .from('premium_codes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error({ error }, 'Error listing premium codes');
    return [];
  }
  return data || [];
}

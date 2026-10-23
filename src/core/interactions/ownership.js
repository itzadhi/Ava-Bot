import { PermissionFlagsBits } from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { sessionStore } from './session.js';
import { getGuildRoles } from '../../db/permify.js';

const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/**
 * Validates whether a value is a valid Discord snowflake ID or test mock ID
 * @param {any} val
 * @returns {boolean}
 */
export function isValidOwnerId(val) {
  if (!val || typeof val !== 'string') return false;
  return SNOWFLAKE_REGEX.test(val) || val.startsWith('user_');
}

/**
 * Builds a validated, formatted customId adhering to the 100 character Discord limit:
 * Format: `module:action:guildId:ownerId:key`
 *
 * @param {object} params
 * @param {string} params.module Short module identifier (e.g. 'shop', 'tkt', 'dash', 'permify')
 * @param {string} params.action Action identifier (e.g. 'setup', 'edit', 'buy', 'toggle')
 * @param {string} [params.guildId=''] Discord Guild Snowflake or empty
 * @param {string} params.ownerId Discord User Snowflake, 'public', 'staff', or '*'
 * @param {string} [params.key=''] Additional payload or session key
 * @returns {string}
 */
export function buildId({ module, action, guildId = '', ownerId, key = '' }) {
  if (!module || typeof module !== 'string') {
    throw new Error('[buildId] Missing or invalid module identifier');
  }
  if (!action || typeof action !== 'string') {
    throw new Error(`[buildId] Missing or invalid action identifier for module "${module}"`);
  }

  // Check for illegal separators inside individual segments
  if (module.includes(':') || action.includes(':') || String(guildId).includes(':')) {
    throw new Error(`[buildId] Field contains illegal colon separator ":" in "${module}:${action}"`);
  }

  // Validate ownerId (must be snowflake, 'public', 'staff', or mock test id)
  const cleanOwner = String(ownerId || '').trim();
  if (!cleanOwner) {
    throw new Error(`[buildId] Missing required ownerId for "${module}:${action}". Specify a valid user snowflake, "public", or "staff".`);
  }
  if (cleanOwner.includes(':')) {
    throw new Error(`[buildId] ownerId contains illegal colon separator ":" in "${module}:${action}"`);
  }

  const isSpecial = cleanOwner === 'public' || cleanOwner === 'staff' || cleanOwner === '*';
  if (!isSpecial && !isValidOwnerId(cleanOwner)) {
    throw new Error(`[buildId] Invalid ownerId "${ownerId}" for customId "${module}:${action}". Must be a valid Discord snowflake ID, "public", or "staff".`);
  }

  const raw = `${module}:${action}:${guildId || ''}:${cleanOwner}:${key || ''}`;
  if (raw.length > 100) {
    // If exceeds 100 characters, compress key into session store
    const shortKey = sessionStore.generateKey();
    sessionStore.createSession({
      module,
      guildId: guildId || '',
      userId: cleanOwner,
      ownerId: cleanOwner,
      data: { fullKey: key },
      key: shortKey,
      ttlMs: 60 * 60 * 1000
    });
    const compressed = `${module}:${action}:${guildId || ''}:${cleanOwner}:${shortKey}`;
    if (compressed.length > 100) {
      throw new Error(`[buildId] CustomId "${compressed}" exceeds 100 characters even after session compression.`);
    }
    return compressed;
  }

  return raw;
}

/**
 * Parses a customId into its constituent components
 * @param {string} customId
 * @returns {{ module: string, action: string, guildId: string, ownerId: string, key: string, raw: string }}
 */
export function parseId(customId) {
  if (!customId || typeof customId !== 'string') {
    return { module: '', action: '', guildId: '', ownerId: '', key: '', raw: '' };
  }

  const parts = customId.split(':');
  const rawOwner = parts[3] || '';
  const validOwner = (isValidOwnerId(rawOwner) || rawOwner === 'public' || rawOwner === 'staff' || rawOwner === '*') ? rawOwner : '';

  return {
    module: parts[0] || '',
    action: parts[1] || '',
    guildId: parts[2] || '',
    ownerId: validOwner || rawOwner,
    key: parts.slice(4).join(':') || '',
    raw: customId
  };
}

/**
 * Validates interaction authorization across 4 distinct access tiers:
 * - 'public': Anyone can click (Buy now, reviews, help browsing)
 * - 'staff': Staff roles, administrators, server owners, or bot owners
 * - 'participant': Order buyer or staff
 * - 'owner': Original command opener, with administrator/owner override
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} [meta={}]
 * @param {string} [meta.access] 'owner' | 'staff' | 'public' | 'participant'
 * @param {boolean} [meta.authorOnly] Backwards compatibility flag for 'owner' access
 * @param {string} [meta.ownerId=null] Explicit owner ID override
 * @param {string} [meta.buyerId=null] Buyer ID for participant checks
 * @param {object} [meta.parsed=null] Pre-parsed customId object
 * @returns {Promise<{ allowed: boolean, reason?: string, ownerId?: string, override?: string, warning?: string }>}
 */
export async function checkPanelAccess(interaction, meta = {}) {
  const userId = interaction.user.id;
  const parsed = meta.parsed || (interaction.customId ? parseId(interaction.customId) : {});

  // Determine effective access level
  let access = meta.access;
  if (!access) {
    if (meta.authorOnly) {
      access = 'owner';
    } else if (parsed.ownerId === 'public') {
      access = 'public';
    } else if (parsed.ownerId === 'staff') {
      access = 'staff';
    } else if (isValidOwnerId(parsed.ownerId)) {
      access = 'owner';
    } else {
      // Default to public to prevent accidental owner lockouts on unspecified handlers
      access = 'public';
    }
  }

  // 1. PUBLIC ACCESS: Always allowed
  if (access === 'public') {
    return { allowed: true };
  }

  // 2. OVERRIDES: Bot Owners, Guild Owners, and Server Admins always bypass checks
  const isBotOwner = Array.isArray(config.OWNER_IDS) && config.OWNER_IDS.includes(userId);
  const isGuildOwner = Boolean(interaction.guild && interaction.guild.ownerId === userId);
  const isAdmin = Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator));

  if (isBotOwner || isGuildOwner || isAdmin) {
    return {
      allowed: true,
      override: isBotOwner ? 'BOT_OWNER' : (isGuildOwner ? 'GUILD_OWNER' : 'ADMIN')
    };
  }

  // 3. STAFF ACCESS: Must have configured staff/manager roles or ManageGuild
  if (access === 'staff') {
    if (!interaction.guild) return { allowed: false, reason: 'GUILD_ONLY' };

    const hasManageGuild = Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
    if (hasManageGuild) return { allowed: true };

    try {
      const roles = await getGuildRoles(interaction.guild.id);
      const memberRoleIds = interaction.member?.roles?.cache
        ? Array.from(interaction.member.roles.cache.keys())
        : (interaction.member?._roles || []);

      const staffRoleIds = roles?.Staff || [];
      const managerRoleIds = roles?.Owner || [];
      const isStaff = memberRoleIds.some(r => staffRoleIds.includes(r) || managerRoleIds.includes(r));

      if (isStaff) return { allowed: true };
    } catch (_) {}

    return { allowed: false, reason: 'STAFF_ONLY' };
  }

  // 4. PARTICIPANT ACCESS (Orders/Tickets): Buyer OR Staff
  if (access === 'participant') {
    const buyerId = meta.buyerId || meta.ownerId;
    if (buyerId && String(buyerId) === String(userId)) {
      return { allowed: true };
    }

    // Check staff permissions (ManageGuild permission or configured staff/owner roles)
    const hasManageGuild = Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
    if (hasManageGuild) return { allowed: true };

    try {
      const roles = await getGuildRoles(interaction.guild.id);
      const memberRoleIds = interaction.member?.roles?.cache
        ? Array.from(interaction.member.roles.cache.keys())
        : (interaction.member?._roles || []);

      const staffRoleIds = roles?.Staff || [];
      const managerRoleIds = roles?.Owner || [];
      const isStaff = memberRoleIds.some(r => staffRoleIds.includes(r) || managerRoleIds.includes(r));
      if (isStaff) return { allowed: true };
    } catch (_) {}

    return { allowed: false, reason: 'PARTICIPANT_ONLY', ownerId: buyerId };
  }

  // 5. OWNER ACCESS (Wizards, settings, personal sessions):
  // Resolve true owner ID in strict order of priority:
  // 1. Explicit meta.ownerId
  // 2. Valid snowflake in parsed customId (ownerId segment)
  // 3. Session store ownerId (lookup by key, message.id, or customId)
  // NEVER message.interaction or message.author
  let targetOwner = null;

  if (isValidOwnerId(meta.ownerId)) {
    targetOwner = meta.ownerId;
  } else if (isValidOwnerId(parsed.ownerId)) {
    targetOwner = parsed.ownerId;
  } else if (parsed.key) {
    const session = sessionStore.getSession(parsed.key);
    if (session && isValidOwnerId(session.ownerId || session.userId)) {
      targetOwner = session.ownerId || session.userId;
    }
  }

  // If still not found, check message ID in session store
  if (!targetOwner && interaction.message?.id) {
    const msgSession = sessionStore.getSession(interaction.message.id);
    if (msgSession && isValidOwnerId(msgSession.ownerId || msgSession.userId)) {
      targetOwner = msgSession.ownerId || msgSession.userId;
    }
  }

  // Fail Open if owner is truly unknown:
  // Never show "belongs to another user" when the owner is unknown.
  if (!targetOwner || targetOwner === 'public') {
    logger.warn({ customId: interaction.customId, clickerId: userId }, '[Ownership] Could not determine panel owner, failing open');
    return { allowed: true, warning: 'UNKNOWN_OWNER_FAIL_OPEN' };
  }

  // Strict string comparison
  if (String(targetOwner) === String(userId)) {
    return { allowed: true };
  }

  logger.debug({ targetOwner, clickerId: userId, customId: interaction.customId }, '[Ownership] Blocked stranger interaction');
  return { allowed: false, reason: 'NOT_OWNER', ownerId: targetOwner };
}

export default {
  buildId,
  parseId,
  checkPanelAccess,
  isValidOwnerId
};

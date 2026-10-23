import { db, memoryDb } from './client.js';
import { logger } from '../utils/logger.js';

// Write-through in-memory cache for all AutoMod data
// Map<guildId, {
//   settings: object,
//   words: Array<{ word: string, category: string, severity: string, match_type: string }>,
//   allowlist: string[],
//   regex: Array<{ id: string, name: string, pattern: string, flags: string, severity: string, action: string, enabled: boolean }>,
//   exemptions: { roles: string[], channels: string[], categories: string[], users: string[] },
//   lastLoaded: number
// }>
const automodCache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60s soft safety TTL

export const DEFAULT_AUTOMOD_CONFIG = {
  anti_invites: false,
  anti_links: false,
  anti_spam: false,
  anti_mentions: false,
  anti_caps: false,
  word_filter: false,
  action: 'delete',
  log_channel_id: null,
  dm_user_on_action: true,
  slurs_category_enabled: true,
  slurs_severity: 'severe',
  profanity_category_enabled: true,
  profanity_severity: 'mild',
  custom_category_enabled: true,
  custom_severity: 'medium',
  allowed_domains: ['discord.gg', 'youtube.com', 'youtu.be', 'tenor.com', 'giphy.com'],
  denied_domains: [],
  strike_threshold_timeout: 3,
  strike_threshold_kick: 5,
  strike_threshold_ban: 7,
  strike_expiry_hours: 24,
  ticket_category_exempt: true
};

function getGuildCache(guildId) {
  if (!guildId) return null;
  return automodCache.get(String(guildId)) || null;
}

function setGuildCache(guildId, data) {
  if (!guildId) return;
  automodCache.set(String(guildId), {
    ...data,
    lastLoaded: Date.now()
  });
}

/**
 * Initializes and preloads AutoMod write-through cache for all guilds on bot startup
 * Logs: "Loaded automod config for N guilds, M words, K regex rules"
 * @param {import('discord.js').Client} [client]
 */
export async function initAutoModCache(client = null) {
  try {
    const [settingsRes, wordsRes, regexRes, allowRes, exemptRes] = await Promise.all([
      db.from('automod_settings').select('*'),
      db.from('automod_words').select('*'),
      db.from('automod_regex').select('*'),
      db.from('automod_allowlist').select('*'),
      db.from('automod_exemptions').select('*')
    ]);

    const settingsRows = settingsRes.data || [];
    const wordsRows = wordsRes.data || [];
    const regexRows = regexRes.data || [];
    const allowRows = allowRes.data || [];
    const exemptRows = exemptRes.data || [];

    // Group by guildId
    const guildsMap = new Map();

    for (const s of settingsRows) {
      if (!guildsMap.has(s.guild_id)) {
        guildsMap.set(s.guild_id, {
          settings: { enabled: s.enabled !== false, ...(s.config || {}) },
          words: [],
          allowlist: [],
          regex: [],
          exemptions: { roles: [], channels: [], categories: [], users: [] }
        });
      }
    }

    // Include client guilds if available
    if (client?.guilds?.cache) {
      for (const gid of client.guilds.cache.keys()) {
        if (!guildsMap.has(gid)) {
          guildsMap.set(gid, {
            settings: { enabled: true, ...DEFAULT_AUTOMOD_CONFIG },
            words: [],
            allowlist: [],
            regex: [],
            exemptions: { roles: [], channels: [], categories: [], users: [] }
          });
        }
      }
    }

    for (const w of wordsRows) {
      if (!guildsMap.has(w.guild_id)) {
        guildsMap.set(w.guild_id, {
          settings: { enabled: true, ...DEFAULT_AUTOMOD_CONFIG },
          words: [],
          allowlist: [],
          regex: [],
          exemptions: { roles: [], channels: [], categories: [], users: [] }
        });
      }
      guildsMap.get(w.guild_id).words.push({
        word: w.word,
        category: w.category || 'custom',
        severity: w.severity || 'medium',
        match_type: w.match_type || 'word'
      });
    }

    for (const r of regexRows) {
      if (!guildsMap.has(r.guild_id)) {
        guildsMap.set(r.guild_id, {
          settings: { enabled: true, ...DEFAULT_AUTOMOD_CONFIG },
          words: [],
          allowlist: [],
          regex: [],
          exemptions: { roles: [], channels: [], categories: [], users: [] }
        });
      }
      guildsMap.get(r.guild_id).regex.push(r);
    }

    for (const a of allowRows) {
      if (!guildsMap.has(a.guild_id)) {
        guildsMap.set(a.guild_id, {
          settings: { enabled: true, ...DEFAULT_AUTOMOD_CONFIG },
          words: [],
          allowlist: [],
          regex: [],
          exemptions: { roles: [], channels: [], categories: [], users: [] }
        });
      }
      guildsMap.get(a.guild_id).allowlist.push(a.word.toLowerCase());
    }

    for (const e of exemptRows) {
      if (!guildsMap.has(e.guild_id)) {
        guildsMap.set(e.guild_id, {
          settings: { enabled: true, ...DEFAULT_AUTOMOD_CONFIG },
          words: [],
          allowlist: [],
          regex: [],
          exemptions: { roles: [], channels: [], categories: [], users: [] }
        });
      }
      const exObj = guildsMap.get(e.guild_id).exemptions;
      if (e.type === 'role') exObj.roles.push(e.target_id);
      else if (e.type === 'channel') exObj.channels.push(e.target_id);
      else if (e.type === 'category') exObj.categories.push(e.target_id);
      else if (e.type === 'user') exObj.users.push(e.target_id);
    }

    for (const [gid, data] of guildsMap.entries()) {
      setGuildCache(gid, data);
    }

    const guildCount = guildsMap.size;
    const wordCount = wordsRows.length;
    const regexCount = regexRows.length;

    logger.info(`Loaded automod config for ${guildCount} guilds, ${wordCount} words, ${regexCount} regex rules`);
    return { guildCount, wordCount, regexCount };
  } catch (err) {
    logger.error({ err }, 'Failed to initialize AutoMod write-through cache');
    return { guildCount: 0, wordCount: 0, regexCount: 0 };
  }
}

/**
 * Reloads all AutoMod data for a specific guild into cache
 * @param {string} guildId
 */
export async function refreshGuildAutoModCache(guildId) {
  if (!guildId) return null;
  const gid = String(guildId);

  try {
    const [sRes, wRes, rRes, aRes, eRes] = await Promise.all([
      db.from('automod_settings').select('*').eq('guild_id', gid).maybeSingle(),
      db.from('automod_words').select('*').eq('guild_id', gid),
      db.from('automod_regex').select('*').eq('guild_id', gid),
      db.from('automod_allowlist').select('*').eq('guild_id', gid),
      db.from('automod_exemptions').select('*').eq('guild_id', gid)
    ]);

    const sRow = sRes.data;
    const settings = sRow
      ? { enabled: sRow.enabled !== false, ...(sRow.config || {}) }
      : { enabled: true, ...DEFAULT_AUTOMOD_CONFIG };

    const words = (wRes.data || []).map(w => ({
      word: w.word,
      category: w.category || 'custom',
      severity: w.severity || 'medium',
      match_type: w.match_type || 'word'
    }));

    const regex = rRes.data || [];
    const allowlist = (aRes.data || []).map(a => a.word.toLowerCase());

    const exemptions = { roles: [], channels: [], categories: [], users: [] };
    for (const e of (eRes.data || [])) {
      if (e.type === 'role') exemptions.roles.push(e.target_id);
      else if (e.type === 'channel') exemptions.channels.push(e.target_id);
      else if (e.type === 'category') exemptions.categories.push(e.target_id);
      else if (e.type === 'user') exemptions.users.push(e.target_id);
    }

    const cachedData = {
      settings,
      words,
      allowlist,
      regex,
      exemptions
    };

    setGuildCache(gid, cachedData);
    return cachedData;
  } catch (err) {
    logger.error({ err, guildId }, 'Error refreshing AutoMod cache for guild');
    return getGuildCache(gid);
  }
}

/**
 * Gets the current AutoMod settings for a guild
 * @param {string} guildId
 * @returns {Promise<object>}
 */
export async function getAutoModSettings(guildId) {
  if (!guildId) return { enabled: true, ...DEFAULT_AUTOMOD_CONFIG };
  const gid = String(guildId);

  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.settings;
  }

  const refreshed = await refreshGuildAutoModCache(gid);
  return refreshed?.settings || { enabled: true, ...DEFAULT_AUTOMOD_CONFIG };
}

/**
 * Updates AutoMod settings for a guild in both Supabase and write-through cache
 * @param {string} guildId
 * @param {object} updates
 * @returns {Promise<{ data: object, error: any }>}
 */
export async function updateAutoModSettings(guildId, updates = {}) {
  if (!guildId) return { data: null, error: new Error('Missing guildId') };
  const gid = String(guildId);

  const current = await getAutoModSettings(gid);
  const isEnabled = updates.enabled !== undefined ? Boolean(updates.enabled) : current.enabled !== false;

  const newConfig = { ...current, ...updates };
  delete newConfig.enabled; // Keep enabled in root column

  const payload = {
    guild_id: gid,
    enabled: isEnabled,
    config: newConfig,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('automod_settings')
    .upsert(payload)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid }, 'Supabase error updating automod_settings');
    return { data: null, error };
  }

  // Update write-through cache immediately
  const cached = getGuildCache(gid) || {
    words: [],
    allowlist: [],
    regex: [],
    exemptions: { roles: [], channels: [], categories: [], users: [] }
  };
  cached.settings = { enabled: isEnabled, ...newConfig };
  setGuildCache(gid, cached);

  return { data: cached.settings, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORD FILTER & ALLOWLIST
// ─────────────────────────────────────────────────────────────────────────────

export async function getAutoModWords(guildId) {
  if (!guildId) return [];
  const gid = String(guildId);
  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.words;
  }
  const refreshed = await refreshGuildAutoModCache(gid);
  return refreshed?.words || [];
}

export async function addAutoModWord(guildId, { word, category = 'custom', severity = 'medium', match_type = 'word' }) {
  if (!guildId || !word) return { data: null, error: new Error('Missing guildId or word') };
  const gid = String(guildId);
  const cleanWord = String(word).trim().toLowerCase();
  if (!cleanWord) return { data: null, error: new Error('Word cannot be empty') };

  const record = {
    guild_id: gid,
    word: cleanWord,
    category: category || 'custom',
    severity: severity || 'medium',
    match_type: match_type || 'word',
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('automod_words')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid, word: cleanWord }, 'Supabase error adding automod_word');
    return { data: null, error };
  }

  // Update write-through cache
  const cached = getGuildCache(gid) || await refreshGuildAutoModCache(gid);
  if (cached) {
    cached.words = cached.words.filter(w => w.word !== cleanWord);
    cached.words.push({
      word: cleanWord,
      category: record.category,
      severity: record.severity,
      match_type: record.match_type
    });
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function removeAutoModWord(guildId, word) {
  if (!guildId || !word) return { data: null, error: new Error('Missing guildId or word') };
  const gid = String(guildId);
  const cleanWord = String(word).trim().toLowerCase();

  const { data, error } = await db
    .from('automod_words')
    .delete()
    .eq('guild_id', gid)
    .eq('word', cleanWord);

  if (error) {
    logger.error({ error, guildId: gid, word: cleanWord }, 'Supabase error removing automod_word');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    cached.words = cached.words.filter(w => w.word !== cleanWord);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function getAutoModAllowlist(guildId) {
  if (!guildId) return [];
  const gid = String(guildId);
  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.allowlist;
  }
  const refreshed = await refreshGuildAutoModCache(gid);
  return refreshed?.allowlist || [];
}

export async function addAutoModAllowlist(guildId, word) {
  if (!guildId || !word) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const cleanWord = String(word).trim().toLowerCase();
  if (!cleanWord) return { data: null, error: new Error('Word cannot be empty') };

  const record = {
    guild_id: gid,
    word: cleanWord,
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('automod_allowlist')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid, word: cleanWord }, 'Supabase error adding automod_allowlist');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    if (!cached.allowlist.includes(cleanWord)) cached.allowlist.push(cleanWord);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function removeAutoModAllowlist(guildId, word) {
  if (!guildId || !word) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);
  const cleanWord = String(word).trim().toLowerCase();

  const { data, error } = await db
    .from('automod_allowlist')
    .delete()
    .eq('guild_id', gid)
    .eq('word', cleanWord);

  if (error) {
    logger.error({ error, guildId: gid, word: cleanWord }, 'Supabase error removing automod_allowlist');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    cached.allowlist = cached.allowlist.filter(w => w !== cleanWord);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// REGEX RULES
// ─────────────────────────────────────────────────────────────────────────────

export async function getAutoModRegexRules(guildId) {
  if (!guildId) return [];
  const gid = String(guildId);
  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.regex;
  }
  const refreshed = await refreshGuildAutoModCache(gid);
  return refreshed?.regex || [];
}

export async function saveAutoModRegexRule(guildId, rule) {
  if (!guildId || !rule?.name || !rule?.pattern) {
    return { data: null, error: new Error('Missing rule name or pattern') };
  }
  const gid = String(guildId);

  // Safety limits: Max 50 rules, pattern max 200 chars
  const existingRules = await getAutoModRegexRules(gid);
  if (!rule.id && existingRules.length >= 50) {
    return { data: null, error: new Error('Maximum limit of 50 regex rules reached for this server.') };
  }
  if (rule.pattern.length > 200) {
    return { data: null, error: new Error('Regex pattern exceeds maximum length of 200 characters.') };
  }

  const id = rule.id || `rx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    id,
    guild_id: gid,
    name: String(rule.name).slice(0, 50),
    pattern: rule.pattern,
    flags: rule.flags || 'i',
    severity: rule.severity || 'medium',
    action: rule.action || 'delete',
    enabled: rule.enabled !== false,
    created_at: rule.created_at || new Date().toISOString()
  };

  const { data, error } = await db
    .from('automod_regex')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid }, 'Supabase error saving automod_regex');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    cached.regex = cached.regex.filter(r => r.id !== id);
    cached.regex.push(record);
    setGuildCache(gid, cached);
  }

  return { data: record, error: null };
}

export const addAutoModRegexRule = saveAutoModRegexRule;

export async function deleteAutoModRegexRule(guildId, ruleId) {
  if (!guildId || !ruleId) return { data: null, error: new Error('Missing ruleId') };
  const gid = String(guildId);

  const { data, error } = await db
    .from('automod_regex')
    .delete()
    .eq('guild_id', gid)
    .eq('id', ruleId);

  if (error) {
    logger.error({ error, guildId: gid, ruleId }, 'Supabase error deleting automod_regex');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    cached.regex = cached.regex.filter(r => r.id !== ruleId);
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function toggleAutoModRegexRule(guildId, ruleId, enabled) {
  const rules = await getAutoModRegexRules(guildId);
  const found = rules.find(r => r.id === ruleId);
  if (!found) return { data: null, error: new Error('Rule not found') };
  return saveAutoModRegexRule(guildId, { ...found, enabled: Boolean(enabled) });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXEMPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAutoModExemptions(guildId) {
  if (!guildId) return { roles: [], channels: [], categories: [], users: [] };
  const gid = String(guildId);
  const cached = getGuildCache(gid);
  if (cached && Date.now() - cached.lastLoaded < CACHE_TTL_MS) {
    return cached.exemptions;
  }
  const refreshed = await refreshGuildAutoModCache(gid);
  return refreshed?.exemptions || { roles: [], channels: [], categories: [], users: [] };
}

export async function addAutoModExemption(guildId, targetId, type) {
  if (!guildId || !targetId || !type) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);

  const record = {
    guild_id: gid,
    target_id: String(targetId),
    type: String(type).toLowerCase(),
    created_at: new Date().toISOString()
  };

  const { data, error } = await db
    .from('automod_exemptions')
    .upsert(record)
    .select()
    .single();

  if (error) {
    logger.error({ error, guildId: gid, targetId, type }, 'Supabase error adding automod_exemption');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const list = cached.exemptions[type === 'role' ? 'roles' : type === 'channel' ? 'channels' : type === 'category' ? 'categories' : 'users'];
    if (list && !list.includes(String(targetId))) list.push(String(targetId));
    setGuildCache(gid, cached);
  }

  return { data, error: null };
}

export async function removeAutoModExemption(guildId, targetId, type) {
  if (!guildId || !targetId || !type) return { data: null, error: new Error('Missing parameters') };
  const gid = String(guildId);

  const { data, error } = await db
    .from('automod_exemptions')
    .delete()
    .eq('guild_id', gid)
    .eq('target_id', String(targetId))
    .eq('type', String(type).toLowerCase());

  if (error) {
    logger.error({ error, guildId: gid, targetId, type }, 'Supabase error removing automod_exemption');
    return { data: null, error };
  }

  const cached = getGuildCache(gid);
  if (cached) {
    const key = type === 'role' ? 'roles' : type === 'channel' ? 'channels' : type === 'category' ? 'categories' : 'users';
    if (cached.exemptions[key]) {
      cached.exemptions[key] = cached.exemptions[key].filter(id => id !== String(targetId));
      setGuildCache(gid, cached);
    }
  }

  return { data, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// STRIKES
// ─────────────────────────────────────────────────────────────────────────────

export async function getUserStrikes(guildId, userId) {
  if (!guildId || !userId) return 0;
  const gid = String(guildId);
  const uid = String(userId);

  const { data, error } = await db
    .from('automod_strikes')
    .select('*')
    .eq('guild_id', gid)
    .eq('user_id', uid)
    .maybeSingle();

  if (error || !data) return 0;

  // Check strike expiry
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    await db.from('automod_strikes').delete().eq('guild_id', gid).eq('user_id', uid).catch(() => {});
    return 0;
  }

  return data.count || 0;
}

export async function addStrike(guildId, userId, rule = 'violation', expiryHours = 24) {
  if (!guildId || !userId) return 1;
  const gid = String(guildId);
  const uid = String(userId);

  const currentCount = await getUserStrikes(gid, uid);
  const newCount = currentCount + 1;
  const expiresAt = new Date(Date.now() + (Number(expiryHours) || 24) * 3600 * 1000).toISOString();

  const record = {
    guild_id: gid,
    user_id: uid,
    count: newCount,
    last_rule: rule,
    last_at: new Date().toISOString(),
    expires_at: expiresAt
  };

  try {
    await db.from('automod_strikes').upsert(record);
  } catch (err) {
    logger.error({ err, guildId: gid, userId: uid }, 'Error recording automod strike');
  }

  return { count: newCount, rule, ...record };
}

export async function clearStrikes(guildId, userId) {
  if (!guildId || !userId) return;
  try {
    await db.from('automod_strikes').delete().eq('guild_id', String(guildId)).eq('user_id', String(userId));
  } catch (_) {}
}

export default {
  initAutoModCache,
  refreshGuildAutoModCache,
  getAutoModSettings,
  updateAutoModSettings,
  getAutoModWords,
  addAutoModWord,
  removeAutoModWord,
  getAutoModAllowlist,
  addAutoModAllowlist,
  removeAutoModAllowlist,
  getAutoModRegexRules,
  saveAutoModRegexRule,
  deleteAutoModRegexRule,
  toggleAutoModRegexRule,
  getAutoModExemptions,
  addAutoModExemption,
  removeAutoModExemption,
  getUserStrikes,
  addStrike,
  clearStrikes
};

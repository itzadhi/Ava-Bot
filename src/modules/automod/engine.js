import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import {
  getAutoModSettings,
  getAutoModWords,
  getAutoModAllowlist,
  getAutoModRegexRules,
  getAutoModExemptions,
  addStrike,
  getUserStrikes
} from '../../db/automod.js';
import { isTrusted } from '../../db/antinuke.js';
import { getGuildRoles } from '../../db/permify.js';
import { getTicketSettings, getTicketByChannel } from '../../db/tickets.js';
import { normalizeText, maskSlur, testWordMatch, safeRegexExec, validateRegexPattern } from './normalizer.js';
import { scanBuiltinPresets } from './presets.js';
import { logger } from '../../utils/logger.js';
import * as format from '../../utils/ui/format.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const wordlistsDir = path.resolve(__dirname, '../../../data/wordlists');

// In-memory baseline datasets loaded once from /data/wordlists/*.json
let baselineSlurs = [];
let baselineProfanity = [];

async function loadBaselineWordlists() {
  try {
    const slursPath = path.join(wordlistsDir, 'slurs.json');
    const slursRaw = await fs.promises.readFile(slursPath, 'utf8').catch(() => null);
    if (slursRaw) baselineSlurs = JSON.parse(slursRaw);

    const profPath = path.join(wordlistsDir, 'profanity.json');
    const profRaw = await fs.promises.readFile(profPath, 'utf8').catch(() => null);
    if (profRaw) baselineProfanity = JSON.parse(profRaw);
  } catch (err) {
    logger.warn({ err }, 'Could not load baseline wordlists from disk');
  }
}
loadBaselineWordlists().catch(() => {});

// Anti-Spam sliding window cache: `${guildId}:${userId}` -> Array<number timestamps>
const spamWindowCache = new Map();
// Duplicate spam cache: `${guildId}:${userId}` -> { content: string, count: number, lastTime: number }
const duplicateCache = new Map();

// Periodic TTL cleanup to prevent unbounded memory growth
const automodSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of spamWindowCache.entries()) {
    const recent = timestamps.filter(t => now - t < 10000);
    if (recent.length === 0) spamWindowCache.delete(key);
    else spamWindowCache.set(key, recent);
  }
  for (const [key, data] of duplicateCache.entries()) {
    if (now - data.lastTime > 30000) duplicateCache.delete(key);
  }
}, 30000);

if (automodSweepTimer.unref) {
  automodSweepTimer.unref();
}

/**
 * Checks if a member has permission to bypass AutoMod
 * Real server owner, bot, native Admin/ManageGuild, staff role, and exception roles/channels are exempt.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {import('discord.js').Channel|object} [channelOrSettings]
 * @param {object} [maybeSettings]
 * @param {object} [maybeExemptions]
 * @returns {boolean}
 */
export function isAutoModBypassed(member, channelOrSettings = null, maybeSettings = null, maybeExemptions = null) {
  if (!member || !member.user) return false;

  // 1. Bot itself or other bots
  if (member.user.bot) return true;

  // 2. Real server owner is ALWAYS immune
  if (member.guild && member.guild.ownerId === member.id) return true;

  // 3. Native Discord administrator or manage guild permissions
  if (member.permissions?.has(PermissionFlagsBits.Administrator) ||
      member.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  let channel = null;
  let settings = null;
  let exemptions = null;

  if (channelOrSettings && !channelOrSettings.isTextBased && !channelOrSettings.type && (
    channelOrSettings.automod_enabled !== undefined ||
    channelOrSettings.staff_role_id !== undefined ||
    channelOrSettings.automod_exception_role_id !== undefined ||
    channelOrSettings.enabled !== undefined ||
    channelOrSettings.anti_invites !== undefined
  )) {
    settings = channelOrSettings;
    exemptions = maybeSettings;
  } else {
    channel = channelOrSettings;
    settings = maybeSettings;
    exemptions = maybeExemptions;
  }

  // 4. Staff role check from settings
  if (settings?.staff_role_id && member.roles?.cache?.has(settings.staff_role_id)) {
    return true;
  }

  // 5. Exception role check from settings
  if (settings?.automod_exception_role_id && member.roles?.cache?.has(settings.automod_exception_role_id)) {
    return true;
  }
  if (Array.isArray(settings?.automod_ignored_role_ids) && settings.automod_ignored_role_ids.some(r => member.roles?.cache?.has(r))) {
    return true;
  }

  // 6. Configured AutoMod Exemptions
  if (exemptions) {
    if (exemptions.users?.includes(member.id)) return true;
    if (exemptions.roles?.some(roleId => member.roles?.cache?.has(roleId))) return true;
    if (channel && exemptions.channels?.includes(channel.id)) return true;
    if (channel?.parentId && exemptions.categories?.includes(channel.parentId)) return true;
  }

  // 7. Ticket Channel name check
  if (channel) {
    if (channel.name?.startsWith('ticket-') || channel.name?.startsWith('tkt-')) {
      return true;
    }
  }

  return false;
}

/**
 * Scans an incoming message against all configured AutoMod rules
 * @param {import('discord.js').Message} message
 * @param {object} [customSettings] Optional overriding/custom settings for testing or offline checks
 * @returns {Promise<{ violated: boolean, rule?: string, reason?: string, matchedText?: string, severity?: string, action?: string }>}
 */
export async function scanMessage(message, customSettings = null) {
  if (!message?.guild || !message?.author || message.author.bot) {
    return { violated: false };
  }

  const guildId = message.guild.id;
  let settings;
  let customWordsList = null;

  if (customSettings) {
    settings = {
      enabled: customSettings.automod_enabled !== undefined ? customSettings.automod_enabled : (customSettings.enabled !== false),
      anti_invites: customSettings.automod_anti_invites ?? customSettings.anti_invites ?? false,
      anti_links: customSettings.automod_anti_links ?? customSettings.anti_links ?? false,
      anti_spam: customSettings.automod_anti_spam ?? customSettings.anti_spam ?? false,
      anti_mentions: customSettings.automod_anti_mentions ?? customSettings.anti_mentions ?? false,
      anti_caps: customSettings.automod_anti_caps ?? customSettings.anti_caps ?? false,
      word_filter: customSettings.automod_word_filter ?? customSettings.word_filter ?? false,
      action: customSettings.automod_action ?? customSettings.action ?? 'delete',
      staff_role_id: customSettings.staff_role_id,
      automod_exception_role_id: customSettings.automod_exception_role_id,
      automod_ignored_role_ids: customSettings.automod_ignored_role_ids || [],
      ticket_category_exempt: customSettings.ticket_category_exempt,
      ...customSettings
    };
    if (Array.isArray(customSettings.automod_banned_words)) {
      customWordsList = customSettings.automod_banned_words;
    }
  } else {
    settings = await getAutoModSettings(guildId);
  }

  if (!settings || settings.enabled === false) {
    return { violated: false };
  }

  const exemptions = customSettings ? null : await getAutoModExemptions(guildId);

  // Fast synchronous bypass check
  if (isAutoModBypassed(message.member, message.channel, settings, exemptions)) {
    return { violated: false };
  }

  // Comprehensive async bypass checks (Anti-Nuke trusted, Permify roles, dynamic Tickets)
  if (message.guild && !customSettings) {
    const trusted = await isTrusted(message.guild, message.author.id, message.member).catch(() => false);
    if (trusted) return { violated: false };

    const permifyRoles = await getGuildRoles(message.guild.id).catch(() => ({ staff: [], owner: [] }));
    const staffRoleIds = new Set([...(permifyRoles.staff || []), ...(permifyRoles.owner || [])]);
    if (message.member?.roles?.cache?.some(r => staffRoleIds.has(r.id))) {
      return { violated: false };
    }

    if (settings.ticket_category_exempt !== false && message.channel) {
      const ticketSettings = await getTicketSettings(message.guild.id).catch(() => null);
      if (ticketSettings?.channel_category_id && (message.channel.id === ticketSettings.channel_category_id || message.channel.parentId === ticketSettings.channel_category_id)) {
        return { violated: false };
      }
      const isTicketChannel = await getTicketByChannel(message.guild.id, message.channel.id).catch(() => null);
      if (isTicketChannel) return { violated: false };
    }
  }

  const content = message.content || '';
  const now = Date.now();
  const userKey = `${guildId}:${message.author.id}`;

  // 1. Built-in Presets (invites, links, scam nitro, excessive caps, mass mentions, zalgo, emoji spam, newline spam)
  const presetResult = scanBuiltinPresets(message, settings);
  if (presetResult.violated) {
    return {
      violated: true,
      rule: presetResult.rule,
      reason: presetResult.reason,
      matchedText: presetResult.matchedText,
      severity: 'medium',
      action: settings.action || 'delete'
    };
  }

  // 2. Anti-Spam Rate Limit & Duplicate Flood
  if (settings.anti_spam) {
    // Sliding window: > 5 messages in 4 seconds
    const timestamps = (spamWindowCache.get(userKey) || []).filter(t => now - t < 4000);
    timestamps.push(now);
    spamWindowCache.set(userKey, timestamps);

    if (timestamps.length > 5) {
      return {
        violated: true,
        rule: 'anti_spam',
        reason: 'Rapid message flooding (sent more than 5 messages in 4 seconds).',
        matchedText: `${timestamps.length} msgs / 4s`,
        severity: 'medium',
        action: settings.action || 'delete'
      };
    }

    // Duplicate message spam (3 identical messages within 15 seconds)
    const lastDup = duplicateCache.get(userKey);
    if (lastDup && lastDup.content === content && now - lastDup.lastTime < 15000) {
      const newCount = lastDup.count + 1;
      duplicateCache.set(userKey, { content, count: newCount, lastTime: now });
      if (newCount >= 3) {
        return {
          violated: true,
          rule: 'anti_duplicate_spam',
          reason: 'Repeated identical messages detected.',
          matchedText: content.slice(0, 50),
          severity: 'medium',
          action: settings.action || 'delete'
        };
      }
    } else {
      duplicateCache.set(userKey, { content, count: 1, lastTime: now });
    }
  }

  // 3. Word Filter (Slurs, Profanity, Custom Terms, Allowlist)
  if (settings.word_filter || settings.slurs_category_enabled || settings.profanity_category_enabled) {
    const allowlist = customSettings ? [] : await getAutoModAllowlist(guildId);
    const customWords = customSettings ? [] : await getAutoModWords(guildId);

    // 3a. Custom words list from customSettings (e.g. automod_banned_words)
    if (customWordsList && customWordsList.length > 0) {
      for (const word of customWordsList) {
        const test = testWordMatch(content, word, 'word', allowlist);
        if (test.matched) {
          return {
            violated: true,
            rule: 'word_filter',
            reason: `Prohibited blacklisted phrase detected (\`${word}\`).`,
            matchedText: word,
            severity: 'medium',
            action: settings.action || 'delete'
          };
        }
      }
    }

    // 3b. Slurs (Severe tier)
    if (settings.slurs_category_enabled !== false) {
      for (const slur of baselineSlurs) {
        const test = testWordMatch(content, slur, 'word', allowlist);
        if (test.matched) {
          return {
            violated: true,
            rule: 'slur_filter',
            reason: 'Prohibited hate speech or slur detected.',
            matchedText: slur,
            severity: settings.slurs_severity || 'severe',
            action: settings.slurs_severity === 'severe' ? 'timeout' : (settings.action || 'delete')
          };
        }
      }
    }

    // 3c. Profanity (Mild tier)
    if (settings.profanity_category_enabled !== false) {
      for (const prof of baselineProfanity) {
        const test = testWordMatch(content, prof, 'word', allowlist);
        if (test.matched) {
          return {
            violated: true,
            rule: 'profanity_filter',
            reason: 'Prohibited vulgar language detected.',
            matchedText: prof,
            severity: settings.profanity_severity || 'mild',
            action: settings.action || 'delete'
          };
        }
      }
    }

    // 3d. Custom Server Words
    if (settings.custom_category_enabled !== false && customWords.length > 0) {
      for (const item of customWords) {
        const test = testWordMatch(content, item.word, item.match_type || 'word', allowlist);
        if (test.matched) {
          return {
            violated: true,
            rule: `custom_word:${item.category}`,
            reason: `Blacklisted server phrase detected (\`${item.word}\`).`,
            matchedText: item.word,
            severity: item.severity || 'medium',
            action: settings.action || 'delete'
          };
        }
      }
    }
  }

  // 4. Custom Regex Rules (Max 50 rules, ReDoS safe)
  const regexRules = customSettings ? (customSettings.regexRules || []) : await getAutoModRegexRules(guildId);
  if (regexRules && regexRules.length > 0) {
    for (const rule of regexRules) {
      if (rule.enabled === false) continue;
      const valid = validateRegexPattern(rule.pattern, rule.flags || 'i');
      if (!valid.valid || !valid.regex) continue;

      const exec = safeRegexExec(valid.regex, content);
      if (exec.matched) {
        return {
          violated: true,
          rule: `regex:${rule.name}`,
          reason: `Violated custom pattern rule: "${rule.name}"`,
          matchedText: exec.matchText || rule.pattern,
          severity: rule.severity || 'medium',
          action: rule.action || settings.action || 'delete'
        };
      }
    }
  }

  return { violated: false };
}

/**
 * Enforces an AutoMod violation:
 * 1. Instantly deletes the message
 * 2. Adds strike and checks threshold escalation
 * 3. Applies punishment (delete, warn, timeout, kick, ban)
 * 4. DMs the user a short Components V2 notice (if enabled)
 * 5. Logs to log channel with masked slurs and unix timestamp
 *
 * @param {import('discord.js').Message} message
 * @param {object} violation
 */
export async function enforceViolation(message, violation) {
  const guild = message.guild;
  const author = message.author;
  const settings = await getAutoModSettings(guild.id);

  // 1. Instant deletion
  await message.delete().catch(() => {});

  // 2. Add strike & track escalation
  const strikeCount = await addStrike(guild.id, author.id, violation.rule, settings.strike_expiry_hours || 24);

  // Determine punishment with strike escalation
  let appliedAction = violation.action || settings.action || 'delete';

  const timeoutThreshold = settings.strike_threshold_timeout || 3;
  const kickThreshold = settings.strike_threshold_kick || 5;
  const banThreshold = settings.strike_threshold_ban || 7;

  if (strikeCount >= banThreshold) {
    appliedAction = 'ban';
  } else if (strikeCount >= kickThreshold) {
    appliedAction = 'kick';
  } else if (strikeCount >= timeoutThreshold && appliedAction === 'delete') {
    appliedAction = 'timeout';
  }

  let punishmentText = 'Message Removed';

  // 3. Execute Punishment
  try {
    if (appliedAction === 'timeout') {
      if (message.member?.moderatable) {
        const durationMs = 10 * 60 * 1000; // 10 minutes
        await message.member.timeout(durationMs, `AutoMod Violation: ${violation.reason} (Strike #${strikeCount})`);
        punishmentText = `Message Removed & 10m Timeout (Strike #${strikeCount})`;
      }
    } else if (appliedAction === 'kick') {
      if (message.member?.kickable) {
        await message.member.kick(`AutoMod Escalation: ${violation.reason} (Strike #${strikeCount})`);
        punishmentText = `Message Removed & Member Kicked (Strike #${strikeCount})`;
      }
    } else if (appliedAction === 'ban') {
      if (message.member?.bannable) {
        await guild.bans.create(author.id, {
          reason: `AutoMod Escalation: ${violation.reason} (Strike #${strikeCount})`,
          deleteMessageSeconds: 3600
        });
        punishmentText = `Message Removed & Member Banned (Strike #${strikeCount})`;
      }
    } else if (appliedAction === 'warn') {
      punishmentText = `Message Removed & Warning Issued (Strike #${strikeCount})`;
    }
  } catch (err) {
    logger.warn({ err, guildId: guild.id, userId: author.id }, 'Could not execute AutoMod punishment');
  }

  // 4. DM User Notice
  if (settings.dm_user_on_action !== false) {
    try {
      const dmContainer = new ContainerBuilder();
      const dmContent =
        `## 🛡️ AutoMod Notice from ${format.escapeMarkdown(guild.name)}\n` +
        `Your message was removed by the server's automated safety filter.\n\n` +
        `- **Reason:** ${violation.reason}\n` +
        `- **Action Taken:** **${punishmentText}**\n` +
        `- **Current Strikes:** \`${strikeCount}\`\n\n` +
        `-# Please review the server rules to avoid further moderation actions.`;

      dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmContent));
      await author.send({
        components: [dmContainer],
        flags: MessageFlags.IsComponentsV2
      }).catch(() => {});
    } catch (_) {}
  }

  // 5. Send Incident Log
  const logChanId = settings.log_channel_id;
  if (logChanId) {
    const logChan = guild.channels.cache.get(logChanId);
    if (logChan && logChan.isTextBased?.()) {
      try {
        const maskedSnippet = maskSlur(violation.matchedText || 'Blocked Content');
        const cleanContent = format.escapeMarkdown((message.content || '').slice(0, 300));
        const unixTimestamp = Math.floor(Date.now() / 1000);

        const logContainer = new ContainerBuilder();
        const headerText =
          `## 🛡️ AutoMod Enforcement Incident\n` +
          `Automated moderation triggered in <#${message.channel.id}> <t:${unixTimestamp}:R>.\n\n` +
          `- **Offender:** <@${author.id}> (\`${author.tag || author.id}\`)\n` +
          `- **Channel:** <#${message.channel.id}>\n` +
          `- **Rule Triggered:** \`${violation.rule}\`\n` +
          `- **Matched Content:** \`${maskedSnippet}\`\n` +
          `- **Action Taken:** **${punishmentText}**\n` +
          `- **Strike Count:** \`${strikeCount}\`\n` +
          `- **Reason:** ${violation.reason}\n\n` +
          `**Original Message Snippet:**\n` +
          `> ${cleanContent.split('\n').join('\n> ')}`;

        logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));

        await logChan.send({
          components: [logContainer],
          flags: MessageFlags.IsComponentsV2,
          allowedMentions: { parse: [] }
        }).catch(() => {});
      } catch (err) {
        logger.warn({ err }, 'Error sending AutoMod incident log');
      }
    }
  }

  return { rule: violation.rule, appliedAction, strikeCount };
}

/**
 * Direct entry point for incoming messages in messageCreate event
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} True if handled
 */
export async function handleAutoModMessage(message) {
  try {
    const violation = await scanMessage(message);
    if (violation.violated) {
      // Immediate deletion without waiting
      message.delete().catch(() => {});
      enforceViolation(message, violation).catch(err => {
        logger.error({ err }, 'Error enforcing AutoMod violation');
      });
      return true;
    }
  } catch (err) {
    logger.error({ err }, 'Error in handleAutoModMessage pipeline');
  }
  return false;
}

export default {
  scanMessage,
  enforceViolation,
  handleAutoModMessage,
  isAutoModBypassed
};

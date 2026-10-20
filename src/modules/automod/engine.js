import {
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  MessageFlags
} from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { logger } from '../../utils/logger.js';

// Anti-Spam sliding window cache: `${guildId}:${userId}` -> Array<number timestamps>
const spamWindowCache = new Map();
// Duplicate spam cache: `${guildId}:${userId}` -> { content: string, count: number, lastTime: number }
const duplicateCache = new Map();

// Regex cache for compiled prohibited word filters
const wordRegexCache = new Map();

function getCompiledWordRegex(words) {
  const key = words.join('|');
  if (wordRegexCache.has(key)) return wordRegexCache.get(key);
  const escaped = words
    .map(w => (w || '').trim().toLowerCase())
    .filter(Boolean)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length === 0) return null;
  const regex = new RegExp(`(?:\\b|_)(?:${escaped.join('|')})(?:\\b|_)`, 'i');
  wordRegexCache.set(key, regex);
  return regex;
}

/**
 * Checks if a member has permission to bypass AutoMod
 * @param {import('discord.js').GuildMember} member
 * @param {object} guildSettings
 * @returns {boolean}
 */
export function isAutoModBypassed(member, guildSettings) {
  if (!member) return false;
  if (member.user?.bot) return true;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;

  if (guildSettings?.staff_role_id && member.roles?.cache?.has(guildSettings.staff_role_id)) {
    return true;
  }

  // AutoMod Exception Role(s) bypass
  if (guildSettings?.automod_exception_role_id && member.roles?.cache?.has(guildSettings.automod_exception_role_id)) {
    return true;
  }

  if (Array.isArray(guildSettings?.automod_ignored_role_ids) && guildSettings.automod_ignored_role_ids.length > 0) {
    if (guildSettings.automod_ignored_role_ids.some(roleId => member.roles?.cache?.has(roleId))) {
      return true;
    }
  }

  return false;
}

/**
 * Evaluates a message against all configured AutoMod rules
 * @param {import('discord.js').Message} message
 * @param {object} [customSettings]
 * @returns {Promise<{ violated: boolean, rule?: string, reason?: string }>}
 */
export async function scanMessage(message, customSettings = null) {
  if (!message.guild || !message.author || message.author.bot) {
    return { violated: false };
  }

  const settings = customSettings || await getGuildSettings(message.guild.id);
  if (!settings || settings.automod_enabled === false) {
    return { violated: false };
  }

  // Check staff bypass
  if (isAutoModBypassed(message.member, settings)) {
    return { violated: false };
  }

  const content = message.content || '';
  const now = Date.now();
  const userKey = `${message.guild.id}:${message.author.id}`;

  // 1. Anti-Invites Filter
  if (settings.automod_anti_invites) {
    const inviteRegex = /(?:discord(?:app)?\.(?:com\/invite|gg)|discord\.me|discord\.io|invite\.gg)\/[a-zA-Z0-9]+/i;
    if (inviteRegex.test(content)) {
      return {
        violated: true,
        rule: 'anti_invites',
        reason: 'Discord server invite links are prohibited.'
      };
    }
  }

  // 2. Anti-Links / Phishing Filter
  if (settings.automod_anti_links) {
    const urlRegex = /https?:\/\/[^\s]+/i;
    if (urlRegex.test(content)) {
      return {
        violated: true,
        rule: 'anti_links',
        reason: 'External web links are blocked in this server.'
      };
    }
  }

  // 3. Mass Mentions Filter (> 4 mentions)
  if (settings.automod_anti_mentions) {
    const userMentions = message.mentions.users?.size || 0;
    const roleMentions = message.mentions.roles?.size || 0;
    const totalMentions = userMentions + roleMentions;

    if (totalMentions > 4) {
      return {
        violated: true,
        rule: 'anti_mentions',
        reason: `Excessive mentions detected (${totalMentions} mentions, limit is 4).`
      };
    }
  }

  // 4. Anti-Caps Filter (> 70% uppercase with length >= 10)
  if (settings.automod_anti_caps && content.length >= 10) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 8) {
      const upperCount = (letters.match(/[A-Z]/g) || []).length;
      const ratio = upperCount / letters.length;
      if (ratio >= 0.70) {
        return {
          violated: true,
          rule: 'anti_caps',
          reason: `Excessive capital letters detected (${Math.round(ratio * 100)}% uppercase).`
        };
      }
    }
  }

  // 5. Word Blacklist / Profanity Filter
  if (settings.automod_word_filter && Array.isArray(settings.automod_banned_words) && settings.automod_banned_words.length > 0) {
    const compiled = getCompiledWordRegex(settings.automod_banned_words);
    if (compiled && compiled.test(content)) {
      return {
        violated: true,
        rule: 'word_filter',
        reason: 'Blacklisted phrase detected.'
      };
    }
  }

  // 6. Anti-Spam Rate Limit & Duplicate Flood
  if (settings.automod_anti_spam) {
    // Sliding window: > 5 messages in 4 seconds
    const timestamps = (spamWindowCache.get(userKey) || []).filter(t => now - t < 4000);
    timestamps.push(now);
    spamWindowCache.set(userKey, timestamps);

    if (timestamps.length > 5) {
      return {
        violated: true,
        rule: 'anti_spam',
        reason: 'Rapid message flooding (sent more than 5 messages in 4 seconds).'
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
          rule: 'anti_spam',
          reason: 'Repeated identical messages detected.'
        };
      }
    } else {
      duplicateCache.set(userKey, { content, count: 1, lastTime: now });
    }
  }

  return { violated: false };
}

/**
 * Enforces an AutoMod violation by deleting the message, punishing the user, and logging the event
 * @param {import('discord.js').Message} message
 * @param {string} rule
 * @param {string} reason
 * @param {object} [customSettings]
 */
export async function enforceViolation(message, rule, reason, customSettings = null) {
  const settings = customSettings || await getGuildSettings(message.guild.id);
  const action = settings?.automod_action || 'delete';

  // 1. Delete offending message (if not already deleted)
  await message.delete().catch(() => {});

  // 2. Execute configured punishment
  let punishmentApplied = 'Message Deleted';

  if (action === 'warn') {
    punishmentApplied = 'Message Deleted & Member Warned';
    const warning = await message.channel.send({
      content: `⚠️ <@${message.author.id}>, your message was removed by **AutoMod**.\n> **Reason:** ${reason}`
    }).catch(() => null);

    if (warning) {
      setTimeout(() => warning.delete().catch(() => {}), 6000);
    }
  } else if (action === 'timeout') {
    punishmentApplied = 'Message Deleted & 5-Minute Timeout';
    if (message.member?.moderatable) {
      await message.member.timeout(5 * 60 * 1000, `AutoMod Violation: ${reason}`).catch(err => {
        logger.warn({ err }, 'Could not timeout member for AutoMod violation');
      });
    }

    const warning = await message.channel.send({
      content: `⛔ <@${message.author.id}> has been timed out for **5 minutes** by **AutoMod**.\n> **Reason:** ${reason}`
    }).catch(() => null);

    if (warning) {
      setTimeout(() => warning.delete().catch(() => {}), 8000);
    }
  }

  // 3. Send incident log to configured AutoMod log channel
  const logChannelId = settings?.automod_log_channel_id || settings?.log_channel_id;
  if (logChannelId) {
    const logChannel = message.guild.channels.cache.get(logChannelId);
    if (logChannel && logChannel.isTextBased?.()) {
      try {
        const logContainer = new ContainerBuilder();
        const cleanSnippet = (message.content || '[No text content]').slice(0, 500);
        const logContent =
          `# 🛡️ AutoMod Incident Log\n` +
          `### Violation: ${rule.toUpperCase().replace(/_/g, ' ')}\n` +
          `- **User:** <@${message.author.id}> (\`${message.author.tag || message.author.id}\`)\n` +
          `- **Channel:** <#${message.channel.id}>\n` +
          `- **Action Taken:** **${punishmentApplied}**\n` +
          `- **Reason:** ${reason}\n\n` +
          `**Deleted Content:**\n` +
          `> ${cleanSnippet.split('\n').join('\n> ')}`;

        logContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(logContent));

        await logChannel.send({
          components: [logContainer],
          flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
      } catch (err) {
        logger.warn({ err }, 'Could not send AutoMod incident log');
      }
    }
  }

  return { rule, action, punishmentApplied };
}

/**
 * Direct entry point for handling incoming messages in messageCreate event
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} True if message was intercepted and handled by AutoMod
 */
export async function handleAutoModMessage(message) {
  const result = await scanMessage(message);
  if (result.violated) {
    // Instant microsecond deletion: fire message.delete immediately without blocking
    message.delete().catch(() => {});
    enforceViolation(message, result.rule, result.reason).catch(err => {
      logger.error({ err }, 'Error enforcing AutoMod violation');
    });
    return true;
  }
  return false;
}

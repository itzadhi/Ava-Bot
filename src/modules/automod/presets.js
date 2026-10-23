// Built-in AutoMod presets and pattern detectors

export const PRESET_PATTERNS = {
  invites: /(?:discord(?:app)?\.(?:com\/invite|gg)|discord\.me|discord\.io|invite\.gg)\/[a-zA-Z0-9]+/i,
  links: /https?:\/\/[^\s/$.?#].[^\s]*/i,
  ip_addresses: /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/,
  scam_nitro: /(?:discorcl|dlscord|disord|discord-app|discord-nitro|nitro-discord|discordgift|discord-free|steamnitro|free-nitro|nitro-gift|discord-airdrop|gift-discord)\.[a-z]{2,}/i,
  fake_everyone: /(?:@everyone|@here)[\s\S]*?(?:https?:\/\/|[a-z0-9]+\.(?:com|org|net|ru|xyz|gift|click))/i,
  repeated_chars: /(.)\1{9,}/,
  zalgo: /[\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{5,}/,
  emoji: /<a?:[a-zA-Z0-9_]+:[0-9]+>|[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu
};

/**
 * Checks if a URL domain is allowed or denied
 * @param {string} urlString
 * @param {string[]} [allowedDomains=[]]
 * @param {string[]} [deniedDomains=[]]
 * @returns {{ allowed: boolean, reason?: string, domain?: string }}
 */
export function checkUrlDomain(urlString, allowedDomains = [], deniedDomains = []) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    // Check denied list first
    for (const d of deniedDomains) {
      const clean = d.trim().toLowerCase();
      if (clean && (hostname === clean || hostname.endsWith(`.${clean}`))) {
        return { allowed: false, reason: `Domain ${hostname} is blocked in denylist.`, domain: hostname };
      }
    }

    // Check allowed list
    if (allowedDomains && allowedDomains.length > 0) {
      const isAllowed = allowedDomains.some(d => {
        const clean = d.trim().toLowerCase();
        return clean && (hostname === clean || hostname.endsWith(`.${clean}`));
      });
      if (!isAllowed) {
        return { allowed: false, reason: `Domain ${hostname} is not in domain allowlist.`, domain: hostname };
      }
    }

    return { allowed: true, domain: hostname };
  } catch (_) {
    return { allowed: false, reason: 'Malformed link format detected.' };
  }
}

/**
 * Evaluates message against built-in presets
 * @param {import('discord.js').Message} message
 * @param {object} config
 * @returns {{ violated: boolean, rule?: string, reason?: string, matchedText?: string }}
 */
export function scanBuiltinPresets(message, config) {
  const content = message.content || '';
  if (!content) return { violated: false };

  // 1. Discord Invites
  if (config.anti_invites) {
    const match = PRESET_PATTERNS.invites.exec(content);
    if (match) {
      return {
        violated: true,
        rule: 'anti_invites',
        reason: 'Discord server invite links are prohibited.',
        matchedText: match[0]
      };
    }
  }

  // 2. Links & Phishing with domain allowlist/denylist
  if (config.anti_links) {
    const linkMatches = content.match(/https?:\/\/[^\s]+/gi);
    if (linkMatches && linkMatches.length > 0) {
      const allowedDomains = Array.isArray(config.allowed_domains) ? config.allowed_domains : [];
      const deniedDomains = Array.isArray(config.denied_domains) ? config.denied_domains : [];

      for (const link of linkMatches) {
        const domainCheck = checkUrlDomain(link, allowedDomains, deniedDomains);
        const isExempt = allowedDomains.length > 0 && domainCheck.allowed;
        if (!isExempt) {
          return {
            violated: true,
            rule: 'anti_links',
            reason: domainCheck.reason || 'External web links are blocked in this server.',
            matchedText: link
          };
        }
      }
    }
  }

  // 3. Scam Nitro / Phishing Patterns
  const scamMatch = PRESET_PATTERNS.scam_nitro.exec(content);
  if (scamMatch) {
    return {
      violated: true,
      rule: 'scam_protection',
      reason: 'Suspected fake Discord gift, Nitro, or phishing link detected.',
      matchedText: scamMatch[0]
    };
  }

  // 4. Fake @everyone Links
  const fakeEveryMatch = PRESET_PATTERNS.fake_everyone.exec(content);
  if (fakeEveryMatch) {
    return {
      violated: true,
      rule: 'fake_mention_link',
      reason: 'Deceptive broadcast mention combined with link detected.',
      matchedText: fakeEveryMatch[0]
    };
  }

  // 5. IP Addresses
  const ipMatch = PRESET_PATTERNS.ip_addresses.exec(content);
  if (ipMatch) {
    return {
      violated: true,
      rule: 'ip_filter',
      reason: 'Direct IP address posting is prohibited.',
      matchedText: ipMatch[0]
    };
  }

  // 6. Excessive Caps (>70% uppercase when text >= 10 chars)
  if (config.anti_caps && content.length >= 10) {
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 8) {
      const upperCount = (letters.match(/[A-Z]/g) || []).length;
      const ratio = upperCount / letters.length;
      if (ratio >= 0.70) {
        return {
          violated: true,
          rule: 'anti_caps',
          reason: `Excessive capital letters detected (${Math.round(ratio * 100)}% uppercase).`,
          matchedText: content.slice(0, 40)
        };
      }
    }
  }

  // 7. Mass Mentions (> 4 mentions)
  if (config.anti_mentions) {
    const userMentions = message.mentions?.users?.size || 0;
    const roleMentions = message.mentions?.roles?.size || 0;
    const totalMentions = userMentions + roleMentions;

    if (totalMentions > 4) {
      return {
        violated: true,
        rule: 'anti_mentions',
        reason: `Excessive mentions detected (${totalMentions} mentions, limit is 4).`,
        matchedText: `${totalMentions} mentions`
      };
    }
  }

  // 8. Repeated Characters (10+ same char in a row)
  const repMatch = PRESET_PATTERNS.repeated_chars.exec(content);
  if (repMatch) {
    return {
      violated: true,
      rule: 'repeated_characters',
      reason: 'Excessive repeated characters detected.',
      matchedText: repMatch[0]
    };
  }

  // 9. Zalgo Text
  const zalgoMatch = PRESET_PATTERNS.zalgo.exec(content);
  if (zalgoMatch) {
    return {
      violated: true,
      rule: 'zalgo_text',
      reason: 'Distorted zalgo / excessive diacritical mark spam detected.',
      matchedText: zalgoMatch[0]
    };
  }

  // 10. Emoji Spam (> 8 emojis)
  const emojiMatches = content.match(PRESET_PATTERNS.emoji);
  if (emojiMatches && emojiMatches.length > 8) {
    return {
      violated: true,
      rule: 'emoji_spam',
      reason: `Emoji spam detected (${emojiMatches.length} emojis, limit is 8).`,
      matchedText: `${emojiMatches.length} emojis`
    };
  }

  // 11. Newline Spam (> 8 newlines)
  const newlines = (content.match(/\n/g) || []).length;
  if (newlines > 8) {
    return {
      violated: true,
      rule: 'newline_spam',
      reason: `Excessive newline spam detected (${newlines} newlines, limit is 8).`,
      matchedText: `${newlines} newlines`
    };
  }

  return { violated: false };
}

export default {
  PRESET_PATTERNS,
  checkUrlDomain,
  scanBuiltinPresets
};

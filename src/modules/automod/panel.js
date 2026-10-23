import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import * as format from '../../utils/ui/format.js';

export const TOTAL_PAGES = 8;
export const PAGE_TITLES = [
  'Status Overview',
  'Word Filter',
  'Regex Rules',
  'Link & Invite Rules',
  'Spam Rules',
  'Exemptions',
  'Punishments & Strikes',
  'Logging & Auditing'
];

/**
 * Builds the text progress bar: e.g. ▰▰▱▱▱▱▱▱ 2/8
 */
function buildProgressBar(page, total = TOTAL_PAGES) {
  const filled = '▰'.repeat(page);
  const empty = '▱'.repeat(total - page);
  return `\`${filled}${empty} ${page}/${total}\` • **${PAGE_TITLES[page - 1]}**`;
}

/**
 * Builds standard grey navigation row for the AutoMod wizard
 */
function buildNavRow(guildId, userId, page) {
  const hasPrev = page > 1;
  const hasNext = page < TOTAL_PAGES;

  return new ActionRowBuilder().addComponents(
    greyButton({
      id: `automod:nav:${guildId}:${userId}:${page - 1}`,
      label: '◀ Prev',
      disabled: !hasPrev
    }),
    greyButton({
      id: `automod:noop:${guildId}:${userId}:${page}`,
      label: `‹ Page ${page} / ${TOTAL_PAGES} ›`,
      disabled: true
    }),
    greyButton({
      id: `automod:nav:${guildId}:${userId}:${page + 1}`,
      label: 'Next ▶',
      disabled: !hasNext
    }),
    greyButton({
      id: `automod:close:${guildId}:${userId}:${page}`,
      label: 'Close',
      emoji: '✖'
    })
  );
}

/**
 * Renders the paginated Components V2 AutoMod Control Panel
 *
 * @param {object} options
 * @param {string} options.guildId
 * @param {string} options.userId
 * @param {number} [options.page=1]
 * @param {object} options.settings
 * @param {Array<object>} options.words
 * @param {Array<string>} options.allowlist
 * @param {Array<object>} options.regexRules
 * @param {object} options.exemptions
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAutoModWizard(arg1 = {}, maybeUserId = null, maybePage = 1, maybeSettings = {}) {
  let guildId, userId, page, settings, words, allowlist, regexRules, exemptions;

  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1) && (arg1.guildId !== undefined || arg1.settings !== undefined || arg1.page !== undefined)) {
    ({
      guildId,
      userId,
      page = 1,
      settings = {},
      words = [],
      allowlist = [],
      regexRules = [],
      exemptions = { roles: [], channels: [], categories: [], users: [] }
    } = arg1);
  } else {
    guildId = arg1;
    userId = maybeUserId;
    page = maybePage || 1;
    settings = maybeSettings || {};
    words = [];
    allowlist = [];
    regexRules = [];
    exemptions = { roles: [], channels: [], categories: [], users: [] };
  }

  if (!settings || typeof settings !== 'object') {
    settings = { enabled: true };
  }
  if (!exemptions || typeof exemptions !== 'object') {
    exemptions = { roles: [], channels: [], categories: [], users: [] };
  }
  if (!Array.isArray(words)) words = [];
  if (!Array.isArray(allowlist)) allowlist = [];
  if (!Array.isArray(regexRules)) regexRules = [];

  const container = new ContainerBuilder();
  const safePage = Math.max(1, Math.min(page, TOTAL_PAGES));

  const isEnabled = settings.enabled !== false;
  const progressBar = buildProgressBar(safePage);

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 1: STATUS OVERVIEW
  // ─────────────────────────────────────────────────────────────────────────
  if (safePage === 1) {
    const lines = [
      `## 🛡️ AutoMod Protection Control Panel`,
      `${progressBar}`,
      ``,
      `Configure automated message filters, profanity safeguards, and strike escalations.`,
      ``,
      `### Core System Health`,
      `- **Protection State:** ${isEnabled ? '🟢 **Active**' : '⚪ **Disabled**'}`,
      `- **DM User Notices:** ${settings.dm_user_on_action !== false ? '🟢 **Enabled**' : '⚪ **Disabled**'}`,
      `- **Default Enforcement:** \`${settings.action || 'delete'}\``,
      `- **Active Word Filters:** \`${words.length}\` custom phrase(s) • \`${allowlist.length}\` allowlisted`,
      `- **Active Regex Rules:** \`${regexRules.filter(r => r.enabled !== false).length}\` of \`${regexRules.length}\` rules`,
      `- **Strike Escalation:** ⏱️ 3 strikes = Timeout • 👢 5 strikes = Kick • 🔨 7 strikes = Ban`,
      ``,
      `*Use the grey buttons below to toggle state or navigate across configuration pages.*`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const actionRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:toggle_master:${guildId}:${userId}:1`,
        label: isEnabled ? 'Master: Active' : 'Master: Disabled',
        emoji: isEnabled ? '🟢' : '⚪'
      }),
      greyButton({
        id: `automod:toggle_dm:${guildId}:${userId}:1`,
        label: settings.dm_user_on_action !== false ? 'DM Alerts: ON' : 'DM Alerts: OFF',
        emoji: '📩'
      }),
      greyButton({
        id: `automod:test_text_modal:${guildId}:${userId}:1`,
        label: 'Test Sample Text',
        emoji: '🧪'
      }),
      greyButton({
        id: `automod:refresh:${guildId}:${userId}:1`,
        label: 'Refresh',
        emoji: '🔄'
      })
    );

    container.addActionRowComponents(actionRow, buildNavRow(guildId, userId, 1));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 2: WORD FILTER (SLURS, PROFANITY, CUSTOM)
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 2) {
    const slursOn = settings.slurs_category_enabled !== false;
    const profOn = settings.profanity_category_enabled !== false;
    const customOn = settings.custom_category_enabled !== false;

    const sampleWords = words.slice(0, 8).map(w => `\`${w.word}\` (${w.category})`).join(', ') || '*No custom words registered yet*';

    const lines = [
      `## 🤬 Word & Phrase Protection`,
      `${progressBar}`,
      ``,
      `Block prohibited slurs, vulgar profanity, and custom server keywords. Normalization maps homoglyphs and leetspeak automatically.`,
      ``,
      `### Categories & Severity Tiers`,
      `- **Hate Speech & Slurs:** ${slursOn ? '🟢 Enabled' : '⚪ Disabled'} • Severity: **${settings.slurs_severity || 'severe'}**`,
      `- **Vulgar Profanity:** ${profOn ? '🟢 Enabled' : '⚪ Disabled'} • Severity: **${settings.profanity_severity || 'mild'}**`,
      `- **Custom Server Terms:** ${customOn ? '🟢 Enabled' : '⚪ Disabled'} • Total: **${words.length}** phrases`,
      `- **Allowlist Entries:** **${allowlist.length}** phrases (avoids false positives)`,
      ``,
      `**Recent Custom Words:**`,
      `> ${sampleWords}`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const togglesRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:toggle_slurs:${guildId}:${userId}:2`,
        label: slursOn ? 'Slurs: ON' : 'Slurs: OFF',
        emoji: '🚫'
      }),
      greyButton({
        id: `automod:toggle_prof:${guildId}:${userId}:2`,
        label: profOn ? 'Profanity: ON' : 'Profanity: OFF',
        emoji: '⚠️'
      }),
      greyButton({
        id: `automod:toggle_custom:${guildId}:${userId}:2`,
        label: customOn ? 'Custom: ON' : 'Custom: OFF',
        emoji: '📝'
      })
    );

    const opsRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:word_add_modal:${guildId}:${userId}:2`,
        label: 'Add Word',
        emoji: '➕'
      }),
      greyButton({
        id: `automod:word_remove_modal:${guildId}:${userId}:2`,
        label: 'Remove Word',
        emoji: '➖'
      }),
      greyButton({
        id: `automod:word_allowlist_modal:${guildId}:${userId}:2`,
        label: 'Manage Allowlist',
        emoji: '🛡️'
      }),
      greyButton({
        id: `automod:view_words:${guildId}:${userId}:2`,
        label: `View List (${words.length})`,
        emoji: '📋'
      })
    );

    container.addActionRowComponents(togglesRow, opsRow, buildNavRow(guildId, userId, 2));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 3: REGEX RULES
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 3) {
    const rulePreviews = regexRules.slice(0, 5).map(r =>
      `- **${r.name}:** \`/${r.pattern}/${r.flags || 'i'}\` [${r.action}] (${r.enabled ? '🟢 ON' : '⚪ OFF'})`
    ).join('\n') || '*No custom regular expression rules configured yet.*';

    const lines = [
      `## 🔍 Custom Regex Protection`,
      `${progressBar}`,
      ``,
      `Create customized patterns with guarded execution to protect against catastrophic backtracking (ReDoS). Max 50 rules, 200 chars each.`,
      ``,
      `### Configured Rules (\`${regexRules.length} / 50\`)`,
      `${rulePreviews}`,
      ``,
      `*Use the buttons below to create, test, or delete regex filters.*`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const regexRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:regex_add_modal:${guildId}:${userId}:3`,
        label: 'Add Regex Rule',
        emoji: '➕'
      }),
      greyButton({
        id: `automod:regex_test_modal:${guildId}:${userId}:3`,
        label: 'Test Regex Pattern',
        emoji: '🧪'
      }),
      greyButton({
        id: `automod:regex_delete_menu:${guildId}:${userId}:3`,
        label: 'Manage / Delete',
        emoji: '🗑️',
        disabled: regexRules.length === 0
      })
    );

    container.addActionRowComponents(regexRow, buildNavRow(guildId, userId, 3));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 4: LINK & INVITE RULES
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 4) {
    const invitesOn = !!settings.anti_invites;
    const linksOn = !!settings.anti_links;
    const allowedDomains = (settings.allowed_domains || []).join(', ') || 'discord.gg, youtube.com';
    const deniedDomains = (settings.denied_domains || []).join(', ') || 'None';

    const lines = [
      `## 🌐 Link & Discord Invite Filtering`,
      `${progressBar}`,
      ``,
      `Block Discord server advertisement invites and untrusted external web links with custom domain allowlists.`,
      ``,
      `### Configuration Status`,
      `- **Anti-Invites:** ${invitesOn ? '🟢 Enabled' : '⚪ Disabled'} — Blocks discord.gg, discord.com/invite, etc.`,
      `- **Anti-Links:** ${linksOn ? '🟢 Enabled' : '⚪ Disabled'} — Blocks external web links`,
      `- **Allowed Domains:** \`${allowedDomains}\``,
      `- **Denied Domains:** \`${deniedDomains}\``,
      `- **Scam & Nitro Protection:** 🟢 Always Active`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const linksRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:toggle_invites:${guildId}:${userId}:4`,
        label: invitesOn ? 'Invites: ON' : 'Invites: OFF',
        emoji: '🔗'
      }),
      greyButton({
        id: `automod:toggle_links:${guildId}:${userId}:4`,
        label: linksOn ? 'Links: ON' : 'Links: OFF',
        emoji: '🌐'
      }),
      greyButton({
        id: `automod:domains_modal:${guildId}:${userId}:4`,
        label: 'Configure Domains',
        emoji: '⚙️'
      })
    );

    container.addActionRowComponents(linksRow, buildNavRow(guildId, userId, 4));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 5: SPAM & FLOOD RULES
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 5) {
    const spamOn = !!settings.anti_spam;
    const capsOn = !!settings.anti_caps;
    const mentionsOn = !!settings.anti_mentions;

    const lines = [
      `## ⚡ Spam & Flood Safeguards`,
      `${progressBar}`,
      ``,
      `Prevent chat flooding, repeated message abuse, excessive mentions, and shouting.`,
      ``,
      `### Active Filters`,
      `- **Message Rate Limiting:** ${spamOn ? '🟢 Enabled' : '⚪ Disabled'} (>5 messages in 4s / duplicates)`,
      `- **Excessive Capitalization:** ${capsOn ? '🟢 Enabled' : '⚪ Disabled'} (>70% uppercase in 10+ chars)`,
      `- **Mass Mentions:** ${mentionsOn ? '🟢 Enabled' : '⚪ Disabled'} (>4 user or role mentions)`,
      `- **Emoji & Zalgo Spam:** 🟢 Always Active (>8 emojis or corrupted text)`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const spamRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:toggle_spam:${guildId}:${userId}:5`,
        label: spamOn ? 'Spam: ON' : 'Spam: OFF',
        emoji: '⚡'
      }),
      greyButton({
        id: `automod:toggle_caps:${guildId}:${userId}:5`,
        label: capsOn ? 'Caps: ON' : 'Caps: OFF',
        emoji: '🔠'
      }),
      greyButton({
        id: `automod:toggle_mentions:${guildId}:${userId}:5`,
        label: mentionsOn ? 'Mentions: ON' : 'Mentions: OFF',
        emoji: '📢'
      })
    );

    container.addActionRowComponents(spamRow, buildNavRow(guildId, userId, 5));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 6: EXEMPTIONS
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 6) {
    const roleMentions = exemptions.roles?.length > 0
      ? exemptions.roles.map(id => `<@&${id}>`).join(', ')
      : '`None (All roles checked)`';
    const channelMentions = exemptions.channels?.length > 0
      ? exemptions.channels.map(id => `<#${id}>`).join(', ')
      : '`None`';

    const ticketExempt = settings.ticket_category_exempt !== false;

    const lines = [
      `## 🛡️ Moderation Exemptions`,
      `${progressBar}`,
      ``,
      `Select roles and channels that completely bypass AutoMod rule inspection.`,
      ``,
      `### Immunity & Exemptions`,
      `- **Permanent Immunity:** Real Server Owner, Whitelisted Bots & Staff Roles from Permify`,
      `- **Ticket Category Exemption:** ${ticketExempt ? '🟢 Enabled (Tickets never moderated)' : '⚪ Disabled'}`,
      `- **Exempt Roles:** ${roleMentions}`,
      `- **Exempt Channels:** ${channelMentions}`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const roleSelectRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`automod:exempt_roles:${guildId}:${userId}:6`)
        .setPlaceholder('Select exempt role(s)...')
        .setMinValues(0)
        .setMaxValues(10)
    );

    const toggleRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:toggle_ticket_exempt:${guildId}:${userId}:6`,
        label: ticketExempt ? 'Ticket Exemption: ON' : 'Ticket Exemption: OFF',
        emoji: '🎫'
      }),
      greyButton({
        id: `automod:clear_exemptions:${guildId}:${userId}:6`,
        label: 'Clear All Exemptions',
        emoji: '🗑️'
      })
    );

    container.addActionRowComponents(roleSelectRow, toggleRow, buildNavRow(guildId, userId, 6));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 7: PUNISHMENTS & STRIKES
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 7) {
    const curAction = settings.action || 'delete';
    const tTimeout = settings.strike_threshold_timeout || 3;
    const tKick = settings.strike_threshold_kick || 5;
    const tBan = settings.strike_threshold_ban || 7;
    const expHours = settings.strike_expiry_hours || 24;

    const lines = [
      `## 🔨 Enforcement & Strike Escalation`,
      `${progressBar}`,
      ``,
      `Configure immediate enforcement actions and automated strike escalation thresholds.`,
      ``,
      `### Active Thresholds`,
      `- **Base Action:** \`${curAction.toUpperCase()}\` (deletes offending message)`,
      `- **Timeout Escalation:** **${tTimeout} Strikes** ➔ 10-minute timeout`,
      `- **Kick Escalation:** **${tKick} Strikes** ➔ Member kicked`,
      `- **Ban Escalation:** **${tBan} Strikes** ➔ Member permanently banned`,
      `- **Strike Expiration:** \`${expHours} Hours\` of good behavior`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const actionMenuRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`automod:action_sel:${guildId}:${userId}:7`)
        .setPlaceholder('Choose Base Enforcement Action...')
        .addOptions([
          { label: 'Delete Only', value: 'delete', description: 'Silently remove the offending message', default: curAction === 'delete' },
          { label: 'Delete & Warn', value: 'warn', description: 'Remove message and temporary warning', default: curAction === 'warn' },
          { label: 'Delete & Timeout', value: 'timeout', description: 'Remove message and timeout member', default: curAction === 'timeout' }
        ])
    );

    const strikesModalRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `automod:strikes_modal:${guildId}:${userId}:7`,
        label: 'Adjust Strike Thresholds',
        emoji: '⚖️'
      })
    );

    container.addActionRowComponents(actionMenuRow, strikesModalRow, buildNavRow(guildId, userId, 7));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 8: LOGGING & AUDITING
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 8) {
    const logChanId = settings.log_channel_id;
    const logDisplay = logChanId ? `<#${logChanId}>` : '`None (Not configured)`';

    const lines = [
      `## 📢 Incident Auditing & Log Channel`,
      `${progressBar}`,
      ``,
      `All moderation events are recorded with masked slur content and timestamp markers.`,
      ``,
      `### Incident Channel`,
      `- **Active Log Channel:** ${logDisplay}`,
      `- **Slur Masking:** 🟢 Always active (e.g. \`b***h\` rather than echoing full word)`,
      `- **Audit Details:** Offender mention, rule violated, masked text, action taken & strike count.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const channelRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`automod:log_chan_sel:${guildId}:${userId}:8`)
        .setPlaceholder('Set AutoMod Incident Log Channel...')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );

    container.addActionRowComponents(channelRow, buildNavRow(guildId, userId, 8));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds modal for adding a prohibited word
 */
export function buildAddWordModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`automod:word_add_submit:${guildId}:${userId}:2`)
    .setTitle('Add Prohibited Words')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('words_input')
          .setLabel('Words / Phrases (Comma or line separated)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('badword, scammer, free gift, malicious*')
          .setRequired(true)
          .setMaxLength(2000)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('match_type_input')
          .setLabel('Match Type (word, substring, or wildcard)')
          .setStyle(TextInputStyle.Short)
          .setValue('word')
          .setRequired(false)
      )
    );
}

/**
 * Builds modal for removing a prohibited word
 */
export function buildRemoveWordModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`automod:word_remove_submit:${guildId}:${userId}:2`)
    .setTitle('Remove Prohibited Words')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('words_to_remove')
          .setLabel('Words to Remove (Comma separated)')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('word1, word2')
          .setRequired(true)
          .setMaxLength(1000)
      )
    );
}

/**
 * Builds modal for testing sample text against AutoMod
 */
export function buildTestTextModal(guildId, userId, page = 1) {
  return new ModalBuilder()
    .setCustomId(`automod:test_text_submit:${guildId}:${userId}:${page}`)
    .setTitle('AutoMod Text Scanner Test')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('sample_text')
          .setLabel('Paste sample text to test')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Hello check out my discord.gg/invite link or f.u.c.k...')
          .setRequired(true)
          .setMaxLength(2000)
      )
    );
}

/**
 * Builds modal for adding a custom regex rule
 */
export function buildAddRegexModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`automod:regex_add_submit:${guildId}:${userId}:3`)
    .setTitle('Add Custom Regex Rule')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rule_name')
          .setLabel('Rule Name')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('No Telegram Links')
          .setRequired(true)
          .setMaxLength(50)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rule_pattern')
          .setLabel('Regex Pattern (Max 200 chars, ReDoS-safe)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('t\\.me\\/[a-zA-Z0-9_]+')
          .setRequired(true)
          .setMaxLength(200)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rule_flags')
          .setLabel('Regex Flags (e.g. i)')
          .setStyle(TextInputStyle.Short)
          .setValue('i')
          .setRequired(false)
          .setMaxLength(5)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('rule_action')
          .setLabel('Action (delete, warn, timeout, kick, ban)')
          .setStyle(TextInputStyle.Short)
          .setValue('delete')
          .setRequired(false)
          .setMaxLength(10)
      )
    );
}

/**
 * Builds modal for testing a regex pattern against sample text
 */
export function buildTestRegexModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`automod:regex_test_submit:${guildId}:${userId}:3`)
    .setTitle('Test Regex Pattern')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('test_pattern')
          .setLabel('Regex Pattern')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https?:\\/\\/t\\.me\\/[a-zA-Z0-9_]+')
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('test_sample')
          .setLabel('Sample Text')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Join here: https://t.me/example_group')
          .setRequired(true)
      )
    );
}

/**
 * Builds modal for adjusting strike thresholds
 */
export function buildStrikeThresholdsModal(guildId, userId, settings) {
  return new ModalBuilder()
    .setCustomId(`automod:strikes_submit:${guildId}:${userId}:7`)
    .setTitle('Configure Strike Escalations')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('timeout_strikes')
          .setLabel('Timeout Threshold (Strikes)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(settings.strike_threshold_timeout || 3))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('kick_strikes')
          .setLabel('Kick Threshold (Strikes)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(settings.strike_threshold_kick || 5))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('ban_strikes')
          .setLabel('Ban Threshold (Strikes)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(settings.strike_threshold_ban || 7))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('expiry_hours')
          .setLabel('Strike Expiry (Hours)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(settings.strike_expiry_hours || 24))
          .setRequired(true)
      )
    );
}

/**
 * Legacy single-view AutoMod Control Panel adhering strictly to Components V2 and pure grey buttons
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAutoModPanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isEnabled = guildSettings.automod_enabled !== false && guildSettings.enabled !== false;
  const antiInvites = !!(guildSettings.automod_anti_invites ?? guildSettings.anti_invites);
  const antiLinks = !!(guildSettings.automod_anti_links ?? guildSettings.anti_links);
  const antiSpam = !!(guildSettings.automod_anti_spam ?? guildSettings.anti_spam);
  const antiMentions = !!(guildSettings.automod_anti_mentions ?? guildSettings.anti_mentions);
  const antiCaps = !!(guildSettings.automod_anti_caps ?? guildSettings.anti_caps);
  const wordFilter = !!(guildSettings.automod_word_filter ?? guildSettings.word_filter);
  const bannedWords = Array.isArray(guildSettings.automod_banned_words) ? guildSettings.automod_banned_words : [];
  const action = guildSettings.automod_action || guildSettings.action || 'delete';
  const logChanId = guildSettings.automod_log_channel_id || guildSettings.log_channel_id;

  const exceptionRoleId = guildSettings.automod_exception_role_id;
  const ignoredRoles = Array.isArray(guildSettings.automod_ignored_role_ids) ? guildSettings.automod_ignored_role_ids : [];
  const allExceptIds = Array.from(new Set([exceptionRoleId, ...ignoredRoles].filter(Boolean)));
  const exceptDisplay = allExceptIds.length > 0
    ? allExceptIds.map(id => `<@&${id}>`).join(', ')
    : '`None (All members checked)`';

  const actionDisplay = {
    delete: 'Delete message only',
    warn: 'Delete message and issue warning',
    timeout: 'Delete message and 5m timeout'
  }[action] || 'Delete message only';

  const logDisplay = logChanId ? `<#${logChanId}>` : '`None (Not configured)`';

  const content =
    `# 🛡️ AutoMod Interactive Control Panel\n` +
    `Configure automated moderation filters, enforcement actions, and incident logging.\n\n` +
    `### Protection Filters & Status\n` +
    `- **System State:** ${isEnabled ? '🟢 **Active**' : '🔴 **Disabled**'}\n` +
    `- **Anti-Invites:** ${antiInvites ? '🟢 Enabled' : '⚪ Disabled'} — Block server invite links\n` +
    `- **Anti-Links:** ${antiLinks ? '🟢 Enabled' : '⚪ Disabled'} — Block external web links\n` +
    `- **Anti-Spam:** ${antiSpam ? '🟢 Enabled' : '⚪ Disabled'} — Rate limit & duplicate flood detection\n` +
    `- **Mass Mentions:** ${antiMentions ? '🟢 Enabled' : '⚪ Disabled'} — Block messages with >4 mentions\n` +
    `- **Anti-Caps:** ${antiCaps ? '🟢 Enabled' : '⚪ Disabled'} — Block >70% uppercase messages\n` +
    `- **Word Blacklist:** ${wordFilter ? '🟢 Enabled' : '⚪ Disabled'} — **${bannedWords.length}** prohibited phrase(s)\n\n` +
    `### Enforcement & Exceptions\n` +
    `- **Current Action:** **${actionDisplay}**\n` +
    `- **Log Channel:** ${logDisplay}\n` +
    `- **Exception Role(s):** ${exceptDisplay} *(Members with this role bypass all AutoMod checks)*\n\n` +
    `*Use the buttons and dropdown menus below to adjust rules, exception roles, and enforcement instantly.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Core Protection Toggles (5 buttons max) - ALL pure grey buttons
  const row1 = new ActionRowBuilder().addComponents(
    greyButton({ id: 'fb:am:toggle:master', label: isEnabled ? 'AutoMod: ON' : 'AutoMod: OFF' }),
    greyButton({ id: 'fb:am:toggle:invites', label: antiInvites ? 'Invites: ON' : 'Invites: OFF' }),
    greyButton({ id: 'fb:am:toggle:links', label: antiLinks ? 'Links: ON' : 'Links: OFF' }),
    greyButton({ id: 'fb:am:toggle:spam', label: antiSpam ? 'Spam: ON' : 'Spam: OFF' }),
    greyButton({ id: 'fb:am:toggle:mentions', label: antiMentions ? 'Mentions: ON' : 'Mentions: OFF' })
  );

  // Row 2: Secondary Protection Toggles & Utilities (5 buttons max) - ALL pure grey buttons
  const row2 = new ActionRowBuilder().addComponents(
    greyButton({ id: 'fb:am:toggle:caps', label: antiCaps ? 'Caps: ON' : 'Caps: OFF' }),
    greyButton({ id: 'fb:am:toggle:words', label: wordFilter ? 'Words: ON' : 'Words: OFF' }),
    greyButton({ id: 'fb:am:words_modal:0', label: 'Edit Words' }),
    greyButton({ id: 'fb:am:clear_except:0', label: 'Clear Exceptions' }),
    greyButton({ id: 'fb:am:refresh:0', label: 'Refresh' })
  );

  // Row 3: Action Dropdown
  const row3 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('fb:am:action_sel:0')
      .setPlaceholder('Select Enforcement Action...')
      .addOptions([
        {
          label: 'Delete Only',
          value: 'delete',
          description: 'Silently delete the offending message',
          default: action === 'delete'
        },
        {
          label: 'Delete & Warn',
          value: 'warn',
          description: 'Delete message and post temporary warning',
          default: action === 'warn'
        },
        {
          label: 'Delete & Timeout',
          value: 'timeout',
          description: 'Delete message and timeout member for 5 minutes',
          default: action === 'timeout'
        }
      ])
  );

  // Row 4: Role Select Menu
  const row4 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:am:except_role:0')
      .setPlaceholder('Select Exception Role(s) to Bypass AutoMod...')
      .setMinValues(0)
      .setMaxValues(10)
  );

  // Row 5: Channel Select Menu
  const row5 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('fb:am:chan_sel:0')
      .setPlaceholder('Set AutoMod Incident Log Channel...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  container.addActionRowComponents(row1, row2, row3, row4, row5);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Legacy modal for editing banned words
 * @param {string[]} currentWords
 * @returns {ModalBuilder}
 */
export function buildBannedWordsModal(currentWords = []) {
  const modal = new ModalBuilder()
    .setCustomId('fb:am:words_submit:0')
    .setTitle('AutoMod Prohibited Words');

  const wordsInput = new TextInputBuilder()
    .setCustomId('words_list')
    .setLabel('Blacklisted Words (Comma or line separated)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('badword, scam, free nitro, discord.gift')
    .setValue(currentWords.join(', '))
    .setRequired(false)
    .setMaxLength(2000);

  modal.addComponents(new ActionRowBuilder().addComponents(wordsInput));
  return modal;
}

export default {
  TOTAL_PAGES,
  PAGE_TITLES,
  buildAutoModWizard,
  buildAutoModPanel,
  buildBannedWordsModal,
  buildAddWordModal,
  buildRemoveWordModal,
  buildTestTextModal,
  buildAddRegexModal,
  buildTestRegexModal,
  buildStrikeThresholdsModal
};

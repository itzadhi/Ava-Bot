import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';

/**
 * Builds the interactive Components V2 AutoMod Control Panel
 * @param {object} guildSettings
 * @param {import('discord.js').Guild} [guild]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAutoModPanel(guildSettings, guild = null) {
  const container = new ContainerBuilder();

  const isEnabled = guildSettings.automod_enabled !== false;
  const antiInvites = !!guildSettings.automod_anti_invites;
  const antiLinks = !!guildSettings.automod_anti_links;
  const antiSpam = !!guildSettings.automod_anti_spam;
  const antiMentions = !!guildSettings.automod_anti_mentions;
  const antiCaps = !!guildSettings.automod_anti_caps;
  const wordFilter = !!guildSettings.automod_word_filter;
  const bannedWords = Array.isArray(guildSettings.automod_banned_words) ? guildSettings.automod_banned_words : [];
  const action = guildSettings.automod_action || 'delete';
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

  // Professional typography: # Heading, ### Subheadings, - Bullets, **Bold** formatting
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

  // Row 1: Core Protection Toggles (5 buttons max)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:master')
      .setLabel(isEnabled ? 'AutoMod: ON' : 'AutoMod: OFF')
      .setStyle(isEnabled ? ButtonStyle.Success : ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:invites')
      .setLabel(antiInvites ? 'Invites: ON' : 'Invites: OFF')
      .setStyle(antiInvites ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:links')
      .setLabel(antiLinks ? 'Links: ON' : 'Links: OFF')
      .setStyle(antiLinks ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:spam')
      .setLabel(antiSpam ? 'Spam: ON' : 'Spam: OFF')
      .setStyle(antiSpam ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:mentions')
      .setLabel(antiMentions ? 'Mentions: ON' : 'Mentions: OFF')
      .setStyle(antiMentions ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );

  // Row 2: Secondary Protection Toggles & Utilities (5 buttons max)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:caps')
      .setLabel(antiCaps ? 'Caps: ON' : 'Caps: OFF')
      .setStyle(antiCaps ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:toggle:words')
      .setLabel(wordFilter ? 'Words: ON' : 'Words: OFF')
      .setStyle(wordFilter ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:words_modal:0')
      .setLabel('Edit Words')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:clear_except:0')
      .setLabel('Clear Exceptions')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:am:refresh:0')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
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

  // Row 4: Role Select Menu for AutoMod Exception / Bypass Roles
  const row4 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('fb:am:except_role:0')
      .setPlaceholder('Select Exception Role(s) to Bypass AutoMod...')
      .setMinValues(0)
      .setMaxValues(10)
  );

  // Row 5: Channel Select Menu for AutoMod Incident Logging
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
 * Builds the modal for editing banned words
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

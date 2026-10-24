import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import * as format from '../../utils/ui/format.js';

export const TOTAL_ANTINUKE_PAGES = 7;
export const ANTINUKE_PAGE_TITLES = [
  'Status & Health',
  'Trusted Roles & Owners',
  'Channel Restoration',
  'Protected Exceptions',
  'Auto Lockdown',
  'Extra Protections',
  'Logs & Configuration Summary'
];

export const TOTAL_PAGES = TOTAL_ANTINUKE_PAGES;
export const PAGE_TITLES = ANTINUKE_PAGE_TITLES;

/**
 * Checks required permissions for bot to effectively protect the server
 * @param {import('discord.js').Guild} guild
 * @returns {{ healthy: boolean, missing: string[] }}
 */
export function checkBotPermissions(guild) {
  const me = guild?.members?.me;
  if (!me) return { healthy: true, missing: [] };

  if (me.permissions?.has(PermissionFlagsBits.Administrator)) {
    return { healthy: true, missing: [] };
  }

  const required = [
    { bit: PermissionFlagsBits.ManageChannels, name: 'Manage Channels' },
    { bit: PermissionFlagsBits.ManageRoles, name: 'Manage Roles' },
    { bit: PermissionFlagsBits.BanMembers, name: 'Ban Members' },
    { bit: PermissionFlagsBits.KickMembers, name: 'Kick Members' },
    { bit: PermissionFlagsBits.ViewAuditLog, name: 'View Audit Log' }
  ];

  const missing = [];
  for (const r of required) {
    if (!me.permissions.has(r.bit)) {
      missing.push(r.name);
    }
  }

  return {
    healthy: missing.length === 0,
    missing
  };
}

/**
 * Builds the text progress bar: e.g. ▰▰▰▱▱▱▱ 3/7
 */
function buildProgressBar(page, total = TOTAL_ANTINUKE_PAGES) {
  const filled = '▰'.repeat(page);
  const empty = '▱'.repeat(total - page);
  return `\`${filled}${empty} ${page}/${total}\` • **${ANTINUKE_PAGE_TITLES[page - 1]}**`;
}

/**
 * Builds grey navigation row for Anti-Nuke panel
 */
function buildNavRow(guildId, userId, page) {
  const hasPrev = page > 1;
  const hasNext = page < TOTAL_ANTINUKE_PAGES;

  return new ActionRowBuilder().addComponents(
    greyButton({
      id: `antinuke:nav:${guildId}:${userId}:${page - 1}`,
      label: '◀ Back',
      disabled: !hasPrev
    }),
    greyButton({
      id: `antinuke:noop:${guildId}:${userId}:${page}`,
      label: `‹ Page ${page} / ${TOTAL_ANTINUKE_PAGES} ›`,
      disabled: true
    }),
    greyButton({
      id: `antinuke:nav:${guildId}:${userId}:${page + 1}`,
      label: 'Next ▶',
      disabled: !hasNext
    }),
    greyButton({
      id: `antinuke:close:${guildId}:${userId}:${page}`,
      label: 'Close',
      emoji: '✖'
    })
  );
}

/**
 * Renders the 7-page paginated Components V2 Anti-Nuke Control Wizard
 *
 * @param {object} options
 * @param {import('discord.js').Guild} options.guild
 * @param {string} options.userId
 * @param {number} [options.page=1]
 * @param {object} options.settings
 * @param {object} options.trusted
 * @param {object} options.exempt
 * @param {string|null} [options.ticketCategoryId=null]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildAntiNukeWizard(arg1 = {}, maybeUserId = null, maybePage = 1, maybeSettings = {}) {
  let guild, userId, page, settings, trusted, exempt, ticketCategoryId;

  if (typeof arg1 === 'object' && arg1 !== null && !Array.isArray(arg1) && (arg1.guild !== undefined || arg1.settings !== undefined || arg1.userId !== undefined || arg1.page !== undefined)) {
    ({
      guild,
      userId,
      page = 1,
      settings = {},
      trusted = { users: [], roles: [], extraOwners: [] },
      exempt = { categories: [], channels: [] },
      ticketCategoryId = null
    } = arg1);
  } else {
    guild = typeof arg1 === 'string' ? { id: arg1, name: 'Server', channels: { cache: new Map() }, roles: { cache: new Map() } } : arg1;
    userId = maybeUserId;
    page = maybePage || 1;
    settings = maybeSettings || {};
    trusted = { users: [], roles: [], extraOwners: [] };
    exempt = { categories: [], channels: [] };
    ticketCategoryId = null;
  }

  if (!guild || typeof guild !== 'object') {
    guild = { id: 'unknown_guild', name: 'Server', channels: { cache: new Map() }, roles: { cache: new Map() } };
  }
  if (!settings || typeof settings !== 'object') {
    settings = { enabled: false, dry_run: false, thresholds: {} };
  }
  if (!trusted || typeof trusted !== 'object') {
    trusted = { users: [], roles: [], extraOwners: [] };
  }
  if (!exempt || typeof exempt !== 'object') {
    exempt = { categories: [], channels: [] };
  }

  const container = new ContainerBuilder();
  const safePage = Math.max(1, Math.min(page, TOTAL_ANTINUKE_PAGES));
  const isEnabled = Boolean(settings.enabled);
  const isDryRun = Boolean(settings.dry_run);
  const progressBar = buildProgressBar(safePage);

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 1: STATUS & PRE-CHECKS
  // ─────────────────────────────────────────────────────────────────────────
  if (safePage === 1) {
    const permCheck = checkBotPermissions(guild);
    const permStatus = permCheck.healthy
      ? '🟢 **All Required Permissions Granted**'
      : `⚠️ **Missing Permissions:** ${permCheck.missing.map(p => `\`${p}\``).join(', ')}`;

    const botRolePos = guild?.members?.me?.roles?.highest?.position || 0;
    const hierarchyStatus = botRolePos >= (guild.roles.cache.size - 3)
      ? '🟢 **Role Hierarchy Optimal** (Bot role is high)'
      : '⚠️ **Bot Role Position Moderate** (Place bot role near the top to protect high roles)';

    const lines = [
      `## 🛡️ Anti-Nuke Security Defense System`,
      `${progressBar}`,
      ``,
      `Comprehensive automated protection against rogue administrators, account compromises, mass channel deletions, and raid attacks.`,
      ``,
      `### Protection Status`,
      `- **System State:** ${isEnabled ? '🟢 **Armed & Active**' : '⚪ **Disabled**'}`,
      `- **Execution Mode:** ${isDryRun ? '🟡 **Dry Run (Audit Log Only, No Punishments)**' : '⚡ **Active Enforcement (Immediate Action)**'}`,
      `- **Bot Permissions:** ${permStatus}`,
      `- **Role Hierarchy:** ${hierarchyStatus}`,
      `- **Immunity Note:** Server Owner <@${guild.ownerId}> and the bot are permanently immune.`,
      ``,
      `*Use the buttons below to toggle state or test settings.*`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const stateSelect = new StringSelectMenuBuilder()
      .setCustomId(`antinuke:state_select:${guild.id}:${userId}:1`)
      .setPlaceholder('Choose Anti-Nuke state...')
      .addOptions([
        {
          label: 'Active Enforcement (Recommended)',
          value: 'active',
          description: 'Immediate automated defense and punishments applied',
          emoji: '⚡',
          default: isEnabled && !isDryRun
        },
        {
          label: 'Dry Run (Audit Only)',
          value: 'dry_run',
          description: 'Log attacks in audit channel without executing punishments',
          emoji: '🟡',
          default: isEnabled && isDryRun
        },
        {
          label: 'Disabled',
          value: 'disabled',
          description: 'Turn off automated security enforcement',
          emoji: '⚪',
          default: !isEnabled
        }
      ]);

    const selectRow = new ActionRowBuilder().addComponents(stateSelect);
    const actionRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:snapshot_all:${guild.id}:${userId}:1`,
        label: 'Refresh Snapshots',
        emoji: '🔄'
      })
    );

    container.addActionRowComponents(selectRow, actionRow, buildNavRow(guild.id, userId, 1));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 2: TRUSTED ROLES & EXTRA OWNERS
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 2) {
    const trustedRolesDisplay = trusted.roles?.length > 0
      ? trusted.roles.map(id => `<@&${id}>`).join(', ')
      : '`None (No extra trusted roles configured)`';

    const trustedUsersDisplay = trusted.users?.length > 0
      ? trusted.users.map(id => `<@${id}>`).join(', ')
      : '`None`';

    const extraOwnersDisplay = trusted.extraOwners?.length > 0
      ? trusted.extraOwners.map(id => `<@${id}>`).join(', ')
      : '`None`';

    const lines = [
      `## 👥 Trusted Entities & Whitelist`,
      `${progressBar}`,
      ``,
      `Trusted roles and users are completely immune to Anti-Nuke thresholds and punishments.`,
      ``,
      `### Active Whitelist`,
      `- **Server Owner:** <@${guild.ownerId}> *(Permanent Immunity)*`,
      `- **Extra Owners:** ${extraOwnersDisplay}`,
      `- **Trusted Roles:** ${trustedRolesDisplay}`,
      `- **Trusted Users:** ${trustedUsersDisplay}`,
      ``,
      `*Select roles or users below to grant Anti-Nuke immunity instantly.*`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const roleSelectRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`antinuke:trusted_roles_sel:${guild.id}:${userId}:2`)
        .setPlaceholder('Select trusted role(s)...')
        .setMinValues(0)
        .setMaxValues(10)
    );

    const userSelectRow = new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(`antinuke:trusted_users_sel:${guild.id}:${userId}:2`)
        .setPlaceholder('Select trusted user(s)...')
        .setMinValues(0)
        .setMaxValues(10)
    );

    const actionsRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:extra_owner_modal:${guild.id}:${userId}:2`,
        label: 'Add Extra Owner',
        emoji: '👑'
      }),
      greyButton({
        id: `antinuke:clear_trusted:${guild.id}:${userId}:2`,
        label: 'Clear Custom Trusted',
        emoji: '🗑️'
      })
    );

    container.addActionRowComponents(roleSelectRow, userSelectRow, actionsRow, buildNavRow(guild.id, userId, 2));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 3: CHANNEL RESTORATION
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 3) {
    const limits = settings.thresholds || {};
    const deleteLimit = limits.channel_delete_limit || 3;
    const windowSecs = limits.channel_delete_window_seconds || 10;
    const restoreSingle = Boolean(limits.restore_single_deletions);
    const punishment = settings.punishment || 'ban';

    const lines = [
      `## 📁 Channel Restoration Engine`,
      `${progressBar}`,
      ``,
      `Maintains secure snapshots of all server channels. When an unauthorized user deletes channels rapidly, the executor is neutralized and all deleted channels are recreated.`,
      ``,
      `### Configuration Parameters`,
      `- **Mass Delete Threshold:** **${deleteLimit} channels** within **${windowSecs}s**`,
      `- **Restore Single Deletions:** ${restoreSingle ? '🟢 **Enabled** (Even 1 deletion restored)' : '⚪ **Disabled** (Only mass deletions restored)'}`,
      `- **Offender Punishment:** \`${punishment.toUpperCase()}\``,
      `- **Preservation Details:** Categories, order, topics, bitrate, and permission overwrites restored.`,
      `- **Channel Re-linking:** Automatically updates log channels, tickets, and panels with new IDs.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const restoreSelect = new StringSelectMenuBuilder()
      .setCustomId(`antinuke:single_restore_select:${guild.id}:${userId}:3`)
      .setPlaceholder('Single deletion restore behavior...')
      .addOptions([
        {
          label: 'Restore Single & Mass Deletions (High Security)',
          value: 'true',
          description: 'Recreate channels even if only 1 is deleted by an unauthorized user',
          emoji: '🛡️',
          default: restoreSingle
        },
        {
          label: 'Mass Deletions Only (Standard)',
          value: 'false',
          description: 'Only trigger channel rebuilds when mass deletion threshold is reached',
          emoji: '📁',
          default: !restoreSingle
        }
      ]);

    const punishmentRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`antinuke:punishment_sel:${guild.id}:${userId}:3`)
        .setPlaceholder('Select Offender Punishment...')
        .addOptions([
          { label: 'Ban Member', value: 'ban', description: 'Permanently ban offender from server', default: punishment === 'ban' },
          { label: 'Kick Member', value: 'kick', description: 'Kick offender from server', default: punishment === 'kick' },
          { label: 'Strip All Roles', value: 'strip_roles', description: 'Strip non-managed roles immediately', default: punishment === 'strip_roles' },
          { label: 'Timeout 24h', value: 'timeout', description: 'Apply 24-hour timeout', default: punishment === 'timeout' }
        ])
    );

    const limitsRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:channel_threshold_modal:${guild.id}:${userId}:3`,
        label: 'Edit Limits via Modal',
        emoji: '⚙️'
      })
    );

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(restoreSelect),
      punishmentRow,
      limitsRow,
      buildNavRow(guild.id, userId, 3)
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 4: EXCEPTIONS (TICKET CATEGORY & CUSTOM CHANNELS)
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 4) {
    const ticketDisplay = ticketCategoryId
      ? `<#${ticketCategoryId}> *(Locked: Automatically Detected from Ticket Settings)*`
      : '`None Detected`';

    const exemptChansDisplay = exempt.channels?.length > 0
      ? exempt.channels.map(id => `<#${id}>`).join(', ')
      : '`None`';

    const exemptCatsDisplay = exempt.categories?.length > 0
      ? exempt.categories.map(id => `<#${id}>`).join(', ')
      : '`None`';

    const lines = [
      `## 🔒 Protected Exemptions`,
      `${progressBar}`,
      ``,
      `Exempt channels and categories are never snapshotted, never restored, never counted towards mass deletion triggers, and never locked down.`,
      ``,
      `### Automatic Exemption`,
      `- **Ticket Category:** ${ticketDisplay}`,
      `- **Active Ticket Channels:** 🟢 Automatically protected from moderation interference`,
      ``,
      `### Custom Exemptions`,
      `- **Exempt Categories:** ${exemptCatsDisplay}`,
      `- **Exempt Channels:** ${exemptChansDisplay}`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const channelSelectRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`antinuke:exempt_channels_sel:${guild.id}:${userId}:4`)
        .setPlaceholder('Select channels to exempt...')
        .setMinValues(0)
        .setMaxValues(10)
    );

    const categorySelectRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`antinuke:exempt_categories_sel:${guild.id}:${userId}:4`)
        .setPlaceholder('Select categories to exempt...')
        .setChannelTypes(ChannelType.GuildCategory)
        .setMinValues(0)
        .setMaxValues(10)
    );

    const clearRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:clear_exempt:${guild.id}:${userId}:4`,
        label: 'Clear Custom Exemptions',
        emoji: '🗑️'
      })
    );

    container.addActionRowComponents(channelSelectRow, categorySelectRow, clearRow, buildNavRow(guild.id, userId, 4));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 5: AUTO LOCKDOWN
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 5) {
    const limits = settings.thresholds || {};
    const raidUsers = limits.raid_distinct_users || 5;
    const raidWindow = limits.raid_window_seconds || 5;
    const calmSecs = limits.lockdown_calm_seconds || 60;
    const maxSecs = limits.lockdown_max_duration_seconds || 900;
    const lPunishment = settings.lockdown_punishment || 'ban';

    const lines = [
      `## 🚨 Auto Lockdown Defense`,
      `${progressBar}`,
      ``,
      `Detects coordinated multi-user spam waves and joins raids in real-time. Immediately restricts @everyone send permissions, purges spam messages, and neutralizes raid participants.`,
      ``,
      `### Raid Triggers & Scope`,
      `- **Raid Detection:** **${raidUsers} users** spamming within **${raidWindow}s**`,
      `- **Spammer Punishment:** \`${lPunishment.toUpperCase()}\``,
      `- **Calm Countdown:** **${calmSecs}s** without spam to automatically lift lockdown`,
      `- **Maximum Safety Duration:** **${Math.round(maxSecs / 60)} minutes** (Prevents permanent lock)`,
      `- **Exact State Restoration:** Original channel overwrites saved to Supabase and restored cleanly.`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const modalBtnRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:lockdown_modal:${guild.id}:${userId}:5`,
        label: 'Configure Raid Thresholds',
        emoji: '⚙️'
      })
    );

    const punishmentRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`antinuke:lockdown_punishment_sel:${guild.id}:${userId}:5`)
        .setPlaceholder('Select Raid Spammer Punishment...')
        .addOptions([
          { label: 'Ban Participants', value: 'ban', description: 'Ban participants and purge up to 1 day of messages', default: lPunishment === 'ban' },
          { label: 'Kick Participants', value: 'kick', description: 'Kick all participating raid accounts', default: lPunishment === 'kick' }
        ])
    );

    container.addActionRowComponents(modalBtnRow, punishmentRow, buildNavRow(guild.id, userId, 5));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 6: EXTRA PROTECTIONS
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 6) {
    const limits = settings.thresholds || {};
    const botAddOn = limits.bot_add_protection !== false;
    const dangPermsOn = limits.dangerous_perm_grant !== false;
    const massRoleLimit = limits.mass_role_delete_limit || 3;
    const webhookLimit = limits.webhook_spam_limit || 3;

    const lines = [
      `## 🛡️ Extra Server Protections`,
      `${progressBar}`,
      ``,
      `Specialized heuristics for roles, permissions, webhooks, and unauthorized bot additions.`,
      ``,
      `### Safeguard Toggles`,
      `- **Mass Role Deletion:** Limit **${massRoleLimit} roles** (recreates deleted roles automatically)`,
      `- **Bot Add Protection:** ${botAddOn ? '🟢 **Enabled**' : '⚪ **Disabled**'} (Unauthorized bots kicked immediately)`,
      `- **Dangerous Permission Grants:** ${dangPermsOn ? '🟢 **Enabled**' : '⚪ **Disabled**'} (Reverts Administrator added to roles)`,
      `- **Webhook Spam Protection:** Limit **${webhookLimit} webhooks** within 10s`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const togglesRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:toggle_bot_add:${guild.id}:${userId}:6`,
        label: botAddOn ? 'Bot Protection: ON' : 'Bot Protection: OFF',
        emoji: '🤖'
      }),
      greyButton({
        id: `antinuke:toggle_dang_perms:${guild.id}:${userId}:6`,
        label: dangPermsOn ? 'Perm Guards: ON' : 'Perm Guards: OFF',
        emoji: '🔒'
      }),
      greyButton({
        id: `antinuke:extra_limits_modal:${guild.id}:${userId}:6`,
        label: 'Edit Limits',
        emoji: '⚙️'
      })
    );

    container.addActionRowComponents(togglesRow, buildNavRow(guild.id, userId, 6));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PAGE 7: LOGS & SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  else if (safePage === 7) {
    const logChanId = settings.log_channel_id;
    const alertChanId = settings.alert_channel_id;
    const pingRoleId = settings.ping_role_id;

    const logDisplay = logChanId ? `<#${logChanId}>` : '`Not configured`';
    const alertDisplay = alertChanId ? `<#${alertChanId}>` : '`Same as Log Channel`';
    const pingDisplay = pingRoleId ? `<@&${pingRoleId}>` : '`No role pinged`';

    const lines = [
      `## 📢 Incident Auditing & Final Summary`,
      `${progressBar}`,
      ``,
      `Review configuration and assign output audit channels and staff alert roles.`,
      ``,
      `### Channels & Notifications`,
      `- **Incident Log Channel:** ${logDisplay}`,
      `- **Emergency Alert Channel:** ${alertDisplay}`,
      `- **Staff Ping Role:** ${pingDisplay}`,
      ``,
      `### Protection Architecture Overview`,
      `- **Channel Restore:** Active with live Supabase snapshots & database ID remapping`,
      `- **Auto Lockdown:** Sliding window raid detection with calm timers and exact overwrite recovery`,
      `- **Immunity:** Permanent for Server Owner, whitelisted roles & Permify owners`
    ].join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));
    container.addSeparatorComponents(new SeparatorBuilder());

    const chanRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`antinuke:log_channel_sel:${guild.id}:${userId}:7`)
        .setPlaceholder('Set Incident Log Channel...')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );

    const alertChanRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(`antinuke:alert_channel_sel:${guild.id}:${userId}:7`)
        .setPlaceholder('Set Emergency Alert Channel...')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    );

    const pingRoleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`antinuke:ping_role_sel:${guild.id}:${userId}:7`)
        .setPlaceholder('Set Staff Ping Role...')
        .setMinValues(0)
        .setMaxValues(1)
    );

    const saveRow = new ActionRowBuilder().addComponents(
      greyButton({
        id: `antinuke:close:${guild.id}:${userId}:7`,
        label: 'Save and Close',
        emoji: '💾'
      })
    );

    container.addActionRowComponents(chanRow, alertChanRow, pingRoleRow, saveRow, buildNavRow(guild.id, userId, 7));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds Channel Threshold Modal
 */
export function buildChannelThresholdModal(guildId, userId, thresholds = {}) {
  return new ModalBuilder()
    .setCustomId(`antinuke:channel_threshold_submit:${guildId}:${userId}:3`)
    .setTitle('Channel Deletion Thresholds')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('delete_limit')
          .setLabel('Deletion Limit (Number of Channels)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.channel_delete_limit || 3))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('window_seconds')
          .setLabel('Sliding Window (Seconds)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.channel_delete_window_seconds || 10))
          .setRequired(true)
      )
    );
}

/**
 * Builds Raid Lockdown Threshold Modal
 */
export function buildLockdownThresholdModal(guildId, userId, thresholds = {}) {
  return new ModalBuilder()
    .setCustomId(`antinuke:lockdown_submit:${guildId}:${userId}:5`)
    .setTitle('Auto Lockdown Thresholds')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('raid_users')
          .setLabel('Distinct Users Limit')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.raid_distinct_users || 5))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('raid_window')
          .setLabel('Detection Window (Seconds)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.raid_window_seconds || 5))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('calm_seconds')
          .setLabel('Calm Period Before Unlock (Seconds)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.lockdown_calm_seconds || 60))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('max_duration')
          .setLabel('Max Lockdown Duration (Seconds, max 3600)')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.lockdown_max_duration_seconds || 900))
          .setRequired(true)
      )
    );
}

/**
 * Builds Extra Limits Modal
 */
export function buildExtraLimitsModal(guildId, userId, thresholds = {}) {
  return new ModalBuilder()
    .setCustomId(`antinuke:extra_limits_submit:${guildId}:${userId}:6`)
    .setTitle('Extra Protection Limits')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('role_delete_limit')
          .setLabel('Mass Role Deletion Limit')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.mass_role_delete_limit || 3))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('webhook_spam_limit')
          .setLabel('Webhook Creation Spam Limit')
          .setStyle(TextInputStyle.Short)
          .setValue(String(thresholds.webhook_spam_limit || 3))
          .setRequired(true)
      )
    );
}

/**
 * Builds Extra Owner Modal
 */
export function buildExtraOwnerModal(guildId, userId) {
  return new ModalBuilder()
    .setCustomId(`antinuke:extra_owner_submit:${guildId}:${userId}:2`)
    .setTitle('Add Extra Server Owner')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('extra_owner_id')
          .setLabel('User ID of Extra Owner')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('123456789012345678')
          .setRequired(true)
      )
    );
}

export default {
  TOTAL_ANTINUKE_PAGES,
  ANTINUKE_PAGE_TITLES,
  checkBotPermissions,
  buildAntiNukeWizard,
  buildChannelThresholdModal,
  buildLockdownThresholdModal,
  buildExtraLimitsModal,
  buildExtraOwnerModal
};

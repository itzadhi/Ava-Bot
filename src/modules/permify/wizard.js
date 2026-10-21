import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { paginatedSelect } from '../../utils/ui/paginatedSelect.js';
import { getTicketSettings } from '../../db/tickets.js';

/**
 * Builds the visual progress bar string for steps
 * e.g. "▰▰▰▱▱▱▱ 3/7"
 * @param {number} current
 * @param {number} total
 * @returns {string}
 */
export function buildProgressBar(current, total = 7) {
  const safeCurrent = Math.min(Math.max(1, current), total);
  const filled = '▰'.repeat(safeCurrent);
  const empty = '▱'.repeat(total - safeCurrent);
  return `${filled}${empty} ${safeCurrent}/${total}`;
}

/**
 * Returns type emoji for Discord channel types
 * @param {number} type
 * @returns {string}
 */
function getChannelEmoji(type) {
  switch (type) {
    case ChannelType.GuildText: return '💬';
    case ChannelType.GuildAnnouncement: return '📢';
    case ChannelType.GuildVoice: return '🔊';
    case ChannelType.GuildStageVoice: return '🎭';
    case ChannelType.GuildForum: return '📋';
    default: return '📁';
  }
}

/**
 * Helper to build common footer navigation row of grey buttons
 * Max 3 buttons per row: [◀ Back] [Next ▶ / Apply] [Cancel]
 */
function buildFooterRow({ guildId, userId, step, hasBack = true, isConfirm = false }) {
  const buttons = [];

  if (hasBack) {
    buttons.push(
      greyButton({
        id: `permify:nav_prev:${guildId}:${userId}:${step}`,
        label: '◀ Back'
      })
    );
  }

  if (isConfirm) {
    buttons.push(
      greyButton({
        id: `permify:open_confirm:${guildId}:${userId}:${step}`,
        label: 'Apply Everything ⚙️'
      })
    );
  } else {
    buttons.push(
      greyButton({
        id: `permify:nav_next:${guildId}:${userId}:${step}`,
        label: 'Next ▶'
      })
    );
  }

  buttons.push(
    greyButton({
      id: `permify:cancel:${guildId}:${userId}:${step}`,
      label: 'Cancel ✕'
    })
  );

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Renders the full Components V2 wizard card for any given step
 *
 * @param {object} session
 * @param {import('discord.js').Guild} guild
 * @returns {object} Discord message options payload
 */
export async function renderWizardStep(session, guild) {
  const container = new ContainerBuilder();
  const { guildId, userId, step } = session;

  switch (step) {
    case 1:
      renderStep1(container, session, guild);
      break;
    case 2:
      renderStep2(container, session, guild);
      break;
    case 3:
      renderStep3(container, session, guild);
      break;
    case 4:
      renderStep4(container, session, guild);
      break;
    case 5:
      renderStep5(container, session, guild);
      break;
    case 6:
      renderStep6(container, session, guild);
      break;
    case 7:
    default:
      await renderStep7(container, session, guild);
      break;
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1: RESET SCOPE
// ─────────────────────────────────────────────────────────────────────────────
function renderStep1(container, session, guild) {
  const { guildId, userId, step, includeCustomOverwrites } = session;

  // Header & progress
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(1, 7)}\n` +
      format.heading(2, 'Step 1/7 - Permission Reset Scope') + '\n' +
      format.subtext('Rebuilds channel permission overwrites from a clean state while preserving server roles.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  // Block quote safety guarantee
  const quoteText = format.blockQuote(
    'All permission overwrites on channels and categories will be cleared and rebuilt.\n' +
    'Server role definitions, role assignments, and permissions are NOT touched.'
  );

  // Live counts
  const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);
  const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice);
  const stageChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildStageVoice);
  const forumChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildForum);
  const totalChannels = categories.size + textChannels.size + voiceChannels.size + stageChannels.size + forumChannels.size;

  let existingOverwritesCount = 0;
  for (const chan of guild.channels.cache.values()) {
    if (chan.permissionOverwrites?.cache) {
      existingOverwritesCount += chan.permissionOverwrites.cache.size;
    }
  }

  const countsText = [
    `• **Categories:** \`${categories.size}\``,
    `• **Text & Announcement Channels:** \`${textChannels.size}\``,
    `• **Voice Channels:** \`${voiceChannels.size}\``,
    `• **Stage Channels:** \`${stageChannels.size}\``,
    `• **Forum Channels:** \`${forumChannels.size}\``,
    `• **Total Channels In Scope:** \`${totalChannels}\``,
    `• **Existing Permission Overwrites:** \`${existingOverwritesCount}\``
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${quoteText}\n\n${countsText}`)
  );

  // Scope Toggle Button (Grey)
  const toggleLabel = includeCustomOverwrites
    ? '[✓] Include channels with custom overwrites (Reset All)'
    : '[ ] Skip channels with custom overwrites';

  const toggleRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `permify:toggle_custom:${guildId}:${userId}:${step}`,
      label: toggleLabel,
      emoji: '⚙️'
    })
  );

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: false });

  container.addActionRowComponents(toggleRow);
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2: STAFF-ONLY-SPEAK CATEGORIES
// ─────────────────────────────────────────────────────────────────────────────
function renderStep2(container, session, guild) {
  const { guildId, userId, step, staffCategoryIds = [], categoryPage = 1 } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(2, 7)}\n` +
      format.heading(2, 'Step 2/7 - Staff-Only-Speak Categories') + '\n' +
      format.subtext('In chosen categories, Staff can speak/send messages while Members can only view/read.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const categories = Array.from(
    guild.channels.cache
      .filter(c => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .values()
  );

  // Selected summary
  const selectedCount = staffCategoryIds.length;
  let summaryBlock = `**Selected Categories:** \`${selectedCount}\``;
  if (selectedCount > 0) {
    const names = staffCategoryIds
      .map(id => guild.channels.cache.get(id)?.name || `Unknown (${id})`)
      .slice(0, 15)
      .join(', ');
    const more = selectedCount > 15 ? ` +${selectedCount - 15} more` : '';
    summaryBlock += `\n${format.quote(names + more)}`;
  } else {
    summaryBlock += `\n${format.quote('No staff-only categories selected.')}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summaryBlock));

  // Build paginated select menu
  const items = categories.map(cat => ({
    label: cat.name.slice(0, 100),
    value: cat.id,
    description: `Channels inside: ${cat.children?.cache?.size || 0}`,
    emoji: '📁'
  }));

  const pag = paginatedSelect({
    items,
    pageSize: 25,
    selected: staffCategoryIds,
    customId: `permify:sel_cat:${guildId}:${userId}:${step}`,
    pageButtonPrefix: `permify:page_cat:${guildId}:${userId}:${step}`,
    page: categoryPage,
    placeholder: 'Choose categories where only staff may speak...'
  });

  if (pag.menuRow) {
    container.addActionRowComponents(pag.menuRow);
  }

  // Control buttons: Select all on page / Clear page / Clear all
  const controlsRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `permify:cat_sel_page:${guildId}:${userId}:${step}`,
      label: 'Select Page',
      emoji: '☑️',
      disabled: pag.isEmpty
    }),
    greyButton({
      id: `permify:cat_clear_page:${guildId}:${userId}:${step}`,
      label: 'Clear Page',
      emoji: '◻️',
      disabled: pag.isEmpty
    }),
    greyButton({
      id: `permify:cat_clear_all:${guildId}:${userId}:${step}`,
      label: 'Clear All',
      emoji: '🗑️',
      disabled: selectedCount === 0
    })
  );
  container.addActionRowComponents(controlsRow);

  if (pag.navRow) {
    container.addActionRowComponents(pag.navRow);
  }

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true });
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: STAFF-ONLY-SPEAK CHANNELS
// ─────────────────────────────────────────────────────────────────────────────
function renderStep3(container, session, guild) {
  const { guildId, userId, step, staffCategoryIds = [], staffChannelIds = [], channelPage = 1 } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(3, 7)}\n` +
      format.heading(2, 'Step 3/7 - Staff-Only-Speak Channels') + '\n' +
      format.subtext('Individual channels where Staff speak and Members view/read only (voice: listen only).')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const categorySet = new Set(staffCategoryIds);

  // Channels to list: text, announcement, voice, stage, forum whose parent is NOT already in staffCategoryIds
  const eligibleChannels = Array.from(
    guild.channels.cache
      .filter(c => {
        const isEligibleType = [
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice,
          ChannelType.GuildForum
        ].includes(c.type);

        if (!isEligibleType) return false;
        // Skip channels already covered by Step 2 category
        if (c.parentId && categorySet.has(c.parentId)) return false;
        return true;
      })
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .values()
  );

  const selectedCount = staffChannelIds.length;
  let summaryBlock = `**Selected Individual Channels:** \`${selectedCount}\``;
  if (selectedCount > 0) {
    const mentions = staffChannelIds
      .slice(0, 15)
      .map(id => `<#${id}>`)
      .join(' ');
    const more = selectedCount > 15 ? ` +${selectedCount - 15} more` : '';
    summaryBlock += `\n${format.quote(mentions + more)}`;
  } else {
    summaryBlock += `\n${format.quote('No individual staff-only channels selected.')}`;
  }

  if (categorySet.size > 0) {
    summaryBlock += `\n-# Note: Channels inside chosen Step 2 categories are already staff-only and automatically skipped here.`;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summaryBlock));

  const items = eligibleChannels.map(chan => {
    const parentName = chan.parentId ? guild.channels.cache.get(chan.parentId)?.name : 'No Category';
    return {
      label: `#${chan.name}`.slice(0, 100),
      value: chan.id,
      description: `Category: ${parentName}`.slice(0, 100),
      emoji: getChannelEmoji(chan.type)
    };
  });

  const pag = paginatedSelect({
    items,
    pageSize: 25,
    selected: staffChannelIds,
    customId: `permify:sel_chan:${guildId}:${userId}:${step}`,
    pageButtonPrefix: `permify:page_chan:${guildId}:${userId}:${step}`,
    page: channelPage,
    placeholder: 'Choose individual channels for staff-only speaking...'
  });

  if (pag.menuRow) {
    container.addActionRowComponents(pag.menuRow);
  }

  const controlsRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `permify:chan_sel_page:${guildId}:${userId}:${step}`,
      label: 'Select Page',
      emoji: '☑️',
      disabled: pag.isEmpty
    }),
    greyButton({
      id: `permify:chan_clear_page:${guildId}:${userId}:${step}`,
      label: 'Clear Page',
      emoji: '◻️',
      disabled: pag.isEmpty
    }),
    greyButton({
      id: `permify:chan_clear_all:${guildId}:${userId}:${step}`,
      label: 'Clear All',
      emoji: '🗑️',
      disabled: selectedCount === 0
    })
  );
  container.addActionRowComponents(controlsRow);

  if (pag.navRow) {
    container.addActionRowComponents(pag.navRow);
  }

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true });
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: STAFF ROLES
// ─────────────────────────────────────────────────────────────────────────────
function renderStep4(container, session, guild) {
  const { guildId, userId, step, staffRoleIds = [] } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(4, 7)}\n` +
      format.heading(2, 'Step 4/7 - Staff Roles') + '\n' +
      format.subtext('Moderators, administrators, and support staff who speak in staff channels and manage tickets.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const count = staffRoleIds.length;
  let summary = `**Configured Staff Roles:** \`${count}\``;
  if (count > 0) {
    const mentions = staffRoleIds.map(id => `<@&${id}>`).join(' ');
    summary += `\n${format.quote(mentions)}\n-# Select more roles to add them. Use the dropdown below to remove individual roles.`;
  } else {
    summary += `\n${format.quote('No staff roles selected yet. Please select at least one.')}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

  // Native Role Select Menu
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`permify:pick_staff:${guildId}:${userId}:${step}`)
    .setPlaceholder('Choose Staff Roles (Multi-Select)...')
    .setMinValues(1)
    .setMaxValues(Math.min(25, guild.roles.cache.size));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));

  // If roles are already selected, offer a remove dropdown and clear button
  if (count > 0) {
    const removeOptions = staffRoleIds.slice(0, 25).map(id => {
      const r = guild.roles.cache.get(id);
      return {
        label: (r?.name || `Role ${id}`).slice(0, 100),
        value: id,
        description: `Remove @${r?.name || id}`.slice(0, 100),
        emoji: '🗑️'
      };
    });

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`permify:rem_staff:${guildId}:${userId}:${step}`)
      .setPlaceholder('Drop a single staff role...')
      .addOptions(removeOptions);

    const clearBtn = greyButton({
      id: `permify:clear_staff:${guildId}:${userId}:${step}`,
      label: 'Clear All Staff Roles',
      emoji: '🗑️'
    });

    container.addActionRowComponents(new ActionRowBuilder().addComponents(removeSelect));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(clearBtn));
  }

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true });
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: MEMBER ROLES
// ─────────────────────────────────────────────────────────────────────────────
function renderStep5(container, session, guild) {
  const { guildId, userId, step, memberRoleIds = [], connectAutorole = true } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(5, 7)}\n` +
      format.heading(2, 'Step 5/7 - Member Roles') + '\n' +
      format.subtext('Verified or standard community roles granting viewing and talking rights in community channels.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const count = memberRoleIds.length;
  let summary = `**Configured Member Roles:** \`${count}\``;
  if (count > 0) {
    const mentions = memberRoleIds.map(id => `<@&${id}>`).join(' ');
    summary += `\n${format.quote(mentions)}\n-# Select more roles to add them. Use the dropdown below to remove individual roles.`;
  } else {
    summary += `\n${format.quote('No member roles selected yet. Please select at least one.')}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

  // Native Role Select Menu
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`permify:pick_member:${guildId}:${userId}:${step}`)
    .setPlaceholder('Choose Member Roles (Multi-Select)...')
    .setMinValues(1)
    .setMaxValues(Math.min(25, guild.roles.cache.size));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));

  // Dropdown to remove single role if selected
  if (count > 0) {
    const removeOptions = memberRoleIds.slice(0, 25).map(id => {
      const r = guild.roles.cache.get(id);
      return {
        label: (r?.name || `Role ${id}`).slice(0, 100),
        value: id,
        description: `Remove @${r?.name || id}`.slice(0, 100),
        emoji: '🗑️'
      };
    });

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`permify:rem_member:${guildId}:${userId}:${step}`)
      .setPlaceholder('Drop a single member role...')
      .addOptions(removeOptions);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(removeSelect));
  }

  // Toggle for connecting to autorole
  const autoroleBtn = greyButton({
    id: `permify:toggle_autorole:${guildId}:${userId}:${step}`,
    label: connectAutorole ? '[✓] Connect Autorole to Member Roles' : '[ ] Connect Autorole to Member Roles',
    emoji: '👤'
  });

  const clearBtn = greyButton({
    id: `permify:clear_member:${guildId}:${userId}:${step}`,
    label: 'Clear All Member Roles',
    emoji: '🗑️',
    disabled: count === 0
  });

  container.addActionRowComponents(new ActionRowBuilder().addComponents(autoroleBtn, clearBtn));

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true });
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: OWNER ROLES
// ─────────────────────────────────────────────────────────────────────────────
function renderStep6(container, session, guild) {
  const { guildId, userId, step, ownerRoleIds = [] } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(6, 7)}\n` +
      format.heading(2, 'Step 6/7 - Owner & Leadership Roles') + '\n' +
      format.subtext('Co-owners, executives, and head administrators with full management powers across all channels.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const count = ownerRoleIds.length;
  let summary = `**Configured Owner Roles:** \`${count}\``;
  if (count > 0) {
    const mentions = ownerRoleIds.map(id => `<@&${id}>`).join(' ');
    summary += `\n${format.quote(mentions)}\n-# Select more roles to add them. Use the dropdown below to remove individual roles.`;
  } else {
    summary += `\n${format.quote('No owner roles selected yet. Please select at least one.')}`;
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

  // Native Role Select Menu
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId(`permify:pick_owner:${guildId}:${userId}:${step}`)
    .setPlaceholder('Choose Owner / Admin Roles (Multi-Select)...')
    .setMinValues(1)
    .setMaxValues(Math.min(25, guild.roles.cache.size));

  container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));

  if (count > 0) {
    const removeOptions = ownerRoleIds.slice(0, 25).map(id => {
      const r = guild.roles.cache.get(id);
      return {
        label: (r?.name || `Role ${id}`).slice(0, 100),
        value: id,
        description: `Remove @${r?.name || id}`.slice(0, 100),
        emoji: '🗑️'
      };
    });

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`permify:rem_owner:${guildId}:${userId}:${step}`)
      .setPlaceholder('Drop a single owner role...')
      .addOptions(removeOptions);

    const clearBtn = greyButton({
      id: `permify:clear_owner:${guildId}:${userId}:${step}`,
      label: 'Clear All Owner Roles',
      emoji: '🗑️'
    });

    container.addActionRowComponents(new ActionRowBuilder().addComponents(removeSelect));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(clearBtn));
  }

  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true });
  container.addActionRowComponents(footerRow);
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7: PREVIEW + CONFIRM
// ─────────────────────────────────────────────────────────────────────────────
async function renderStep7(container, session, guild) {
  const {
    guildId,
    userId,
    step,
    staffRoleIds = [],
    memberRoleIds = [],
    ownerRoleIds = [],
    staffCategoryIds = [],
    staffChannelIds = [],
    hideEveryone = true,
    connectAutorole = true,
    backfillMembers = false
  } = session;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${buildProgressBar(7, 7)}\n` +
      format.heading(2, 'Step 7/7 - Final Preview & Confirmation') + '\n' +
      format.subtext('Review the proposed role groupings, channel scopes, and permission matrix before execution.')
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const staffMentions = staffRoleIds.length > 0 ? staffRoleIds.map(id => `<@&${id}>`).join(' ') : '`None`';
  const memberMentions = memberRoleIds.length > 0 ? memberRoleIds.map(id => `<@&${id}>`).join(' ') : '`None`';
  const ownerMentions = ownerRoleIds.length > 0 ? ownerRoleIds.map(id => `<@&${id}>`).join(' ') : '`None`';

  // Count total channels to reset & rebuild
  const totalChannelsCount = guild.channels.cache.filter(c =>
    c.type === ChannelType.GuildCategory ||
    c.type === ChannelType.GuildText ||
    c.type === ChannelType.GuildAnnouncement ||
    c.type === ChannelType.GuildVoice ||
    c.type === ChannelType.GuildStageVoice ||
    c.type === ChannelType.GuildForum
  ).size;

  const ticketSettings = await getTicketSettings(guild.id).catch(() => null);
  const ticketStatus = ticketSettings?.enabled !== false
    ? `Connected (Staff: ${staffRoleIds.length}, Owners: ${ownerRoleIds.length}, Members: ${memberRoleIds.length})`
    : 'Not configured / skipped';

  const summaryLines = [
    `• **Staff Roles (${staffRoleIds.length}):** ${staffMentions}`,
    `• **Member Roles (${memberRoleIds.length}):** ${memberMentions}`,
    `• **Owner Roles (${ownerRoleIds.length}):** ${ownerMentions}`,
    `• **Staff-Only Categories:** \`${staffCategoryIds.length}\``,
    `• **Staff-Only Channels:** \`${staffChannelIds.length}\``,
    `• **Channels To Reset & Rebuild:** \`${totalChannelsCount}\``,
    `• **Autorole Integration:** \`${connectAutorole ? 'ON (Sync to Member Roles)' : 'OFF'}\``,
    `• **Backfill Unroled Members:** \`${backfillMembers ? 'ON (Batch assignment)' : 'OFF'}\``,
    `• **Ticket Roles:** \`${ticketStatus}\``
  ].join('\n');

  // ANSI Permission Matrix
  const ansiMatrix = [
    `\u001b[1;36mPERMISSION MATRIX\u001b[0m`,
    `Group        Normal Channels          Staff-Only Channels      Log/Vault Channels`,
    `---------------------------------------------------------------------------------`,
    `@everyone    ${hideEveryone ? 'DENY View                ' : 'View: ALLOWED            '}DENY View                DENY View`,
    `Members      View+Send+Speak          View ONLY (No Speak)     DENY View`,
    `Staff        View+Send+ManageMsgs     View+Send (No Manage)    View ONLY`,
    `Owners       Full Administrative      Full Administrative      Full Administrative`,
    `Argoni Bot   Full Administrative      Full Administrative      Full Administrative`
  ].join('\n');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${summaryLines}\n\n${format.ansiBlock(ansiMatrix)}`)
  );

  // Toggle Controls Row: Restrict @everyone & Backfill Members
  const hideEveryoneBtn = greyButton({
    id: `permify:toggle_everyone:${guildId}:${userId}:${step}`,
    label: hideEveryone ? '[✓] Restrict @everyone on normal channels' : '[ ] Restrict @everyone on normal channels',
    emoji: '🔒'
  });

  const backfillBtn = greyButton({
    id: `permify:toggle_backfill:${guildId}:${userId}:${step}`,
    label: backfillMembers ? '[✓] Backfill unroled members' : '[ ] Backfill unroled members',
    emoji: '👥'
  });

  container.addActionRowComponents(new ActionRowBuilder().addComponents(hideEveryoneBtn, backfillBtn));

  // Footer: Back, Apply, Cancel
  const footerRow = buildFooterRow({ guildId, userId, step, hasBack: true, isConfirm: true });
  container.addActionRowComponents(footerRow);
}

export default {
  renderWizardStep,
  buildProgressBar
};

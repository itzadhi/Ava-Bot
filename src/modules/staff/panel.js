import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  MessageFlags
} from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { getGuildSuggestions, countGuildSuggestions } from '../../db/suggestions.js';
import { getGuildFeedback, countGuildFeedback } from '../../db/feedback.js';
import { getGuildTempChannels, deleteTempChannel } from '../../db/voice.js';
import { getPanelState, savePanelState } from '../../db/panels.js';
import { checkStaffPermission } from '../suggestions/index.js';
import { logger } from '../../utils/logger.js';

/**
 * Renders the Centralized Staff Panel Container (Components V2)
 */
export async function renderStaffPanel({
  guild,
  activeTab = 'sug',
  filterStatus = 'all',
  page = 1
}) {
  const guildSettings = await getGuildSettings(guild.id);
  const container = new ContainerBuilder();

  // 1. Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# 🛡️ Centralized Staff Operations Panel\n` +
      `Server: **${guild.name}** · Manage community modules, temporary voice channels, and configurations.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 2. Tab Navigation Row
  const tabRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:panel:tab:sug')
      .setLabel(activeTab === 'sug' ? '• Suggestions •' : 'Suggestions')
      .setEmoji('💡')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:tab:fbk')
      .setLabel(activeTab === 'fbk' ? '• Feedback •' : 'Feedback')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:tab:voice')
      .setLabel(activeTab === 'voice' ? '• Voice & TTS •' : 'Voice & TTS')
      .setEmoji('🎙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:tab:settings')
      .setLabel(activeTab === 'settings' ? '• Settings •' : 'Settings')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary)
  );
  container.addActionRowComponents(tabRow);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 3. Tab Specific Contents
  if (activeTab === 'sug') {
    await renderSuggestionsTab(container, guild, filterStatus, page);
  } else if (activeTab === 'fbk') {
    await renderFeedbackTab(container, guild, filterStatus, page);
  } else if (activeTab === 'voice') {
    await renderVoiceTab(container, guild, guildSettings);
  } else if (activeTab === 'settings') {
    await renderSettingsTab(container, guild, guildSettings);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Deploys or updates the persistent staff panel in a specified channel
 */
export async function postOrGetStaffPanel(guild, targetChannel) {
  const state = await getPanelState(guild.id);
  const payload = await renderStaffPanel({
    guild,
    activeTab: state?.active_tab || 'sug',
    filterStatus: state?.filter_status || 'all',
    page: state?.page || 1
  });

  if (state?.channel_id && state?.message_id) {
    const chan = guild.channels.cache.get(state.channel_id);
    if (chan) {
      const existingMsg = await chan.messages.fetch(state.message_id).catch(() => null);
      if (existingMsg) {
        await existingMsg.edit(payload);
        return existingMsg;
      }
    }
  }

  // If no existing panel or message was deleted, send new one
  const newMsg = await targetChannel.send(payload);
  await savePanelState(guild.id, {
    channelId: targetChannel.id,
    messageId: newMsg.id,
    activeTab: 'sug',
    filterStatus: 'all',
    page: 1
  });
  return newMsg;
}

/**
 * Tab 1: Suggestions Content
 */
async function renderSuggestionsTab(container, guild, filterStatus, page) {
  const pageSize = 5;
  const totalCount = await countGuildSuggestions(guild.id, { status: filterStatus });
  const pendingCount = await countGuildSuggestions(guild.id, { status: 'pending' });
  const approvedCount = await countGuildSuggestions(guild.id, { status: 'approved' });
  const deniedCount = await countGuildSuggestions(guild.id, { status: 'denied' });
  const implementedCount = await countGuildSuggestions(guild.id, { status: 'implemented' });

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * pageSize;

  const suggestions = await getGuildSuggestions(guild.id, {
    status: filterStatus,
    limit: pageSize,
    offset
  });

  // Counters summary
  let body =
    `### 💡 Community Suggestions\n` +
    `📊 **Counters:** Total: \`${totalCount}\` · Pending: \`${pendingCount}\` · Approved: \`${approvedCount}\` · Denied: \`${deniedCount}\` · Implemented: \`${implementedCount}\`\n\n`;

  if (suggestions.length === 0) {
    body += `*No suggestions found matching filter: \`${filterStatus}\`.*`;
  } else {
    for (const s of suggestions) {
      const shortText = s.text.length > 60 ? `${s.text.slice(0, 57)}...` : s.text;
      body += `• \`${s.id}\` **[${s.status.toUpperCase()}]** <@${s.author_id}>: "${shortText}" (👍 ${s.upvotes_count || 0} / 👎 ${s.downvotes_count || 0})\n`;
    }
  }

  body += `\n-# Page ${currentPage} of ${totalPages} · Filter: ${filterStatus.toUpperCase()}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  // Filter Select
  const filterSelect = new StringSelectMenuBuilder()
    .setCustomId('fb:panel:sug_filter:0')
    .setPlaceholder('Filter Suggestions by Status')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('All Suggestions').setValue('all').setDefault(filterStatus === 'all'),
      new StringSelectMenuOptionBuilder().setLabel('Pending Only').setValue('pending').setDefault(filterStatus === 'pending'),
      new StringSelectMenuOptionBuilder().setLabel('Approved Only').setValue('approved').setDefault(filterStatus === 'approved'),
      new StringSelectMenuOptionBuilder().setLabel('Denied Only').setValue('denied').setDefault(filterStatus === 'denied'),
      new StringSelectMenuOptionBuilder().setLabel('Implemented Only').setValue('implemented').setDefault(filterStatus === 'implemented')
    );

  // Pagination Row
  const pagRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:panel:sug_page:${currentPage - 1}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`fb:panel:sug_page:${currentPage + 1}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
    new ButtonBuilder()
      .setCustomId('fb:panel:refresh:sug')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(filterSelect));

  // Moderation Select Menu for Staff
  if (suggestions.length > 0) {
    const modSelect = new StringSelectMenuBuilder()
      .setCustomId('fb:panel:sug_mod_menu:0')
      .setPlaceholder('🛡️ Select a suggestion to moderate (Approve / Deny / Delete)...')
      .addOptions(
        suggestions.slice(0, 25).map(s =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`[${s.status.toUpperCase()}] #${s.id} by ${s.author_username}`.slice(0, 100))
            .setDescription(s.text.replace(/[\r\n]+/g, ' ').slice(0, 80))
            .setValue(s.id)
        )
      );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(modSelect));
  }

  container.addActionRowComponents(pagRow);
}

/**
 * Tab 2: Feedback Content
 */
async function renderFeedbackTab(container, guild, filterStatus, page) {
  const pageSize = 5;
  const totalCount = await countGuildFeedback(guild.id, { status: filterStatus });
  const unreadCount = await countGuildFeedback(guild.id, { status: 'unread' });
  const readCount = await countGuildFeedback(guild.id, { status: 'read' });
  const resolvedCount = await countGuildFeedback(guild.id, { status: 'resolved' });

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const offset = (currentPage - 1) * pageSize;

  const feedbackList = await getGuildFeedback(guild.id, {
    status: filterStatus,
    limit: pageSize,
    offset
  });

  let body =
    `### 💬 User Feedback & Reviews\n` +
    `📊 **Counters:** Total: \`${totalCount}\` · Unread: \`${unreadCount}\` · Read: \`${readCount}\` · Resolved: \`${resolvedCount}\`\n\n`;

  if (feedbackList.length === 0) {
    body += `*No feedback found matching filter: \`${filterStatus}\`.*`;
  } else {
    for (const f of feedbackList) {
      const shortMsg = f.message.length > 45 ? `${f.message.slice(0, 42)}...` : f.message;
      const ratingStr = f.rating ? `⭐ ${f.rating}/5` : 'No rating';
      const hasSug = f.context?.suggestion ? ' · 💡 Idea' : '';
      const hasReply = f.reply ? ' · ✉️ Replied' : '';
      body += `• \`${f.id}\` **[${f.status.toUpperCase()}]** (${f.category} · ${ratingStr}${hasSug}${hasReply}) <@${f.author_id}>: "${shortMsg}"\n`;
    }
  }

  body += `\n-# Page ${currentPage} of ${totalPages} · Filter: ${filterStatus.toUpperCase()}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

  // Filter Select
  const filterSelect = new StringSelectMenuBuilder()
    .setCustomId('fb:panel:fbk_filter:0')
    .setPlaceholder('Filter Feedback by Status')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('All Feedback').setValue('all').setDefault(filterStatus === 'all'),
      new StringSelectMenuOptionBuilder().setLabel('Unread Only').setValue('unread').setDefault(filterStatus === 'unread'),
      new StringSelectMenuOptionBuilder().setLabel('Read Only').setValue('read').setDefault(filterStatus === 'read'),
      new StringSelectMenuOptionBuilder().setLabel('Resolved Only').setValue('resolved').setDefault(filterStatus === 'resolved')
    );

  // Pagination Row
  const pagRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:panel:fbk_page:${currentPage - 1}`)
      .setLabel('Previous')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage <= 1),
    new ButtonBuilder()
      .setCustomId(`fb:panel:fbk_page:${currentPage + 1}`)
      .setLabel('Next')
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage >= totalPages),
    new ButtonBuilder()
      .setCustomId('fb:panel:refresh:fbk')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(filterSelect));
  container.addActionRowComponents(pagRow);
}

/**
 * Tab 3: Voice & TTS Content
 */
async function renderVoiceTab(container, guild, guildSettings) {
  const triggerChannel = guildSettings?.jtc_trigger_channel_id
    ? `<#${guildSettings.jtc_trigger_channel_id}>`
    : '*Not configured*';

  const category = guildSettings?.jtc_category_id
    ? `<#${guildSettings.jtc_category_id}>`
    : '*None (root)*';

  const template = guildSettings?.jtc_name_template || "{username}'s room";
  const defaultLimit = guildSettings?.jtc_default_limit || 0;
  const ttsAnnounce = guildSettings?.tts_announce ? '🟢 Enabled' : '🔴 Disabled';
  const ttsSystem = guildSettings?.tts_enabled !== false ? '🟢 Active' : '🔴 Disabled';

  // Active channels
  const activeTempChannels = await getGuildTempChannels(guild.id);
  const activeRoomsCount = activeTempChannels.length;

  const content =
    `### 🎙️ Join-to-Create & TTS Settings\n` +
    `• **JTC Trigger Channel:** ${triggerChannel}\n` +
    `• **Target Category:** ${category}\n` +
    `• **Room Name Template:** \`${template}\`\n` +
    `• **Default User Limit:** \`${defaultLimit === 0 ? 'Unlimited (0)' : defaultLimit}\`\n` +
    `• **TTS Voice System:** ${ttsSystem}\n` +
    `• **TTS Status Announcements:** ${ttsAnnounce} *(Speaks when suggestions are Approved/Implemented)*\n` +
    `• **Active Temporary Rooms:** \`${activeRoomsCount}\` active\n\n` +
    `Use the menus and buttons below to update voice configurations or force-delete active rooms.`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Trigger Channel Select
  const triggerSelect = new ChannelSelectMenuBuilder()
    .setCustomId('fb:panel:jtc_trig_sel:0')
    .setPlaceholder('Set JTC Trigger Voice Channel')
    .setChannelTypes(ChannelType.GuildVoice);

  // Category Select
  const categorySelect = new ChannelSelectMenuBuilder()
    .setCustomId('fb:panel:jtc_cat_sel:0')
    .setPlaceholder('Set JTC Target Category')
    .setChannelTypes(ChannelType.GuildCategory);

  container.addActionRowComponents(new ActionRowBuilder().addComponents(triggerSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(categorySelect));

  // Force-Delete Active Room Select Menu (if any active rooms)
  if (activeTempChannels.length > 0) {
    const forceDelSelect = new StringSelectMenuBuilder()
      .setCustomId('fb:panel:jtc_force_del:0')
      .setPlaceholder('Force Delete Active Temp Channel')
      .addOptions(
        activeTempChannels.slice(0, 25).map(tc => ({
          label: `${tc.name.slice(0, 50)} (${tc.channel_id})`,
          description: `Owner: ${tc.owner_id}`,
          value: tc.channel_id
        }))
      );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(forceDelSelect));
  }

  // Action Buttons
  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:panel:jtc_send_panel:0')
      .setLabel('Deploy Panel')
      .setEmoji('🎛️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:tts_ann_toggle:0')
      .setLabel(guildSettings?.tts_announce ? 'Turn Off TTS' : 'Turn On TTS')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:jtc_tmpl_btn:0')
      .setLabel('Name Template')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:jtc_limit_btn:0')
      .setLabel('Default Limit')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:refresh:voice')
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(btnRow);
}

/**
 * Tab 4: Settings Content (Centralized Management)
 */
async function renderSettingsTab(container, guild, guildSettings) {
  const sugChannel = guildSettings?.suggestion_channel_id
    ? `<#${guildSettings.suggestion_channel_id}>`
    : '*Not configured*';

  const fbkChannel = guildSettings?.feedback_channel_id
    ? `<#${guildSettings.feedback_channel_id}>`
    : '*Not configured*';

  const staffRole = guildSettings?.staff_role_id
    ? `<@&${guildSettings.staff_role_id}>`
    : '*Manage Server permission only*';

  const cdSec = guildSettings?.suggestion_cooldown ?? 60;
  const sugEnabled = guildSettings?.suggestions_enabled !== false ? '🟢 Enabled' : '🔴 Disabled';
  const fbkEnabled = guildSettings?.feedback_enabled !== false ? '🟢 Enabled' : '🔴 Disabled';
  const jtcEnabled = guildSettings?.jtc_enabled !== false ? '🟢 Enabled' : '🔴 Disabled';
  const threadEnabled = guildSettings?.suggestion_thread_enabled !== false ? '🟢 Enabled' : '🔴 Disabled';
  const slowmodeVal = guildSettings?.suggestion_thread_slowmode || 0;
  const cdDisplay = cdSec === 0 ? 'Disabled (0s)' : `${cdSec}s`;

  const botNick = guild.members?.me?.nickname || guildSettings?.bot_nickname || guild.client?.user?.username || 'Argoni';
  const botBio = guildSettings?.bot_bio ? `\`${guildSettings.bot_bio}\`` : '_Default_';

  const content =
    `### ⚙️ Server & Feature Configuration\n` +
    `• **Bot Server Identity:** \`${botNick}\` (Bio: ${botBio})\n` +
    `• **Suggestions Channel:** ${sugChannel} (${sugEnabled})\n` +
    `• **Feedback Channel:** ${fbkChannel} (${fbkEnabled})\n` +
    `• **Staff Moderation Role:** ${staffRole}\n` +
    `• **Suggestion Cooldown:** \`${cdDisplay}\`\n` +
    `• **Auto Discussion Threads:** ${threadEnabled}\n` +
    `• **Join-to-Create System:** ${jtcEnabled}\n\n` +
    `Use the menus and toggle buttons below to configure channels, staff permissions, and community features:`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // 1. Suggestion Channel Select
  const sugChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('fb:panel:sug_chan_sel:0')
    .setPlaceholder('📢 Set Suggestions Channel')
    .setChannelTypes(ChannelType.GuildText);

  // 2. Feedback Channel Select
  const fbkChanSelect = new ChannelSelectMenuBuilder()
    .setCustomId('fb:panel:fbk_chan_sel:0')
    .setPlaceholder('💬 Set Feedback Channel')
    .setChannelTypes(ChannelType.GuildText);

  // 3. Staff Role Select
  const roleSelect = new RoleSelectMenuBuilder()
    .setCustomId('fb:panel:staff_role_sel:0')
    .setPlaceholder('🛡️ Set Staff Moderation Role');

  // 4. Action Buttons Row (Row 2, select menus are Rows 3, 4, 5)
  const toggleRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:panel:toggle_thread:0')
      .setLabel(guildSettings?.suggestion_thread_enabled !== false ? 'Threads: On' : 'Threads: Off')
      .setEmoji('🧵')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:cd_btn:0')
      .setLabel('Cooldown')
      .setEmoji('⏱️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:bot_profile:0')
      .setLabel('Bot Profile')
      .setEmoji('🎭')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:toggle_sug:0')
      .setLabel(guildSettings?.suggestions_enabled !== false ? '/suggest: ON' : '/suggest: OFF')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:panel:toggle_fbk:0')
      .setLabel(guildSettings?.feedback_enabled !== false ? '/feedback: ON' : '/feedback: OFF')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(toggleRow);
  container.addActionRowComponents(new ActionRowBuilder().addComponents(sugChanSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(fbkChanSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(roleSelect));
}

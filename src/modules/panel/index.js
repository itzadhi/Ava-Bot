import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import { theme } from '../../config/theme.js';
import * as format from '../../utils/ui/format.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getBrandLogo } from '../../ui/theme.js';
import { errorCard } from '../../utils/ui/builders.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';

// Import module panels for direct rendering
import { buildAutoModWizard } from '../automod/panel.js';
import { buildAntiNukeWizard } from '../antinuke/panel.js';
import { getAutoModSettings, getAutoModWords, getAutoModAllowlist, getAutoModRegexRules, getAutoModExemptions } from '../../db/automod.js';
import { getAntiNukeSettings, getAntiNukeTrusted, getAntiNukeExempt } from '../../db/antinuke.js';
import { getTicketSettings } from '../../db/tickets.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { buildAutoRolePanel } from '../autorole/panel.js';
import { buildBoostPanel } from '../boosts/panel.js';
import { buildStickyPanel } from '../sticky/panel.js';
import { buildStickyRolesPanel } from '../stickyroles/panel.js';
import { renderStaffPanel } from '../staff/panel.js';
import { renderChatlogPanel } from '../chatlog/panel.js';
import { buildBotProfilePanel } from '../settings/botprofile.js';
import { buildTTSPanel } from '../voice/tts/panel.js';
import { buildLogsPanel } from '../logs/engine.js';
import { renderTicketSettingsDashboard } from '../tickets/settings.js';
import { renderShopDashboard } from '../shop/wizard/dashboard.js';

export const MODULE_ITEMS = [
  { id: 'antinuke', name: 'Anti-Nuke Defense', emoji: '🛡️', desc: 'Channel restore, raid locks & shields' },
  { id: 'automod', name: 'AutoMod Protection', emoji: '⚔️', desc: 'Spam, invite, link, word & regex filters' },
  { id: 'autorole', name: 'Auto-Role', emoji: '👤', desc: 'Welcome roles for humans & bots' },
  { id: 'logs', name: 'Server Logs', emoji: '📢', desc: 'Components V2 audit trail & channels' },
  { id: 'boosts', name: 'Boost Tracker', emoji: '🚀', desc: 'Celebrations & booster auto-roles' },
  { id: 'sticky', name: 'Sticky Notes', emoji: '📌', desc: 'Pinned bottom-of-channel messages' },
  { id: 'stickyroles', name: 'Sticky Roles', emoji: '🧲', desc: 'Re-assign member roles upon rejoin' },
  { id: 'voice', name: 'Voice & Speech', emoji: '🔊', desc: 'Join-to-Create channels & TTS' },
  { id: 'staff', name: 'Suggestions & Feedback', emoji: '💡', desc: 'Staff queues, upvotes & reviews' },
  { id: 'chatlog', name: 'Chatlog Vault', emoji: '💬', desc: 'Encrypted message disaster archive' },
  { id: 'tickets', name: 'Ticket System', emoji: '🎫', desc: 'Panels, categories, controls & logs' },
  { id: 'shop', name: 'Shop System', emoji: '🛒', desc: 'Products, automated channels, orders & tickets' },
  { id: 'permify', name: 'Permify Wizard', emoji: '🔒', desc: 'Server permission wizard & role architect' },
  { id: 'botprofile', name: 'Bot Profile', emoji: '🎨', desc: 'Per-server nickname, avatar & bio' },
  { id: 'settings', name: 'General Settings', emoji: '⚙️', desc: 'Prefix, locale & core toggles' }
];

/**
 * Builds the Main Panel Dashboard Components V2 payload
 * @param {object} options
 * @param {import('discord.js').Guild} options.guild
 * @param {import('discord.js').User} options.user
 * @param {string} options.sessionId
 */
export async function buildDashboardPayload({ guild, user, client, sessionId }) {
  const container = new ContainerBuilder();

  const settings = (await getGuildSettings(guild.id)) || {};
  const logo = getBrandLogo(client);

  // 1. Heading
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${theme.emojis.gear} AVA Control Dashboard`)
  );

  // 2. Info lines
  const lines = [
    `Welcome to the central control panel for **${format.escapeMarkdown(guild.name)}**.`,
    'Select a module below to view live settings, adjust toggles, or configure channels and roles.',
    '',
    `${theme.emojis.dot} **Server ID:** ${format.code(guild.id)}`,
    `${theme.emojis.dot} **Prefix:** ${format.code(settings.prefix || 'a!')}`,
    `${theme.emojis.dot} **Owner:** <@${guild.ownerId}>`,
    `${theme.emojis.dot} **Members:** \`${guild.memberCount}\``
  ].join('\n');

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(logo));
  container.addSectionComponents(headerSection);

  // 3. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 4. Module Select Menu
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`dash:sel:${sessionId}`)
    .setPlaceholder('🎛️ Choose a Module to Configure...')
    .addOptions(
      MODULE_ITEMS.map(mod => ({
        label: mod.name,
        value: mod.id,
        description: mod.desc,
        emoji: mod.emoji
      }))
    );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

  // 5. Quick Shortcut Buttons
  const quickRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`dash:open:automod:${sessionId}`)
      .setLabel('AutoMod')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🛡️'),
    new ButtonBuilder()
      .setCustomId(`dash:open:logs:${sessionId}`)
      .setLabel('Logs')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📢'),
    new ButtonBuilder()
      .setCustomId(`dash:open:autorole:${sessionId}`)
      .setLabel('Auto-Role')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('👤'),
    new ButtonBuilder()
      .setCustomId(`dash:open:staff:${sessionId}`)
      .setLabel('Staff Hub')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('💡'),
    greyButton({
      id: `dash:close:${sessionId}`,
      label: 'Close',
      emoji: '❌'
    })
  );

  container.addActionRowComponents(quickRow);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Resolves a module ID to its rendered Components V2 panel payload
 * @param {string} moduleId
 * @param {import('discord.js').Guild} guild
 */
export async function renderModulePanelById(moduleId, guild) {
  const settings = (await getGuildSettings(guild.id)) || {};

  switch (moduleId) {
    case 'antinuke': {
      const anSettings = await getAntiNukeSettings(guild.id);
      const anTrusted = await getAntiNukeTrusted(guild.id);
      const anExempt = await getAntiNukeExempt(guild.id);
      const tktSettings = await getTicketSettings(guild.id).catch(() => null);
      return buildAntiNukeWizard({
        guild,
        userId: guild.ownerId,
        page: 1,
        settings: anSettings,
        trusted: anTrusted,
        exempt: anExempt,
        ticketCategoryId: tktSettings?.channel_category_id || null
      });
    }
    case 'automod': {
      const amSettings = await getAutoModSettings(guild.id);
      const words = await getAutoModWords(guild.id);
      const allowlist = await getAutoModAllowlist(guild.id);
      const regexRules = await getAutoModRegexRules(guild.id);
      const exemptions = await getAutoModExemptions(guild.id);
      return buildAutoModWizard({
        guildId: guild.id,
        userId: guild.ownerId,
        page: 1,
        settings: amSettings,
        words,
        allowlist,
        regexRules,
        exemptions
      });
    }
    case 'autorole':
      return buildAutoRolePanel(settings, guild);
    case 'boosts':
      return buildBoostPanel(settings, guild);
    case 'sticky':
      return buildStickyPanel(guild.id, guild);
    case 'stickyroles':
      return buildStickyRolesPanel(settings, guild);
    case 'staff':
      return renderStaffPanel({ guild, activeTab: 'sug' });
    case 'chatlog':
      return renderChatlogPanel({ guild });
    case 'botprofile':
      return buildBotProfilePanel(settings, guild);
    case 'voice':
      return buildTTSPanel(guild, null);
    case 'logs':
      return buildLogsPanel(guild);
    case 'tickets':
      return renderTicketSettingsDashboard({ guild, activeTab: 'general' });
    case 'shop':
      return renderShopDashboard({ guild, activeTab: 'overview' });
    case 'permify':
      return renderPermifyShortcutPanel(guild);
    case 'settings':
    default:
      return renderStaffPanel({ guild, activeTab: 'settings' });
  }
}

/**
 * Permify Wizard Shortcut Panel in Control Dashboard
 */
function renderPermifyShortcutPanel(guild) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 🔒 Permify Permission Wizard\n-# Automatic server permission architect and role onboarding system`)
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  const lines = [
    'Rebuild all server permissions cleanly with a single interactive Components V2 panel.',
    '',
    `${theme.emojis.dot} **Roles:** 3-tier hierarchy (Staff, Member, Owner)`,
    `${theme.emojis.dot} **Channels:** Staff-only-speak categories and custom channel overrides`,
    `${theme.emojis.dot} **Integrations:** Automatic sync to Autorole and Support Ticket systems`,
    `${theme.emojis.dot} **Rollback:** Automated pre-run snapshots with 1-click Undo`,
    '',
    `*Run \`/permify\` or \`&permify\` in any channel to launch the interactive setup wizard.*`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dash:return')
      .setLabel('Dashboard')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('◀️')
  );

  container.addActionRowComponents(btnRow);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Interim quick logs panel renderer until Phase 5 full logs suite is compiled
 */
function renderLogsShortcutPanel(guildSettings, guild) {
  const container = new ContainerBuilder();

  const logChannelId = guildSettings.log_channel_id || guildSettings.automod_log_channel_id;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## 📢 Server Logs Configuration`)
  );

  const lines = [
    'Configure the central logging channel for server events and moderation actions.',
    '',
    `${theme.emojis.dot} **Status:** ${logChannelId ? '🟢 Active' : '⚪ Unconfigured'}`,
    `${theme.emojis.dot} **Log Channel:** ${logChannelId ? `<#${logChannelId}>` : '_None (Set below)_'}`
  ].join('\n');

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines));

  const chanRow = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('fb:logs:set_chan')
      .setPlaceholder('📢 Select Log Channel...')
  );

  const btnRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: 'fb:logs:test',
      label: 'Send Test Log',
      emoji: '🔔'
    }),
    greyButton({
      id: 'dash:return',
      label: 'Dashboard',
      emoji: '◀️'
    })
  );

  container.addActionRowComponents(chanRow, btnRow);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Starts the Interactive Panel Dashboard Session
 * @param {import('../../structures/CommandContext.js').CommandContext} ctx
 */
export async function startDashboardSession(ctx) {
  if (!ctx.guild) {
    return ctx.replyError('The Control Dashboard can only be opened inside a Discord server.', 'Run this in a server.');
  }

  // Permission check: Manage Server or Server Owner or Bot Owner
  const isServerOwner = ctx.guild.ownerId === ctx.user.id;
  const isBotOwner = (process.env.OWNER_IDS || '').includes(ctx.user.id);
  const hasManageGuild = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild);

  if (!isServerOwner && !isBotOwner && !hasManageGuild) {
    return ctx.replyError(
      'Missing Manage Server Permission',
      'You need the `Manage Server` permission to access the AVA Control Dashboard.'
    );
  }

  const sessionId = `${ctx.guild.id}_${ctx.user.id}_${Date.now()}`;
  const initialPayload = await buildDashboardPayload({
    guild: ctx.guild,
    user: ctx.user,
    client: ctx.client,
    sessionId
  });

  await ctx.reply(initialPayload);
}

/**
 * Persistent handler for dash:* interactions.
 * Completely collector-free, works across bot restarts and after token expirations.
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleDashboardInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId?.startsWith('dash:')) return false;

  try {
    if (customId === 'dash:close' || customId.startsWith('dash:close:')) {
      await safeRespond(interaction, { components: [] });
      return true;
    }

    if (customId === 'dash:return' || customId.startsWith('dash:return:')) {
      const sessionId = `${interaction.guildId}_${interaction.user.id}_${Date.now()}`;
      const dash = await buildDashboardPayload({
        guild: interaction.guild,
        user: interaction.user,
        client: interaction.client,
        sessionId
      });
      await safeRespond(interaction, dash);
      return true;
    }

    let targetModule = null;
    if (customId.startsWith('dash:sel:')) {
      targetModule = interaction.values?.[0];
    } else if (customId.startsWith('dash:open:')) {
      const parts = customId.split(':');
      targetModule = parts[2];
    }

    if (targetModule && interaction.guild) {
      const panelPayload = await renderModulePanelById(targetModule, interaction.guild);
      await safeRespond(interaction, panelPayload);
      return true;
    }
  } catch (err) {
    // Handled safely by runHandler
  }
  return true;
}

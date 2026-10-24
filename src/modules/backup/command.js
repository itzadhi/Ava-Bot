import {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  AttachmentBuilder
} from 'discord.js';
import {
  backupCard,
  restoreConsoleCard,
  successCard,
  errorCard,
  warnCard,
  infoCard,
  confirmCard,
  detailCard,
  card
} from '../../ui/cards.js';
import { paginateItems, createPaginationRow } from '../../ui/pagination.js';
import {
  getBackupById,
  getGuildBackups,
  getUserBackups,
  setBackupLock,
  renameBackup,
  deleteBackupRecord,
  purgeUnlockedBackups,
  getBackupInterval,
  setBackupInterval
} from '../../db/backups.js';
import { downloadSnapshot, deleteSnapshot } from '../../db/storage.js';
import { createServerBackup } from './creator.js';
import { restoreServerBackup, validateRestorePermissions } from './restorer.js';
import { formatBytes, discordTimestamp } from '../../utils/time.js';
import { logger } from '../../utils/logger.js';
import { logAudit } from '../../db/audit.js';

export const userRestoreConfigs = new Map();

export function getUserConfig(userId, backupId) {
  const key = `${userId}:${backupId}`;
  if (!userRestoreConfigs.has(key)) {
    userRestoreConfigs.set(key, new Set(['clean', 'roles', 'channels', 'perms', 'emojis', 'settings', 'messages']));
  }
  return userRestoreConfigs.get(key);
}

/**
 * Formats roles and channels from a snapshot into a complete readable structure tree
 * @param {object} snapshot
 * @returns {{ rolesCount: number, channelsCount: number, emojisCount: number, messagesCount: number, roleTree: string, channelTree: string }}
 */
export function formatProjectStructure(snapshot) {
  const roles = snapshot?.roles || [];
  const channels = snapshot?.channels || [];
  const emojis = snapshot?.emojis || [];
  const messages = snapshot?.messages || {};

  // 1. Roles Tree (sorted from highest position to lowest)
  const sortedRoles = [...roles].sort((a, b) => b.position - a.position);
  const displayRoles = sortedRoles.slice(0, 10);
  const roleLines = displayRoles.map((r, i) => `${i + 1}. **${r.name}**`);
  if (sortedRoles.length > 10) {
    roleLines.push(`*... +${sortedRoles.length - 10} more roles*`);
  }

  // 2. Categories & Channels Tree (complete hierarchy)
  const categories = channels.filter(c => c.type === ChannelType.GuildCategory)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  const childChannels = channels.filter(c => c.type !== ChannelType.GuildCategory)
    .sort((a, b) => (a.position || 0) - (b.position || 0));

  const treeLines = [];
  
  // Channels without category
  const rootChannels = childChannels.filter(c => !c.parentId);
  for (const ch of rootChannels.slice(0, 4)) {
    const icon = ch.type === ChannelType.GuildVoice ? '🔊' : (ch.type === ChannelType.GuildAnnouncement ? '📢' : '💬');
    treeLines.push(`${icon} \`${ch.name}\``);
  }

  // Categories with their child channels
  let channelCountShown = rootChannels.length;
  for (const cat of categories) {
    const children = childChannels.filter(c => c.parentId === cat.id);
    treeLines.push(`**📁 ${cat.name.toUpperCase()}** (\`${children.length}\`)`);
    for (let j = 0; j < Math.min(children.length, 3); j++) {
      const ch = children[j];
      const isLast = j === Math.min(children.length, 3) - 1 && children.length <= 3;
      const branch = isLast ? '└─' : '├─';
      const icon = ch.type === ChannelType.GuildVoice ? '🔊' : (ch.type === ChannelType.GuildAnnouncement ? '📢' : '💬');
      treeLines.push(`  ${branch} ${icon} \`${ch.name}\``);
    }
    if (children.length > 3) {
      treeLines.push(`  └─ *+${children.length - 3} more*`);
    }
    channelCountShown += children.length;
    if (treeLines.length >= 14) break;
  }

  const messagesCount = Object.values(messages).reduce((acc, m) => acc + (Array.isArray(m) ? m.length : 0), 0);

  return {
    rolesCount: roles.length,
    channelsCount: channels.length,
    emojisCount: emojis.length,
    messagesCount,
    roleTree: roleLines.length > 0 ? roleLines.join('\n') : '_No custom roles_',
    channelTree: treeLines.length > 0 ? treeLines.join('\n') : '_No channels_'
  };
}

/**
 * Renders detailed project structure for a chosen snapshot with interactive restore options
 * @param {object} params
 * @param {string} params.backupId
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').User} params.user
 * @returns {Promise<object>}
 */
export async function renderBackupStructure({ backupId, guild, user }) {
  const record = await getBackupById(backupId);
  if (!record) {
    return errorCard({
      title: 'Snapshot Not Found',
      reason: `Backup \`${backupId}\` could not be located in database.`,
      fix: 'Run /backup to view available snapshots in the Central Panel.'
    });
  }

  let snapshot = null;
  try {
    snapshot = await downloadSnapshot(record.storage_path, false);
  } catch (err) {
    logger.warn(`Could not download full snapshot for structure preview: ${err.message}`);
  }

  const isCrossServer = record.guild_id !== guild.id;
  const originGuild = guild.client?.guilds?.cache?.get(record.guild_id);
  const originName = originGuild ? originGuild.name : `Origin Guild ${record.guild_id}`;

  const { rolesCount, channelsCount, emojisCount, messagesCount, roleTree, channelTree } = snapshot
    ? formatProjectStructure(snapshot)
    : {
        rolesCount: record.options?.roles ? 'Saved' : 'None',
        channelsCount: record.options?.channels ? 'Saved' : 'None',
        emojisCount: record.options?.emojis ? 'Saved' : 'None',
        messagesCount: 0,
        roleTree: '_Snapshot details available upon restore_',
        channelTree: '_Channel hierarchy available upon restore_'
      };

  const activeConfig = getUserConfig(user.id, record.id);

  const block1 = [
    `**Snapshot**: **${record.name}** (\`${record.id}\`)`,
    `📦 \`${formatBytes(record.size_bytes)}\` • ${record.locked ? '🔒 `[Locked]`' : '🔓 `[Unlocked]`'}`,
    `🌐 Origin: \`${originName}\` ➔ 🎯 Target: **${guild.name}**`,
    '',
    `### 🛡️ Roles (${rolesCount})`,
    roleTree
  ].join('\n');

  const block2 = [
    `### 📁 Channels (${channelsCount})`,
    channelTree,
    '',
    `### 📦 Assets & Chat`,
    `• 😀 Emojis: \`${emojisCount}\` • 💬 Messages: \`${messagesCount}\``
  ].join('\n');

  const moduleStatus = [
    activeConfig.has('clean') ? '🧹 `Wipe`' : '~~🧹 Wipe~~',
    activeConfig.has('roles') ? '🛡️ `Roles`' : '~~🛡️ Roles~~',
    activeConfig.has('channels') ? '📁 `Channels`' : '~~📁 Channels~~',
    activeConfig.has('perms') ? '🔒 `Perms`' : '~~🔒 Perms~~',
    activeConfig.has('emojis') ? '😀 `Emojis`' : '~~😀 Emojis~~',
    activeConfig.has('settings') ? '🖼️ `Logo`' : '~~🖼️ Logo~~',
    activeConfig.has('messages') ? '💬 `Messages`' : '~~💬 Messages~~'
  ].join(' • ');

  const block3 = [
    '### ⚙️ Restore Modules Active',
    moduleStatus,
    '-# Customize what to restore in the dropdown below, then tap Restore.'
  ].join('\n');

  // Build Select Menu options from unified backups (Snapshot Switcher)
  const [swGuildBackups, swUserBackups] = await Promise.all([
    getGuildBackups(guild.id, { limit: 100, order: 'desc' }).catch(() => []),
    getUserBackups(user.id, { limit: 100, order: 'desc' }).catch(() => [])
  ]);
  const swMap = new Map();
  for (const b of swUserBackups) swMap.set(b.id, b);
  for (const b of swGuildBackups) swMap.set(b.id, b);
  const unifiedSwitchBackups = Array.from(swMap.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const selectOptions = unifiedSwitchBackups.slice(0, 25).map(b => 
    new StringSelectMenuOptionBuilder()
      .setLabel(`${b.name.slice(0, 20)} (${b.id})`)
      .setValue(`inspect:${b.id}`)
      .setEmoji('📦')
      .setDescription(`${formatBytes(b.size_bytes)} • ${discordTimestamp(b.created_at, 'R')}`)
      .setDefault(b.id === record.id)
  );

  const rows = [];
  if (selectOptions.length > 0) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`bk_select_inspect:${guild.id}`)
        .setPlaceholder('🔍 Switch snapshot...')
        .addOptions(selectOptions.slice(0, 25))
    ));
  }

  // Restore Module Configuration Dropdown (Clean, Roles, Channels, Perms, Emojis, Settings, Messages)
  const moduleSelect = new StringSelectMenuBuilder()
    .setCustomId(`bk_select_modules:${record.id}`)
    .setPlaceholder('⚙️ Choose restore modules...')
    .setMinValues(1)
    .setMaxValues(7)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Wipe Server')
        .setValue('clean')
        .setDescription('Wipe server before restoring')
        .setEmoji('🧹')
        .setDefault(activeConfig.has('clean')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Roles & Hierarchy')
        .setValue('roles')
        .setDescription('Rebuild roles and order')
        .setEmoji('🛡️')
        .setDefault(activeConfig.has('roles')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Channels')
        .setValue('channels')
        .setDescription('Categories, text & voice')
        .setEmoji('📁')
        .setDefault(activeConfig.has('channels')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Permissions')
        .setValue('perms')
        .setDescription('Channel & role permissions')
        .setEmoji('🔒')
        .setDefault(activeConfig.has('perms')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Emojis')
        .setValue('emojis')
        .setDescription('Custom emojis and stickers')
        .setEmoji('😀')
        .setDefault(activeConfig.has('emojis')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Icon & Info')
        .setValue('settings')
        .setDescription('Server icon, name & info')
        .setEmoji('🖼️')
        .setDefault(activeConfig.has('settings')),
      new StringSelectMenuOptionBuilder()
        .setLabel('Messages')
        .setValue('messages')
        .setDescription('Replay channel chat history')
        .setEmoji('💬')
        .setDefault(activeConfig.has('messages'))
    );
  rows.push(new ActionRowBuilder().addComponents(moduleSelect));

  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bk_quick_deploy:${record.id}`)
      .setLabel('Restore')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🚀'),
    new ButtonBuilder()
      .setCustomId(`bk_toggle_lock:${record.id}`)
      .setLabel(record.locked ? 'Unlock' : 'Lock')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji(record.locked ? '🔓' : '🔒'),
    new ButtonBuilder()
      .setCustomId(`bk_delete_snapshot:${record.id}`)
      .setLabel('Delete')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId(`bk_return_to_list:${guild.id}`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⬅️')
  );
  rows.push(buttonsRow);

  return card({
    title: `Structure: "${record.name}"`,
    glyph: '📦',
    subtitle: `Snapshot from ${originName}`,
    textBlocks: [block1, block2, block3],
    subtext: `Configure modules above, then tap Restore • AVA`,
    rows,
    thumbnail: snapshot?.settings?.iconURL || 'attachment://logo.jpg'
  });
}

/**
 * Helper to render the interactive backup list card with dropdown menu & pagination
 */
export async function renderBackupList({ guild, user, page = 1 }) {
  const limit = 5;

  const [guildBackups, userBackups] = await Promise.all([
    getGuildBackups(guild.id, { limit: 100, order: 'desc' }).catch(() => []),
    getUserBackups(user.id, { limit: 100, order: 'desc' }).catch(() => [])
  ]);

  const map = new Map();
  for (const b of userBackups) map.set(b.id, b);
  for (const b of guildBackups) map.set(b.id, b);
  const allBackups = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const pagination = paginateItems(allBackups, { page, limit });
  const slice = pagination.slice;
  const safePage = pagination.page;
  const totalPages = pagination.totalPages;

  const items = slice.map((b, idx) => {
    const num = (safePage - 1) * limit + idx + 1;
    const lockBadge = b.locked ? '🔒' : '';
    const autoBadge = b.is_auto ? '🤖' : '';
    return `**${num}. ${b.name}** (\`${b.id}\`) ${lockBadge} ${autoBadge}\n• 📦 \`${formatBytes(b.size_bytes)}\` • ${discordTimestamp(b.created_at, 'R')}`;
  });

  const rows = [];

  // Dropdown Select Menu for choosing a backup to inspect structure
  if (allBackups.length > 0) {
    const selectOptions = allBackups.slice(0, 25).map(b => 
      new StringSelectMenuOptionBuilder()
        .setLabel(`${b.name.slice(0, 20)} (${b.id})`)
        .setValue(`inspect:${b.id}`)
        .setEmoji('📦')
        .setDescription(`${formatBytes(b.size_bytes)} • ${discordTimestamp(b.created_at, 'R')}`)
    );

    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`bk_select_inspect:${guild.id}`)
        .setPlaceholder('🔍 Select a backup to inspect...')
        .addOptions(selectOptions)
    ));
  }

  // Row 1: Actions (Create New Snapshot, Delete Snapshot, Refresh)
  const createButton = new ButtonBuilder()
    .setCustomId(`bk_quick_create:${guild.id}`)
    .setLabel('New Snapshot')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📸');

  const deleteButton = new ButtonBuilder()
    .setCustomId(`bk_front_delete:${guild.id}`)
    .setLabel('Delete')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🗑️')
    .setDisabled(allBackups.length === 0);

  const refreshButton = new ButtonBuilder()
    .setCustomId(`bk_refresh:${guild.id}`)
    .setLabel('Refresh')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('🔄');

  const logChannelButton = new ButtonBuilder()
    .setCustomId(`bk_btn_set_channel:${guild.id}`)
    .setLabel('Set Channel')
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('📢');

  rows.push(new ActionRowBuilder().addComponents([createButton, deleteButton, refreshButton, logChannelButton]));

  // Row 2: Universal pagination row (ONLY rendered when totalPages > 1)
  if (totalPages > 1) {
    const paginationRow = createPaginationRow({
      customIdPrefix: `bk_page_${guild.id}`,
      page: safePage,
      totalPages
    });
    rows.push(paginationRow);
  }

  const emptyBlock = [
    '> 📦 **No Server Snapshots Found**',
    '> There are currently no backups stored.',
    '',
    '💡 Tap **New Snapshot** below to capture a complete backup of roles, channels, and settings!'
  ].join('\n');

  const content = items.length > 0
    ? `> 📊 **${pagination.summaryText}**\n\n${items.join('\n\n')}\n\n💡 Tap a backup in the dropdown above to inspect structure & restore.`
    : emptyBlock;

  return card({
    title: `Backups: ${guild.name}`,
    glyph: '📦',
    subtitle: `${allBackups.length} snapshot(s) available`,
    body: content,
    subtext: totalPages > 1 ? pagination.pageLabel : null,
    rows
  });
}

/**
 * Centralized Backup Panel Controller
 * Renders either the paginated snapshot manager or the detailed structure & restore options view
 */
export async function renderCentralPanel({
  guild,
  user,
  view = 'list',
  backupId = null,
  page = 1
}) {
  if (view === 'inspect' && backupId) {
    return renderBackupStructure({ backupId, guild, user });
  }
  return renderBackupList({ guild, user, page });
}

export const backupCommand = {
  name: 'backup',
  aliases: ['bk'],
  description: 'Centralized server snapshot, restore, and automated rotation control panel',
  category: 'backup',
  permissions: [PermissionFlagsBits.ManageGuild],
  botPermissions: [
    PermissionFlagsBits.ManageGuild,
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels
  ],
  cooldown: 3,
  guildCooldown: true,
  args: [
    {
      name: 'channel',
      description: 'Set or update the backup & audit log channel',
      type: 'channel',
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.replyError('Backup commands must be executed within a Discord server.', 'Run this in a server.');
    }

    if (ctx.args.channel) {
      const targetChannel = ctx.args.channel;
      const { updateGuildSettings } = await import('../../db/guilds.js');
      await updateGuildSettings(ctx.guild.id, { log_channel_id: targetChannel.id });
      return ctx.reply(successCard({
        title: 'Backup Log Channel Configured',
        subtitle: `Server backup notifications and logs will be posted to <#${targetChannel.id}>.`,
        ephemeral: true
      }));
    }

    const payload = await renderCentralPanel({
      guild: ctx.guild,
      user: ctx.user,
      view: 'list',
      page: 1
    });
    return ctx.reply(payload);
  }
};

export default backupCommand;

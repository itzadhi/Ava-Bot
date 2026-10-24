import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { ComponentBuilder } from '../../ui/builder.js';

/**
 * Builds the full interactive Bot Profile control panel.
 * Clean, smooth typography with headings, subheadings, bullet points (-), bold formatting,
 * and minimal emoji.
 *
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').Client} params.client
 * @param {object} [params.currentSettings]
 * @param {string} [params.note]
 * @returns {{ flags: number, components: any[] }}
 */
export function buildBotProfilePanel({ guild, client, currentSettings = null, note = null }) {
  const me = guild.members?.me;
  const botNick = me?.nickname || currentSettings?.bot_nickname || client?.user?.username || 'AVA';
  const botBio = currentSettings?.bot_bio || '_None set_';
  const avatarUrl = currentSettings?.bot_avatar_url || (me?.avatarURL && me.avatarURL()) || client?.user?.displayAvatarURL?.() || null;
  const bannerUrl = currentSettings?.bot_banner_url || null;

  const builder = new ComponentBuilder();

  // Heading & Subheading
  builder.addText(`# Server Identity\n### Bot Profile Configuration`);
  builder.addSeparator();

  // Bullet attributes using - and bold formatting (clean, minimal emoji)
  const lines = [
    `- **Guild:** ${guild.name} (\`${guild.id}\`)`,
    `- **Nickname:** ${botNick}`,
    `- **About Me:** ${botBio}`,
    `- **Server Avatar:** ${avatarUrl ? `[View Image](${avatarUrl})` : 'Default'}`,
    `- **Server Banner:** ${bannerUrl ? `[View Banner](${bannerUrl})` : 'Default'}`
  ];

  if (note) {
    lines.push(`\n- **Status:** ${note}`);
  }

  builder.addText(lines.join('\n'));

  // Thumbnail accessory
  if (avatarUrl) {
    builder.setThumbnail(avatarUrl);
  }

  builder.addSeparator();

  // Controls subheading and instructions
  builder.addText(
    `### Controls\n` +
    `Select an option below to update profile attributes or restore server defaults.\n` +
    `-# Customizations apply exclusively to this server.`
  );

  // Row 1: Specific attribute edit buttons
  builder.addButton({ id: 'fb:bp:nick:0', label: 'Edit Nickname', style: ButtonStyle.Secondary });
  builder.addButton({ id: 'fb:bp:bio:0', label: 'Edit Bio', style: ButtonStyle.Secondary });
  builder.addButton({ id: 'fb:bp:avatar:0', label: 'Edit Avatar', style: ButtonStyle.Secondary });
  builder.addButton({ id: 'fb:bp:banner:0', label: 'Edit Banner', style: ButtonStyle.Secondary });

  // Row 2: Comprehensive edit, reset to defaults, and refresh
  builder.addButton({ id: 'fb:bp:edit_all:0', label: 'Edit All', style: ButtonStyle.Secondary });
  builder.addButton({ id: 'fb:bp:reset:0', label: 'Reset Defaults', style: ButtonStyle.Secondary });
  builder.addButton({ id: 'fb:bp:refresh:0', label: 'Refresh', style: ButtonStyle.Secondary });

  return builder.build();
}

/**
 * Builds modal for editing nickname only
 */
export function buildNicknameModal(currentNick = '') {
  const modal = new ModalBuilder()
    .setCustomId('fb:bp:nick_mod:0')
    .setTitle('Edit Server Nickname');

  const input = new TextInputBuilder()
    .setCustomId('bp_nick')
    .setLabel('Server Nickname / Name')
    .setStyle(TextInputStyle.Short)
    .setValue(currentNick || '')
    .setPlaceholder('Enter bot display name in this server...')
    .setRequired(false)
    .setMaxLength(32);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Builds modal for editing About Me bio only
 */
export function buildBioModal(currentBio = '') {
  const modal = new ModalBuilder()
    .setCustomId('fb:bp:bio_mod:0')
    .setTitle('Edit Server About Me');

  const input = new TextInputBuilder()
    .setCustomId('bp_bio')
    .setLabel('About Me / Bio')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentBio || '')
    .setPlaceholder('Enter description, server role, or assistant info...')
    .setRequired(false)
    .setMaxLength(190);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Builds modal for editing avatar URL only
 */
export function buildAvatarModal(currentAvatar = '') {
  const modal = new ModalBuilder()
    .setCustomId('fb:bp:avatar_mod:0')
    .setTitle('Edit Server Avatar');

  const input = new TextInputBuilder()
    .setCustomId('bp_avatar')
    .setLabel('Avatar Image URL (PNG/JPG/WebP)')
    .setStyle(TextInputStyle.Short)
    .setValue(currentAvatar || '')
    .setPlaceholder('https://example.com/avatar.png')
    .setRequired(false)
    .setMaxLength(256);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Builds modal for editing banner URL only
 */
export function buildBannerModal(currentBanner = '') {
  const modal = new ModalBuilder()
    .setCustomId('fb:bp:banner_mod:0')
    .setTitle('Edit Server Banner');

  const input = new TextInputBuilder()
    .setCustomId('bp_banner')
    .setLabel('Banner Image URL (PNG/JPG/WebP)')
    .setStyle(TextInputStyle.Short)
    .setValue(currentBanner || '')
    .setPlaceholder('https://example.com/banner.png')
    .setRequired(false)
    .setMaxLength(256);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

/**
 * Builds comprehensive modal for editing all profile fields at once
 */
export function buildAllProfileModal({ nick = '', bio = '', avatar = '', banner = '' }) {
  const modal = new ModalBuilder()
    .setCustomId('fb:bp:all_mod:0')
    .setTitle('Edit All Profile Attributes');

  const nickInput = new TextInputBuilder()
    .setCustomId('bp_nick')
    .setLabel('Server Nickname')
    .setStyle(TextInputStyle.Short)
    .setValue(nick || '')
    .setPlaceholder('e.g. AVA or Server Assistant')
    .setRequired(false)
    .setMaxLength(32);

  const bioInput = new TextInputBuilder()
    .setCustomId('bp_bio')
    .setLabel('About Me / Bio')
    .setStyle(TextInputStyle.Paragraph)
    .setValue(bio || '')
    .setPlaceholder('Enter bot description or server role...')
    .setRequired(false)
    .setMaxLength(190);

  const avatarInput = new TextInputBuilder()
    .setCustomId('bp_avatar')
    .setLabel('Avatar Image URL')
    .setStyle(TextInputStyle.Short)
    .setValue(avatar || '')
    .setPlaceholder('https://example.com/avatar.png')
    .setRequired(false)
    .setMaxLength(256);

  const bannerInput = new TextInputBuilder()
    .setCustomId('bp_banner')
    .setLabel('Banner Image URL')
    .setStyle(TextInputStyle.Short)
    .setValue(banner || '')
    .setPlaceholder('https://example.com/banner.png')
    .setRequired(false)
    .setMaxLength(256);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nickInput),
    new ActionRowBuilder().addComponents(bioInput),
    new ActionRowBuilder().addComponents(avatarInput),
    new ActionRowBuilder().addComponents(bannerInput)
  );

  return modal;
}

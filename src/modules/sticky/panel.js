import {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';

/**
 * Builds the interactive Sticky Notes configuration panel using Discord Components V2
 * @param {import('discord.js').Guild} guild
 * @param {object[]} [activeNotes]
 * @param {string} [selectedChannelId]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildStickyPanel(guild, activeNotes = [], selectedChannelId = null) {
  const container = new ContainerBuilder();

  let notesList = '- *No sticky notes currently configured in this server.*';
  if (Array.isArray(activeNotes) && activeNotes.length > 0) {
    notesList = activeNotes.map(n => {
      const stateBadge = n.is_enabled !== false ? '🟢 **Active**' : '⚪ **Paused**';
      const snippet = (n.content || '').replace(/\n/g, ' ').slice(0, 40);
      const isSelected = selectedChannelId === n.channel_id ? ' 👉 ' : '';
      return `${isSelected}- <#${n.channel_id}>: ${stateBadge} — "${snippet}${n.content?.length > 40 ? '...' : ''}"`;
    }).join('\n');
  }

  const currentFocus = selectedChannelId ? `<#${selectedChannelId}>` : '`None (Select below)`';

  // Professional typography: # Heading, ### Subheadings, - Bullets, **Bold** formatting
  const content =
    `# 📌 Sticky Notes Interactive Manager\n` +
    `Ensure critical announcements or rules stay pinned to the very bottom of active text channels.\n\n` +
    `### Current Sticky Channels\n` +
    `${notesList}\n\n` +
    `### Channel Focus\n` +
    `- **Selected Channel:** ${currentFocus}\n\n` +
    `*Select a channel below, then click **Edit Note** to write or update its pinned message.*`;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  // Row 1: Channel Selector
  const row1 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('fb:stk:chan_sel:0')
      .setPlaceholder('Select Target Channel for Sticky Note...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
  );

  // Row 2: Note Configuration Buttons
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:stk:edit_modal:${selectedChannelId || 'none'}`)
      .setLabel('Edit Note')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!selectedChannelId),
    new ButtonBuilder()
      .setCustomId(`fb:stk:toggle:${selectedChannelId || 'none'}`)
      .setLabel('Toggle Active')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!selectedChannelId),
    new ButtonBuilder()
      .setCustomId(`fb:stk:delete:${selectedChannelId || 'none'}`)
      .setLabel('Remove Note')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!selectedChannelId),
    new ButtonBuilder()
      .setCustomId('fb:stk:refresh:0')
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1, row2);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds the modal for composing or updating a sticky note
 * @param {string} channelId
 * @param {string} [currentContent]
 * @returns {ModalBuilder}
 */
export function buildStickyNoteModal(channelId, currentContent = '') {
  const modal = new ModalBuilder()
    .setCustomId(`fb:stk:submit:${channelId}`)
    .setTitle('Configure Sticky Note');

  const contentInput = new TextInputBuilder()
    .setCustomId('sticky_content')
    .setLabel('Sticky Note Message')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Please remember to follow server rules and keep discussion respectful!')
    .setValue(currentContent || '')
    .setRequired(true)
    .setMaxLength(1500);

  modal.addComponents(new ActionRowBuilder().addComponents(contentInput));
  return modal;
}

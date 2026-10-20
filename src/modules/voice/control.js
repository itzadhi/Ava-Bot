import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags
} from 'discord.js';
import { getTempChannel } from '../../db/voice.js';

/**
 * Builds the Components V2 Voice Manager card matching the reference screenshot
 * @param {object} [options]
 * @param {string} [options.targetId='common'] The channel ID or 'common' for lobby panel
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildVoiceManagerCard({ targetId = 'common' } = {}) {
  const container = new ContainerBuilder();

  // 1. Header Section: Title & Quote
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '# Voice Manager\n' +
      '> Join the creator channel to get your own private voice room.'
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 2. Member Controls Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      '### Member Controls\n' +
      'Manage who can stay in your channel.'
    )
  );

  // 3. Member Controls Action: Disconnect Users Button
  const memberRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:jtc:disconnect:${targetId}`)
      .setLabel('Disconnect Users')
      .setEmoji('↪️')
      .setStyle(ButtonStyle.Secondary)
  );
  container.addActionRowComponents(memberRow);

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 4. Customization Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      'Customize and personalize your voice channel experience'
    )
  );

  // 5. Actions Dropdown Select Menu (8 distinct options matching screenshots 2 & 3)
  const actionSelect = new StringSelectMenuBuilder()
    .setCustomId(`fb:jtc:action_sel:${targetId}`)
    .setPlaceholder('Select an action...')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Lock Your Channel')
        .setDescription('Prevent others from joining your channel')
        .setValue('lock')
        .setEmoji('🔒'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Unlock Your Channel')
        .setDescription('Allow others to join your channel')
        .setValue('unlock')
        .setEmoji('🔓'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Hide Your Channel')
        .setDescription('Make your channel invisible in the list')
        .setValue('hide')
        .setEmoji('🙈'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Reveal Your Channel')
        .setDescription('Make your channel visible to everyone')
        .setValue('reveal')
        .setEmoji('👁️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Delete Your Channel')
        .setDescription('Permanently delete your voice channel')
        .setValue('delete')
        .setEmoji('🗑️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Rename Your Channel')
        .setDescription('Give your channel a new name')
        .setValue('rename')
        .setEmoji('✏️'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Set Channel Bitrate')
        .setDescription('Adjust the audio quality of your channel')
        .setValue('bitrate')
        .setEmoji('🌐'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Set User Limit')
        .setDescription('Limit how many users can join your channel')
        .setValue('limit')
        .setEmoji('👥')
    );

  const actionRow = new ActionRowBuilder().addComponents(actionSelect);
  container.addActionRowComponents(actionRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds the Components V2 room control container for an active channel
 * @param {object} params
 * @param {import('discord.js').VoiceChannel} [params.channel]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildControlCard({ channel } = {}) {
  const targetId = channel?.id || 'common';
  return buildVoiceManagerCard({ targetId });
}

/**
 * Builds the persistent Common Voice Room Control Card for the server
 * Any VC creator connected to their room can use this panel to manage their specific channel.
 * @param {object} [options]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildCommonControlCard({ guild, client } = {}) {
  return buildVoiceManagerCard({ targetId: 'common' });
}

/**
 * Updates an active room control message in place
 * @param {import('discord.js').VoiceChannel} channel
 * @returns {Promise<import('discord.js').Message|null>}
 */
export async function refreshControlMessage(channel) {
  const record = await getTempChannel(channel.id);
  if (!record || !record.control_message_id) return null;

  try {
    const controlChannel = channel.guild.channels.cache.get(record.control_channel_id || channel.id) || channel;
    const msg = await controlChannel.messages.fetch(record.control_message_id).catch(() => null);
    if (!msg) return null;

    const payload = buildControlCard({ channel });

    await msg.edit(payload);
    return msg;
  } catch {
    return null;
  }
}



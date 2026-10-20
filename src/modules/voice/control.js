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
  MessageFlags
} from 'discord.js';
import { getTempChannel } from '../../db/voice.js';

/**
 * Builds the Components V2 room control container
 * @param {object} params
 * @param {import('discord.js').VoiceChannel} params.channel
 * @param {string} params.ownerId
 * @param {boolean} [params.isLocked=false]
 * @param {boolean} [params.isHidden=false]
 * @param {boolean} [params.ttsEnabled=true]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildControlCard({
  channel,
  ownerId,
  isLocked = false,
  isHidden = false,
  ttsEnabled = true
}) {
  const memberCount = channel?.members?.size ?? 0;
  const userLimit = channel?.userLimit ?? 0;
  const limitText = userLimit === 0 ? 'Unlimited (0)' : `${userLimit}`;
  const bitrateKbps = Math.round((channel?.bitrate ?? 64000) / 1000);
  const channelId = channel.id;

  const container = new ContainerBuilder();

  // 1. Header Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎙️ Room Controls — ${channel.name}\n` +
      `Manage your temporary voice room settings, participant access, and text-to-speech below.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 2. Info Status Block
  const lockStatus = isLocked ? '🔒 **Locked**' : '🔓 **Unlocked**';
  const hideStatus = isHidden ? '👁️ **Hidden**' : '👁️‍🗨️ **Visible**';
  const ttsStatus = ttsEnabled ? '🔊 **Enabled**' : '🔇 **Disabled**';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `👑 **Room Owner:** <@${ownerId}>\n` +
      `👥 **Members:** \`${memberCount}\` · 🛑 **Limit:** \`${limitText}\` · ⚡ **Bitrate:** \`${bitrateKbps} kbps\`\n` +
      `🛡️ **Status:** ${lockStatus} · ${hideStatus} · ${ttsStatus}`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 3. Row 1: Primary Owner Controls (Buttons)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:jtc:rename:${channelId}`)
      .setLabel('Rename')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:limit:${channelId}`)
      .setLabel('Limit')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:lock:${channelId}`)
      .setLabel(isLocked ? 'Unlock' : 'Lock')
      .setEmoji(isLocked ? '🔓' : '🔒')
      .setStyle(isLocked ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:hide:${channelId}`)
      .setLabel(isHidden ? 'Unhide' : 'Hide')
      .setEmoji(isHidden ? '👁️‍🗨️' : '👁️')
      .setStyle(isHidden ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:reset:${channelId}`)
      .setLabel('Reset')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger)
  );

  // 4. Row 2: Participant Management (Buttons opening user selects/modals)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:jtc:kick:${channelId}`)
      .setLabel('Kick')
      .setEmoji('👢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:permit:${channelId}`)
      .setLabel('Permit')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:reject:${channelId}`)
      .setLabel('Reject')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:transfer:${channelId}`)
      .setLabel('Transfer')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Secondary)
  );

  // 5. Row 3: Bitrate Dropdown Select Menu
  const bitrateSelect = new StringSelectMenuBuilder()
    .setCustomId(`fb:jtc:bitrate_sel:${channelId}`)
    .setPlaceholder(`Change Audio Bitrate (${bitrateKbps} kbps)`)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('64 kbps (Standard)')
        .setDescription('Standard audio quality suitable for speech')
        .setValue('64000')
        .setDefault(bitrateKbps === 64),
      new StringSelectMenuOptionBuilder()
        .setLabel('96 kbps (High Quality)')
        .setDescription('High definition voice clarity')
        .setValue('96000')
        .setDefault(bitrateKbps === 96),
      new StringSelectMenuOptionBuilder()
        .setLabel('128 kbps (Ultra Quality)')
        .setDescription('Ultra clear for music & crisp voice')
        .setValue('128000')
        .setDefault(bitrateKbps === 128),
      new StringSelectMenuOptionBuilder()
        .setLabel('32 kbps (Bandwidth Saver)')
        .setDescription('Low data usage mode')
        .setValue('32000')
        .setDefault(bitrateKbps === 32)
    );
  const row3 = new ActionRowBuilder().addComponents(bitrateSelect);

  // 6. Row 4: Everyone Actions (Claim, TTS toggle, User TTS prefs)
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`fb:jtc:claim:${channelId}`)
      .setLabel('Claim Room')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:tts_room:${channelId}`)
      .setLabel(ttsEnabled ? 'Mute Room TTS' : 'Unmute Room TTS')
      .setEmoji(ttsEnabled ? '🔇' : '🔊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`fb:jtc:tts_me:${channelId}`)
      .setLabel('My TTS')
      .setEmoji('🎧')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);
  container.addActionRowComponents(row3);
  container.addActionRowComponents(row4);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Updates an active room control message in place
 */
export async function refreshControlMessage(channel) {
  const record = await getTempChannel(channel.id);
  if (!record || !record.control_message_id) return null;

  try {
    const controlChannel = channel.guild.channels.cache.get(record.control_channel_id || channel.id) || channel;
    const msg = await controlChannel.messages.fetch(record.control_message_id).catch(() => null);
    if (!msg) return null;

    const payload = buildControlCard({
      channel,
      ownerId: record.owner_id,
      isLocked: record.is_locked,
      isHidden: record.is_hidden,
      ttsEnabled: record.tts_enabled
    });

    await msg.edit(payload);
    return msg;
  } catch {
    return null;
  }
}

/**
 * Builds the persistent Common Voice Room Control Card for the server
 * Any VC creator connected to their room can use this panel to manage their specific channel.
 */
export function buildCommonControlCard({ guild, client } = {}) {
  const container = new ContainerBuilder();

  // 1. Header Section
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎛️ Voice Channel Controls\n` +
      `Manage your temporary voice room settings, participant access, and audio quality.`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 2. Info Instructions
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### 📌 How to Manage Your Room\n` +
      `• **Connect First:** Join your temporary voice room before clicking the buttons.\n` +
      `• **Customization:** Rename, adjust user limits, lock/unlock, or select audio bitrate.\n` +
      `• **Access Control:** Permit or reject members, kick disruptive users, or transfer ownership.\n` +
      `• **Claiming:** If the room creator leaves the voice channel, anyone inside can tap **Claim Room**.\n\n` +
      `-# ⚡ *Controls automatically apply to whichever temporary voice room you are currently inside.*`
    )
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
  );

  // 3. Row 1: Primary Owner Controls (Buttons)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:jtc:rename:common')
      .setLabel('Rename')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:limit:common')
      .setLabel('Limit')
      .setEmoji('👥')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:lock:common')
      .setLabel('Lock / Unlock')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:hide:common')
      .setLabel('Hide / Unhide')
      .setEmoji('👁️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:reset:common')
      .setLabel('Reset')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Danger)
  );

  // 4. Row 2: Member Management
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:jtc:kick:common')
      .setLabel('Kick')
      .setEmoji('👢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:permit:common')
      .setLabel('Permit')
      .setEmoji('🟢')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:reject:common')
      .setLabel('Reject')
      .setEmoji('🔴')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:transfer:common')
      .setLabel('Transfer')
      .setEmoji('👑')
      .setStyle(ButtonStyle.Secondary)
  );

  // 5. Row 3: Bitrate Dropdown Select Menu
  const bitrateSelect = new StringSelectMenuBuilder()
    .setCustomId('fb:jtc:bitrate_sel:common')
    .setPlaceholder('Adjust Voice Channel Audio Bitrate')
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('64 kbps (Standard)')
        .setDescription('Standard audio quality suitable for speech')
        .setValue('64000'),
      new StringSelectMenuOptionBuilder()
        .setLabel('96 kbps (High Quality)')
        .setDescription('High definition voice clarity')
        .setValue('96000'),
      new StringSelectMenuOptionBuilder()
        .setLabel('128 kbps (Ultra Quality)')
        .setDescription('Ultra clear for music & crisp voice')
        .setValue('128000'),
      new StringSelectMenuOptionBuilder()
        .setLabel('32 kbps (Bandwidth Saver)')
        .setDescription('Low data usage mode')
        .setValue('32000')
    );
  const row3 = new ActionRowBuilder().addComponents(bitrateSelect);

  // 6. Row 4: Everyone Actions (Claim, TTS room toggle, User TTS prefs)
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('fb:jtc:claim:common')
      .setLabel('Claim Room')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:tts_room:common')
      .setLabel('Room TTS')
      .setEmoji('🔊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('fb:jtc:tts_me:common')
      .setLabel('My TTS')
      .setEmoji('🎧')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);
  container.addActionRowComponents(row3);
  container.addActionRowComponents(row4);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}


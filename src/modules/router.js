import {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder
} from 'discord.js';
import {
  getTempChannel,
  getTempChannelByOwner,
  updateTempChannel,
  deleteTempChannel,
  saveUserVoicePrefs,
  getUserTTSPrefs,
  saveUserTTSPrefs
} from '../db/voice.js';
import { getGuildSettings, updateGuildSettings } from '../db/guilds.js';
import { createFeedback } from '../db/feedback.js';
import { createSuggestion, getSuggestionById } from '../db/suggestions.js';
import { getPanelState, savePanelState } from '../db/panels.js';
import {
  handleSuggestionVote,
  handleSuggestionModeration,
  checkStaffPermission,
  buildSuggestionCard,
  postSuggestionMessage
} from './suggestions/index.js';
import {
  buildFeedbackCard,
  buildFeedbackModal,
  handleFeedbackModalSubmit,
  handleFeedbackSkipImage,
  handleFeedbackAction,
  handleFeedbackReplySubmit,
  postFeedbackMessage
} from './feedback/index.js';
import {
  buildControlCard,
  buildCommonControlCard,
  refreshControlMessage
} from './voice/control.js';
import {
  checkRenameRateLimit,
  transferRoomOwnership,
  voiceMembersTime
} from './voice/jtc.js';
import { renderStaffPanel } from './staff/panel.js';
import { ttsEngine } from './voice/tts/engine.js';
import { ComponentBuilder } from '../ui/builder.js';
import {
  buildBotProfilePanel,
  buildNicknameModal,
  buildBioModal,
  buildAvatarModal,
  buildBannerModal,
  buildAllProfileModal
} from './settings/botprofile.js';
import { buildTTSPanel, buildCustomSpeechModal } from './voice/tts/panel.js';
import { getVoice, listVoicesByCategory } from './voice/tts/voices.js';
import { buildAutoModPanel, buildBannedWordsModal } from './automod/panel.js';
import { buildBoostPanel, buildBoostMessageModal } from './boosts/panel.js';
import { buildBoostCelebrationCard } from './boosts/tracker.js';
import { buildStickyPanel, buildStickyNoteModal } from './sticky/panel.js';
import { getStickyNote, getAllStickyNotes, setStickyNote, toggleStickyNote, deleteStickyNote } from '../db/sticky.js';
import { buildStickyRolesPanel } from './stickyroles/panel.js';
import { buildAutoRolePanel } from './autorole/panel.js';
import { infoCard } from '../ui/cards.js';
import {
  getLogConfig,
  updateLogConfig,
  buildLogsPanel,
  buildLogCard,
  dispatchLog
} from './logs/engine.js';
import * as format from '../utils/ui/format.js';
import { logger } from '../utils/logger.js';

/**
 * Converts any simple string into a compliant borderless Components V2 container card
 */
function v2TextCard(text, flags = MessageFlags.Ephemeral) {
  const container = new ContainerBuilder();
  let title = '## 💬 Notice';
  if (text.startsWith('❌') || text.startsWith('⛔') || text.startsWith('🛑')) {
    title = '## 🛑 Action Failed';
  } else if (text.startsWith('⚠️')) {
    title = '## ⚠️ Notice';
  } else if (text.startsWith('✅') || text.startsWith('🟢') || text.startsWith('👑') || text.startsWith('👍') || text.startsWith('🔔')) {
    title = '## ✅ Success';
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(text)));

  const isEphemeral = (flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral || flags === 64;
  return {
    flags: isEphemeral ? (MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral) : MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Safe helper to update panel messages without failing on uncached channels
 */
async function safeUpdatePanel(interaction, payload) {
  const safePayload = {
    ...payload,
    flags: MessageFlags.IsComponentsV2
  };
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply(safePayload).catch(err => {
      logger.debug({ err }, 'Interaction editReply fallback to message.edit');
      return interaction.message?.edit(safePayload).catch(() => {});
    });
  }
  return interaction.update(safePayload).catch(err => {
    logger.debug({ err }, 'Interaction update fallback to message.edit');
    return interaction.message?.edit(safePayload).catch(() => {});
  });
}

/**
 * Central Interaction Router for all customIds matching `fb:<module>:<action>:<id>` and temp legacy IDs
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} True if handled, false if not an fb:* interaction
 */
export async function handleFeedbackVoiceInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId) {
    return false;
  }

  // Intercept text replies to ensure pure Components V2 compliance across all router branches
  if (typeof interaction.reply === 'function') {
    const origReply = interaction.reply.bind(interaction);
    interaction.reply = (options) => {
      if (options && typeof options === 'object' && options.content && !options.components) {
        return origReply(v2TextCard(options.content, options.flags));
      }
      return origReply(options);
    };
  }
  if (typeof interaction.editReply === 'function') {
    const origEditReply = interaction.editReply.bind(interaction);
    interaction.editReply = (options) => {
      if (options && typeof options === 'object' && options.content && !options.components) {
        return origEditReply(v2TextCard(options.content, options.flags));
      }
      return origEditReply(options);
    };
  }
  if (typeof interaction.followUp === 'function') {
    const origFollowUp = interaction.followUp.bind(interaction);
    interaction.followUp = (options) => {
      if (options && typeof options === 'object' && options.content && !options.components) {
        return origFollowUp(v2TextCard(options.content, options.flags));
      }
      return origFollowUp(options);
    };
  }

  // Direct compatibility with temp feedback customIds
  if (customId === 'open_feedback_modal') {
    const modal = buildFeedbackModal('0');
    await interaction.showModal(modal);
    return true;
  }
  if (customId === 'feedback_modal') {
    await handleFeedbackModalSubmit(interaction);
    return true;
  }
  if (customId === 'skip_image') {
    await handleFeedbackSkipImage(interaction);
    return true;
  }

  if (!customId.startsWith('fb:')) {
    return false;
  }

  // Parse: fb:<module>:<action>:<id>
  const parts = customId.split(':');
  if (parts.length < 4) {
    return false;
  }

  const [, module, action, id] = parts;

  try {
    switch (module) {
      case 'sug':
        await routeSuggestionInteraction(interaction, action, id);
        return true;

      case 'fbk':
        await routeFeedbackInteraction(interaction, action, id);
        return true;

      case 'jtc':
        await routeJTCInteraction(interaction, action, id);
        return true;

      case 'tts':
        await routeTTSInteraction(interaction, action, id);
        return true;

      case 'panel':
        await routePanelInteraction(interaction, action, id);
        return true;

      case 'cb':
        await routeComponentBuilderInteraction(interaction, action, id);
        return true;

      case 'bp':
        await routeBotProfileInteraction(interaction, action, id);
        return true;

      case 'am':
        await routeAutoModInteraction(interaction, action, id);
        return true;

      case 'bst':
        await routeBoostInteraction(interaction, action, id);
        return true;

      case 'stk':
        await routeStickyInteraction(interaction, action, id);
        return true;

      case 'sr':
        await routeStickyRolesInteraction(interaction, action, id);
        return true;

      case 'ar':
        await routeAutoRoleInteraction(interaction, action, id);
        return true;

      case 'logs':
        await routeLogsInteraction(interaction, action, id);
        return true;

      default:
        logger.warn({ customId }, 'Unrecognized fb interaction module');
        return false;
    }
  } catch (err) {
    logger.error({ err, customId }, 'Error in central interaction router');
    const errMsg = v2TextCard('❌ An error occurred while processing this action. Please try again in a moment.', MessageFlags.Ephemeral);
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(errMsg).catch(() => {});
    } else {
      await interaction.reply(errMsg).catch(() => {});
    }
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SUGGESTIONS ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeSuggestionInteraction(interaction, action, id) {
  if (action === 'open' || action === 'open_modal') {
    const modal = new ModalBuilder()
      .setCustomId('fb:sug:mod_submit:0')
      .setTitle('Submit a Suggestion');

    const sugInput = new TextInputBuilder()
      .setCustomId('sug_text')
      .setLabel('Your Suggestion')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('What would you like to suggest for the server?')
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(sugInput));
    return interaction.showModal(modal);
  }

  if (action === 'up' || action === 'down') {
    return handleSuggestionVote(interaction, id, action);
  }
  if (['approve', 'deny', 'implement', 'del'].includes(action)) {
    return handleSuggestionModeration(interaction, id, action);
  }
  if (action === 'mod_submit') {
    // Member submitted /suggest modal (if opened via button)
    const text = interaction.fields.getTextInputValue('sug_text');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildSettings = await getGuildSettings(interaction.guildId);
    if (!guildSettings?.suggestion_channel_id) {
      return interaction.editReply({ content: '❌ Suggestions channel has not been configured by staff.' });
    }

    const channel = interaction.guild.channels.cache.get(guildSettings.suggestion_channel_id);
    if (!channel) {
      return interaction.editReply({ content: '❌ Configured suggestions channel was not found.' });
    }

    const { suggestion, thread } = await postSuggestionMessage({
      guild: interaction.guild,
      channel,
      author: interaction.user,
      text
    });

    const threadNotice = thread ? ` Check the discussion thread in <#${thread.id}>!` : '';
    return interaction.editReply({ content: `✅ Your suggestion has been posted to <#${channel.id}>!${threadNotice}` });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FEEDBACK ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeFeedbackInteraction(interaction, action, id) {
  if (action === 'open' || action === 'open_modal') {
    const modal = buildFeedbackModal(id);
    return interaction.showModal(modal);
  }

  if (action === 'submit' || action === 'modal') {
    return handleFeedbackModalSubmit(interaction);
  }

  if (action === 'skip_img' || action === 'skip_image') {
    return handleFeedbackSkipImage(interaction);
  }

  if (action === 'reply_mod') {
    return handleFeedbackReplySubmit(interaction, id);
  }

  if (['read', 'reply', 'resolve', 'del'].includes(action)) {
    return handleFeedbackAction(interaction, id, action);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. JOIN-TO-CREATE & CONTROL INTERFACE ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeJTCInteraction(interaction, action, channelId) {
  let resolvedChannelId = channelId;
  const isCommon = channelId === 'common' || channelId === '0';

  if (isCommon) {
    // 1. Try to find the temp channel the member is currently inside
    const memberVc = interaction.member?.voice?.channel;
    if (memberVc) {
      const isTemp = await getTempChannel(memberVc.id);
      if (isTemp) {
        resolvedChannelId = memberVc.id;
      }
    }

    // 2. If not currently connected to an active temp channel, check if the member owns an active temp channel on this server
    if (resolvedChannelId === 'common' || resolvedChannelId === '0') {
      const owned = await getTempChannelByOwner(interaction.guildId, interaction.user.id);
      if (owned) {
        resolvedChannelId = owned.channel_id;
      }
    }

    // 3. If neither, return helpful guidance
    if (resolvedChannelId === 'common' || resolvedChannelId === '0') {
      return interaction.reply({
        content: '⚠️ **No Active Temporary Voice Room:**\nYou must be connected to or own an active temporary voice channel to manage it. Join the Join-to-Create voice channel first to create your room!',
        flags: MessageFlags.Ephemeral
      });
    }
  }

  const channel = interaction.guild.channels.cache.get(resolvedChannelId);
  const tempRecord = await getTempChannel(resolvedChannelId);

  if (!tempRecord || !channel) {
    return interaction.reply({
      content: '❌ This temporary voice room is no longer active.',
      flags: MessageFlags.Ephemeral
    });
  }

  const isOwner = tempRecord.owner_id === interaction.user.id;

  // EVERYONE ACTION: CLAIM ROOM
  if (action === 'claim') {
    const ownerMember = channel.members.get(tempRecord.owner_id);
    if (ownerMember) {
      return interaction.reply({
        content: `⛔ The room owner (<@${tempRecord.owner_id}>) is still connected to **${channel.name}**.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // Verify claimant is inside the channel
    if (!channel.members.has(interaction.user.id)) {
      return interaction.reply({
        content: `⛔ You must be inside **${channel.name}** to claim ownership.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferUpdate().catch(() => {});
    await transferRoomOwnership(channel, tempRecord, interaction.user.id, 'Claimed by member');
    return interaction.followUp({
      content: `👑 You have successfully claimed ownership of **${channel.name}**!`,
      flags: MessageFlags.Ephemeral
    });
  }

  // EVERYONE ACTION: PERSONAL TTS TOGGLE
  if (action === 'tts_me') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const currentPrefs = await getUserTTSPrefs(interaction.user.id, interaction.guildId);
    const newOptOut = !(currentPrefs?.opt_out ?? false);
    await saveUserTTSPrefs(interaction.user.id, interaction.guildId, { optOut: newOptOut });

    return interaction.editReply({
      content: newOptOut
        ? '🔇 **TTS Opt-Out:** The bot will no longer speak your messages in voice channels.'
        : '🔊 **TTS Opt-In:** The bot will now speak your messages in TTS-enabled voice channels.'
    });
  }

  // EVERYONE ACTION: SUGGESTION / FEEDBACK SHORTCUTS
  if (action === 'sug') {
    const modal = new ModalBuilder()
      .setCustomId(`fb:sug:mod_submit:0`)
      .setTitle('Submit a Suggestion');

    const sugInput = new TextInputBuilder()
      .setCustomId('sug_text')
      .setLabel('Your Suggestion')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('What would you like to suggest for the server?')
      .setRequired(true)
      .setMinLength(10)
      .setMaxLength(1000);

    modal.addComponents(new ActionRowBuilder().addComponents(sugInput));
    return interaction.showModal(modal);
  }

  if (action === 'fbk') {
    const modal = buildFeedbackModal(resolvedChannelId);
    return interaction.showModal(modal);
  }

  // ── GATE OWNER-ONLY ACTIONS BELOW ──
  if (!isOwner) {
    return interaction.reply({
      content: `⛔ Only the room owner (<@${tempRecord.owner_id}>) can manage **${channel.name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ── VOICE MANAGER ACTIONS DROPDOWN (8 ACTIONS) ──
  if (action === 'action_sel') {
    const selectedAction = interaction.values?.[0];

    // 1. Lock Your Channel
    if (selectedAction === 'lock') {
      await interaction.deferUpdate().catch(() => {});
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        Connect: false
      }).catch(err => logger.warn({ err }, 'Error setting lock overwrite'));

      await updateTempChannel(resolvedChannelId, { is_locked: true });
      await refreshControlMessage(channel);

      return interaction.followUp({
        content: `🔒 **${channel.name}** is now **Locked**. Others are prevented from joining.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // 2. Unlock Your Channel
    if (selectedAction === 'unlock') {
      await interaction.deferUpdate().catch(() => {});
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        Connect: true
      }).catch(err => logger.warn({ err }, 'Error setting unlock overwrite'));

      await updateTempChannel(resolvedChannelId, { is_locked: false });
      await refreshControlMessage(channel);

      return interaction.followUp({
        content: `🔓 **${channel.name}** is now **Unlocked**. Others can now join.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // 3. Hide Your Channel
    if (selectedAction === 'hide') {
      await interaction.deferUpdate().catch(() => {});
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        ViewChannel: false
      }).catch(err => logger.warn({ err }, 'Error setting hide overwrite'));

      await updateTempChannel(resolvedChannelId, { is_hidden: true });
      await refreshControlMessage(channel);

      return interaction.followUp({
        content: `🙈 **${channel.name}** is now **Hidden**. It is invisible in the server list.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // 4. Reveal Your Channel
    if (selectedAction === 'reveal') {
      await interaction.deferUpdate().catch(() => {});
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        ViewChannel: true
      }).catch(err => logger.warn({ err }, 'Error setting reveal overwrite'));

      await updateTempChannel(resolvedChannelId, { is_hidden: false });
      await refreshControlMessage(channel);

      return interaction.followUp({
        content: `👁️ **${channel.name}** is now **Revealed**. It is visible to everyone.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // 5. Delete Your Channel
    if (selectedAction === 'delete') {
      await interaction.reply({
        content: `🗑️ Permanently deleting **${channel.name}**...`,
        flags: MessageFlags.Ephemeral
      });

      await deleteTempChannel(resolvedChannelId);
      await channel.delete('Permanently deleted by room owner via Voice Manager').catch(err => {
        logger.warn({ err, channelId: resolvedChannelId }, 'Failed to delete voice channel');
      });
      return;
    }

    // 6. Rename Your Channel
    if (selectedAction === 'rename') {
      const modal = new ModalBuilder()
        .setCustomId(`fb:jtc:rename_mod:${resolvedChannelId}`)
        .setTitle('Rename Your Channel');

      const nameInput = new TextInputBuilder()
        .setCustomId('channel_name')
        .setLabel('New Channel Name')
        .setStyle(TextInputStyle.Short)
        .setValue(channel.name)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(100);

      modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
      return interaction.showModal(modal);
    }

    // 7. Set Channel Bitrate
    if (selectedAction === 'bitrate') {
      const bitrateKbps = Math.round((channel?.bitrate ?? 64000) / 1000);
      const bitrateSelect = new StringSelectMenuBuilder()
        .setCustomId(`fb:jtc:bitrate_exec:${resolvedChannelId}`)
        .setPlaceholder(`Select Bitrate (Current: ${bitrateKbps} kbps)`)
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('64 kbps (Standard)')
            .setDescription('Standard audio quality suitable for speech')
            .setValue('64000')
            .setDefault(bitrateKbps === 64)
            .setEmoji('🌐'),
          new StringSelectMenuOptionBuilder()
            .setLabel('96 kbps (High Quality)')
            .setDescription('High definition voice clarity')
            .setValue('96000')
            .setDefault(bitrateKbps === 96)
            .setEmoji('🌐'),
          new StringSelectMenuOptionBuilder()
            .setLabel('128 kbps (Ultra Quality)')
            .setDescription('Ultra clear for music & crisp voice')
            .setValue('128000')
            .setDefault(bitrateKbps === 128)
            .setEmoji('🌐'),
          new StringSelectMenuOptionBuilder()
            .setLabel('32 kbps (Bandwidth Saver)')
            .setDescription('Low data usage mode')
            .setValue('32000')
            .setDefault(bitrateKbps === 32)
            .setEmoji('🌐')
        );

      const row = new ActionRowBuilder().addComponents(bitrateSelect);
      return interaction.reply({
        content: `🌐 **Set Channel Bitrate:** Choose audio quality for **${channel.name}**:`,
        components: [row],
        flags: MessageFlags.Ephemeral
      });
    }

    // 8. Set User Limit
    if (selectedAction === 'limit') {
      const modal = new ModalBuilder()
        .setCustomId(`fb:jtc:limit_mod:${resolvedChannelId}`)
        .setTitle('Set User Limit');

      const limitInput = new TextInputBuilder()
        .setCustomId('user_limit')
        .setLabel('User Limit (0-99, 0 = Unlimited)')
        .setStyle(TextInputStyle.Short)
        .setValue(String(channel.userLimit))
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(2);

      modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
      return interaction.showModal(modal);
    }
  }

  // ── DISCONNECT USERS (BUTTON & SELECTION) ──
  if (action === 'disconnect') {
    const disconnectable = channel.members?.filter
      ? channel.members.filter(m => m.id !== interaction.user.id && !m.user.bot)
      : new Map();

    if (disconnectable.size === 0) {
      return interaction.reply({
        content: `ℹ️ There are no other members in **${channel.name}** to disconnect.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`fb:jtc:disconnect_exec:${resolvedChannelId}`)
      .setPlaceholder('Select member to disconnect...');

    const row = new ActionRowBuilder().addComponents(userSelect);
    return interaction.reply({
      content: `Select a member below to **disconnect** from **${channel.name}**:`,
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'disconnect_exec') {
    const targetUserId = interaction.values[0];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targetMember = channel.members?.get?.(targetUserId);
    if (targetMember && targetMember.voice) {
      await targetMember.voice.disconnect('Disconnected by room owner').catch(() => {});
      return interaction.editReply({ content: `↪️ Disconnected <@${targetUserId}> from **${channel.name}**.` });
    }
    return interaction.editReply({ content: `⚠️ <@${targetUserId}> is not currently in **${channel.name}**.` });
  }

  // OWNER ACTION: RENAME MODAL OPEN
  if (action === 'rename') {
    const modal = new ModalBuilder()
      .setCustomId(`fb:jtc:rename_mod:${resolvedChannelId}`)
      .setTitle(`Rename: ${channel.name.slice(0, 30)}`);

    const nameInput = new TextInputBuilder()
      .setCustomId('channel_name')
      .setLabel('New Channel Name')
      .setStyle(TextInputStyle.Short)
      .setValue(channel.name)
      .setRequired(true)
      .setMinLength(2)
      .setMaxLength(100);

    modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
    return interaction.showModal(modal);
  }

  // OWNER ACTION: RENAME MODAL SUBMIT
  if (action === 'rename_mod') {
    const newName = interaction.fields.getTextInputValue('channel_name').trim();
    const rateCheck = checkRenameRateLimit(resolvedChannelId);

    if (!rateCheck.allowed) {
      return interaction.reply({
        content: `⚠️ Discord limits channel renames to **2 per 10 minutes**. Please wait **${rateCheck.waitSeconds}s** before renaming again.`,
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferUpdate().catch(() => {});
    await channel.setName(newName).catch(err => {
      logger.warn({ err, channelId: resolvedChannelId }, 'Failed to set channel name');
    });

    await updateTempChannel(resolvedChannelId, { name: newName });
    await saveUserVoicePrefs(interaction.user.id, interaction.guildId, { preferredName: newName });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: `✏️ Room **${newName}** renamed successfully (saved as your default).`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: LIMIT MODAL OPEN
  if (action === 'limit') {
    const modal = new ModalBuilder()
      .setCustomId(`fb:jtc:limit_mod:${resolvedChannelId}`)
      .setTitle('Set User Limit');

    const limitInput = new TextInputBuilder()
      .setCustomId('user_limit')
      .setLabel('User Limit (0-99, 0 = Unlimited)')
      .setStyle(TextInputStyle.Short)
      .setValue(String(channel.userLimit))
      .setRequired(true)
      .setMinLength(1)
      .setMaxLength(2);

    modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
    return interaction.showModal(modal);
  }

  // OWNER ACTION: LIMIT MODAL SUBMIT
  if (action === 'limit_mod') {
    const rawVal = interaction.fields.getTextInputValue('user_limit');
    const limit = Math.min(Math.max(parseInt(rawVal, 10) || 0, 0), 99);

    await interaction.deferUpdate().catch(() => {});
    await channel.setUserLimit(limit).catch(err => {
      logger.warn({ err, channelId: resolvedChannelId }, 'Failed to set user limit');
    });

    await updateTempChannel(resolvedChannelId, { user_limit: limit });
    await saveUserVoicePrefs(interaction.user.id, interaction.guildId, { preferredLimit: limit });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: `👥 User limit for **${channel.name}** updated to **${limit === 0 ? 'Unlimited' : limit}** (saved as your default).`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: LOCK / UNLOCK TOGGLE
  if (action === 'lock') {
    await interaction.deferUpdate().catch(() => {});
    const newLock = !tempRecord.is_locked;

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: newLock ? false : true
    }).catch(err => logger.warn({ err }, 'Error setting lock overwrite'));

    await updateTempChannel(resolvedChannelId, { is_locked: newLock });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: newLock ? `🔒 **${channel.name}** is now **Locked**.` : `🔓 **${channel.name}** is now **Unlocked**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: HIDE / UNHIDE TOGGLE
  if (action === 'hide') {
    await interaction.deferUpdate().catch(() => {});
    const newHide = !tempRecord.is_hidden;

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      ViewChannel: newHide ? false : true
    }).catch(err => logger.warn({ err }, 'Error setting hide overwrite'));

    await updateTempChannel(resolvedChannelId, { is_hidden: newHide });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: newHide ? `👁️ **${channel.name}** is now **Hidden**.` : `👁️‍🗨️ **${channel.name}** is now **Visible**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: RESET ROOM
  if (action === 'reset') {
    await interaction.deferUpdate().catch(() => {});
    const defaultTemplate = "{username}'s room";
    const defaultName = defaultTemplate.replace(/\{username\}/gi, interaction.member.displayName);

    await channel.setName(defaultName).catch(() => {});
    await channel.setUserLimit(0).catch(() => {});
    await channel.setBitrate(64000).catch(() => {});

    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: true,
      ViewChannel: true
    }).catch(() => {});

    await updateTempChannel(resolvedChannelId, {
      name: defaultName,
      user_limit: 0,
      bitrate: 64000,
      is_locked: false,
      is_hidden: false,
      tts_enabled: true
    });

    await refreshControlMessage(channel);
    return interaction.followUp({
      content: `🔄 **${channel.name}** settings and permissions have been reset to defaults.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: BITRATE SELECT MENU
  if (action === 'bitrate_sel') {
    await interaction.deferUpdate().catch(() => {});
    const bitrate = parseInt(interaction.values[0], 10);
    const maxBitrate = interaction.guild.maximumBitrate || 96000;
    const clamped = Math.min(bitrate, maxBitrate);

    await channel.setBitrate(clamped).catch(err => logger.warn({ err }, 'Failed to set bitrate'));
    await updateTempChannel(resolvedChannelId, { bitrate: clamped });
    await saveUserVoicePrefs(interaction.user.id, interaction.guildId, { preferredBitrate: clamped });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: `⚡ **${channel.name}** audio bitrate set to **${Math.round(clamped / 1000)} kbps** (saved as your default).`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: ROOM TTS TOGGLE
  if (action === 'tts_room') {
    await interaction.deferUpdate().catch(() => {});
    const newTTS = !tempRecord.tts_enabled;
    await updateTempChannel(resolvedChannelId, { tts_enabled: newTTS });
    await refreshControlMessage(channel);

    return interaction.followUp({
      content: newTTS ? `🔊 Room TTS is now **Active** in **${channel.name}**.` : `🔇 Room TTS is now **Muted** in **${channel.name}**.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: MEMBER SELECTION PROMPTS (KICK, PERMIT, REJECT, TRANSFER)
  if (['kick', 'permit', 'reject', 'transfer'].includes(action)) {
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`fb:jtc:${action}_exec:${resolvedChannelId}`)
      .setPlaceholder(`Select user to ${action}`);

    const row = new ActionRowBuilder().addComponents(userSelect);
    return interaction.reply({
      content: `Select a member below to **${action}** in **${channel.name}**:`,
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // OWNER ACTION: MEMBER SELECTION EXECUTION
  if (action.endsWith('_exec')) {
    const targetUserId = interaction.values[0];
    const subAction = action.replace('_exec', '');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (subAction === 'kick') {
      const targetMember = channel.members.get(targetUserId);
      if (targetMember) {
        await targetMember.voice.disconnect(`Kicked by room owner`).catch(() => {});
        return interaction.editReply({ content: `👢 Disconnected <@${targetUserId}> from **${channel.name}**.` });
      }
      return interaction.editReply({ content: `⚠️ <@${targetUserId}> is not currently in **${channel.name}**.` });
    }

    if (subAction === 'permit') {
      await channel.permissionOverwrites.edit(targetUserId, {
        Connect: true,
        ViewChannel: true
      });
      return interaction.editReply({ content: `🟢 Permitted <@${targetUserId}> to join **${channel.name}**.` });
    }

    if (subAction === 'reject') {
      await channel.permissionOverwrites.edit(targetUserId, {
        Connect: false
      });
      const targetMember = channel.members.get(targetUserId);
      if (targetMember) {
        await targetMember.voice.disconnect(`Rejected by room owner`).catch(() => {});
      }
      return interaction.editReply({ content: `🔴 Rejected <@${targetUserId}> from accessing **${channel.name}**.` });
    }

    if (subAction === 'transfer') {
      const transferred = await transferRoomOwnership(channel, tempRecord, targetUserId, 'Manual owner transfer');
      if (transferred) {
        return interaction.editReply({ content: `👑 Ownership of **${channel.name}** transferred to <@${targetUserId}>.` });
      } else {
        return interaction.editReply({ content: `❌ Failed to transfer ownership of **${channel.name}** to <@${targetUserId}>.` });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TTS ROUTER
// ─────────────────────────────────────────────────────────────────────────────
// 4. TTS INTERACTIVE PANEL ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeTTSInteraction(interaction, action, id) {
  const guild = interaction.guild;
  if (!guild) return;

  // 1. VOICE SELECTION DROPDOWN
  if (action === 'voice_sel') {
    await interaction.deferUpdate().catch(() => {});
    const selectedVoiceId = interaction.values?.[0] || 'en-us';
    const voice = getVoice(selectedVoiceId);

    await saveUserTTSPrefs(interaction.user.id, guild.id, {
      language: voice.id,
      voice: voice.id
    });

    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: `Active voice set to ${voice.emoji} **${voice.name}** (\`${voice.id}\`).`
    });
    return safeUpdatePanel(interaction, payload);
  }

  // 2. JOIN & BIND
  if (action === 'join') {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ You must be connected to a voice channel to summon the TTS reader.',
        flags: MessageFlags.Ephemeral
      });
    }

    const me = guild.members?.me || interaction.client.user;
    const perms = voiceChannel.permissionsFor?.(me);
    if (perms && (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak))) {
      return interaction.reply({
        content: '❌ The bot lacks permission to Connect or Speak in your voice channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferUpdate().catch(() => {});
    try {
      await ttsEngine.joinAndBind({
        guild,
        voiceChannel,
        textChannel: interaction.channel,
        userId: interaction.user.id
      });

      const payload = await buildTTSPanel({
        guild,
        client: interaction.client,
        user: interaction.user,
        note: `Joined **${voiceChannel.name}** and bound to <#${interaction.channel.id}>.`
      });
      return safeUpdatePanel(interaction, payload);
    } catch (err) {
      logger.error({ err }, 'Failed to join voice channel via TTS panel');
      const payload = await buildTTSPanel({
        guild,
        client: interaction.client,
        user: interaction.user,
        note: `Failed to join: ${err.message}`
      });
      return safeUpdatePanel(interaction, payload);
    }
  }

  // 3. LEAVE / DISCONNECT
  if (action === 'leave') {
    await interaction.deferUpdate().catch(() => {});
    ttsEngine.stop(guild.id);
    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: 'Disconnected from voice channel.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  // 4. SPEAK TEST BUTTON
  if (action === 'test_btn') {
    const session = ttsEngine.getSession(guild.id);
    if (!session) {
      return interaction.reply({
        content: '❌ TTS reader is not connected. Click **Join & Bind** first.',
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferUpdate().catch(() => {});
    const userPrefs = await getUserTTSPrefs(interaction.user.id, guild.id);
    const voice = getVoice(userPrefs?.language || 'en-us');
    const rawName = interaction.member?.displayName || interaction.user.username;
    const vc = guild.channels.cache.get(session.voiceChannelId);

    if (vc) {
      await ttsEngine.queueSpeech({
        guild,
        voiceChannel: vc,
        text: `${rawName} says, Testing speech synthesizer with voice ${voice.name}`,
        authorId: interaction.user.id,
        voice: voice.id
      });
    }

    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: `Spoke audio test line in ${voice.emoji} **${voice.name}**.`
    });
    return safeUpdatePanel(interaction, payload);
  }

  // 5. CUSTOM SPEECH MODAL
  if (action === 'speak_mod_btn') {
    const session = ttsEngine.getSession(guild.id);
    if (!session) {
      return interaction.reply({
        content: '❌ TTS reader is not connected. Click **Join & Bind** first.',
        flags: MessageFlags.Ephemeral
      });
    }
    return interaction.showModal(buildCustomSpeechModal());
  }

  if (action === 'speak_mod') {
    const session = ttsEngine.getSession(guild.id);
    if (!session) {
      return interaction.reply({
        content: '❌ TTS reader is no longer connected.',
        flags: MessageFlags.Ephemeral
      });
    }

    const text = interaction.fields.getTextInputValue('tts_text')?.trim();
    if (!text) {
      return interaction.reply({ content: '❌ Speech text cannot be empty.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate().catch(() => {});
    const userPrefs = await getUserTTSPrefs(interaction.user.id, guild.id);
    const voice = getVoice(userPrefs?.language || 'en-us');
    const rawName = interaction.member?.displayName || interaction.user.username;
    const vc = guild.channels.cache.get(session.voiceChannelId);

    if (vc) {
      await ttsEngine.queueSpeech({
        guild,
        voiceChannel: vc,
        text: `${rawName} says, ${text}`,
        authorId: interaction.user.id,
        voice: voice.id
      });
    }

    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: `Spoke custom message aloud in ${voice.emoji} **${voice.name}**.`
    });
    return safeUpdatePanel(interaction, payload);
  }

  // 6. TOGGLE OPT-IN / OPT-OUT
  if (action === 'opt_toggle') {
    await interaction.deferUpdate().catch(() => {});
    const userPrefs = await getUserTTSPrefs(interaction.user.id, guild.id);
    const newOpt = !userPrefs?.opt_out;

    await saveUserTTSPrefs(interaction.user.id, guild.id, {
      optOut: newOpt
    });

    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: newOpt
        ? 'Opted out: Your upcoming messages in monitored chats will be skipped.'
        : 'Opted in: Your upcoming messages in monitored chats will be read aloud.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  // 7. CATALOG POPUP
  if (action === 'catalog_btn') {
    const categories = listVoicesByCategory();
    const userPrefs = await getUserTTSPrefs(interaction.user.id, guild.id);
    const currentVoice = getVoice(userPrefs?.language || 'en-us');

    const fxList = categories['Character & FX']
      .map(v => `• ${v.emoji} **${v.name}** (\`${v.id}\`): ${v.description}`)
      .join('\n');

    const regionalList = categories['Accents & Languages']
      .map(v => `• ${v.emoji} **${v.name}** (\`${v.id}\`)`)
      .join('\n');

    return interaction.reply({
      ...infoCard({
        title: 'Available TTS Voices',
        subtitle: `Active Voice: ${currentVoice.emoji} **${currentVoice.name}** (\`${currentVoice.id}\`)`,
        body: [
          '### Character & FX Voices *(Local FFmpeg DSP)*',
          fxList,
          '',
          '### Regional Accents & Languages *(Free Web TTS)*',
          regionalList
        ].join('\n')
      }),
      flags: MessageFlags.Ephemeral
    });
  }

  // 8. REFRESH PANEL
  if (action === 'refresh') {
    await interaction.deferUpdate().catch(() => {});
    const payload = await buildTTSPanel({
      guild,
      client: interaction.client,
      user: interaction.user,
      note: 'Panel refreshed.'
    });
    return safeUpdatePanel(interaction, payload);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. CENTRAL STAFF PANEL ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routePanelInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need the configured Staff role or Manage Server permission to use this panel.',
      flags: MessageFlags.Ephemeral
    });
  }

  const currentState = await getPanelState(interaction.guildId) || {
    active_tab: 'sug',
    filter_status: 'all',
    page: 1
  };

  // TAB SWITCHING
  if (action === 'tab') {
    await interaction.deferUpdate().catch(() => {});
    const newTab = id;
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      activeTab: newTab,
      page: 1,
      filterStatus: 'all'
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: newTab,
      filterStatus: 'all',
      page: 1
    });
    return safeUpdatePanel(interaction, payload);
  }

  // TAB REFRESH
  if (action === 'refresh') {
    await interaction.deferUpdate().catch(() => {});
    const targetTab = id || currentState.active_tab || 'sug';
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      activeTab: targetTab,
      filterStatus: currentState.filter_status || 'all',
      page: currentState.page || 1
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: targetTab,
      filterStatus: currentState.filter_status || 'all',
      page: currentState.page || 1
    });
    return safeUpdatePanel(interaction, payload);
  }

  // SUGGESTIONS PAGINATION & FILTER
  if (action === 'sug_page') {
    await interaction.deferUpdate().catch(() => {});
    const newPage = parseInt(id, 10) || 1;
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      page: newPage
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'sug',
      filterStatus: currentState.filter_status || 'all',
      page: newPage
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'sug_filter') {
    await interaction.deferUpdate().catch(() => {});
    const filter = interaction.values[0];
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      filterStatus: filter,
      page: 1
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'sug',
      filterStatus: filter,
      page: 1
    });
    return safeUpdatePanel(interaction, payload);
  }

  // SUGGESTION MODERATION MENU FROM STAFF PANEL
  if (action === 'sug_mod_menu') {
    const suggestionId = interaction.values[0];
    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return interaction.reply({
        content: '❌ Suggestion not found or has been deleted.',
        flags: MessageFlags.Ephemeral
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fb:sug:approve:${suggestionId}`)
        .setLabel('Approve')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(suggestion.status === 'approved'),
      new ButtonBuilder()
        .setCustomId(`fb:sug:deny:${suggestionId}`)
        .setLabel('Deny')
        .setEmoji('❌')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(suggestion.status === 'denied'),
      new ButtonBuilder()
        .setCustomId(`fb:sug:implement:${suggestionId}`)
        .setLabel('Implemented')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(suggestion.status === 'implemented'),
      new ButtonBuilder()
        .setCustomId(`fb:sug:del:${suggestionId}`)
        .setLabel('Delete')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary)
    );

    return interaction.reply({
      content: `### 🛡️ Moderate Suggestion \`#${suggestionId}\`\n**Author:** <@${suggestion.author_id}>\n**Status:** \`${suggestion.status.toUpperCase()}\`\n> *" ${suggestion.text.slice(0, 300)} "*\n\nChoose an action below:`,
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  // FEEDBACK PAGINATION & FILTER
  if (action === 'fbk_page') {
    await interaction.deferUpdate().catch(() => {});
    const newPage = parseInt(id, 10) || 1;
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      page: newPage
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'fbk',
      filterStatus: currentState.filter_status || 'all',
      page: newPage
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'fbk_filter') {
    await interaction.deferUpdate().catch(() => {});
    const filter = interaction.values[0];
    await savePanelState(interaction.guildId, {
      channelId: interaction.channelId,
      messageId: interaction.message?.id,
      filterStatus: filter,
      page: 1
    });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'fbk',
      filterStatus: filter,
      page: 1
    });
    return safeUpdatePanel(interaction, payload);
  }

  // VOICE CONFIGURATION CONTROLS
  if (action === 'jtc_trig_sel') {
    await interaction.deferUpdate().catch(() => {});
    const channelId = interaction.values[0];
    await updateGuildSettings(interaction.guildId, { jtc_trigger_channel_id: channelId });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'jtc_cat_sel') {
    await interaction.deferUpdate().catch(() => {});
    const categoryId = interaction.values[0];
    await updateGuildSettings(interaction.guildId, { jtc_category_id: categoryId });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'tts_ann_toggle') {
    await interaction.deferUpdate().catch(() => {});
    const guildSettings = await getGuildSettings(interaction.guildId);
    const newToggle = !guildSettings?.tts_announce;
    await updateGuildSettings(interaction.guildId, { tts_announce: newToggle });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'jtc_force_del') {
    await interaction.deferUpdate().catch(() => {});
    const targetChannelId = interaction.values[0];
    const liveChan = interaction.guild.channels.cache.get(targetChannelId);
    if (liveChan) {
      await liveChan.delete('Staff force deleted room from panel').catch(() => {});
    }
    await deleteTempChannel(targetChannelId);
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'jtc_tmpl_btn') {
    const modal = new ModalBuilder()
      .setCustomId('fb:panel:jtc_tmpl_mod:0')
      .setTitle('Set JTC Room Name Template');

    const tmplInput = new TextInputBuilder()
      .setCustomId('tmpl_text')
      .setLabel('Template (use {username})')
      .setStyle(TextInputStyle.Short)
      .setValue("{username}'s room")
      .setRequired(true)
      .setMaxLength(50);

    modal.addComponents(new ActionRowBuilder().addComponents(tmplInput));
    return interaction.showModal(modal);
  }

  if (action === 'jtc_tmpl_mod') {
    const template = interaction.fields.getTextInputValue('tmpl_text');
    await interaction.deferUpdate().catch(() => {});
    await updateGuildSettings(interaction.guildId, { jtc_name_template: template });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'jtc_send_panel') {
    const isAuthorized = await checkStaffPermission(interaction);
    if (!isAuthorized) {
      return interaction.reply({
        content: '⛔ You need Manage Server permission or Staff role to deploy the control panel.',
        flags: MessageFlags.Ephemeral
      });
    }

    const chanSelect = new ChannelSelectMenuBuilder()
      .setCustomId('fb:panel:jtc_deploy_sel:0')
      .setPlaceholder('Choose a text channel for the Voice Control Panel')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const row = new ActionRowBuilder().addComponents(chanSelect);
    return interaction.reply({
      content: '📢 **Select a text channel** to deploy the Common Voice Control Panel:',
      components: [row],
      flags: MessageFlags.Ephemeral
    });
  }

  if (action === 'jtc_deploy_sel') {
    const isAuthorized = await checkStaffPermission(interaction);
    if (!isAuthorized) {
      return interaction.reply({ content: '⛔ Not authorized.', flags: MessageFlags.Ephemeral });
    }

    const targetChannelId = interaction.values[0];
    const targetChannel = interaction.guild.channels.cache.get(targetChannelId);

    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({ content: '❌ Invalid channel selected.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const payload = buildCommonControlCard({ guild: interaction.guild, client: interaction.client });

    await targetChannel.send(payload);

    return interaction.editReply({
      content: `✅ **Voice Control Panel deployed!** Sent to <#${targetChannel.id}>. Members can now manage their temporary voice rooms from that channel.`
    });
  }

  // SETTINGS CONFIGURATION CONTROLS
  if (action === 'sug_chan_sel') {
    await interaction.deferUpdate().catch(() => {});
    const channelId = interaction.values[0];
    await updateGuildSettings(interaction.guildId, { suggestion_channel_id: channelId });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'fbk_chan_sel') {
    await interaction.deferUpdate().catch(() => {});
    const channelId = interaction.values[0];
    await updateGuildSettings(interaction.guildId, { feedback_channel_id: channelId });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'staff_role_sel') {
    await interaction.deferUpdate().catch(() => {});
    const roleId = interaction.values[0];
    await updateGuildSettings(interaction.guildId, { staff_role_id: roleId });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'toggle_sug' || action === 'toggle_fbk' || action === 'toggle_jtc') {
    await interaction.deferUpdate().catch(() => {});
    const guildSettings = await getGuildSettings(interaction.guildId);
    let updates = {};
    if (action === 'toggle_sug') updates.suggestions_enabled = guildSettings?.suggestions_enabled === false;
    if (action === 'toggle_fbk') updates.feedback_enabled = guildSettings?.feedback_enabled === false;
    if (action === 'toggle_jtc') updates.jtc_enabled = guildSettings?.jtc_enabled === false;

    await updateGuildSettings(interaction.guildId, updates);
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'toggle_thread') {
    await interaction.deferUpdate().catch(() => {});
    const guildSettings = await getGuildSettings(interaction.guildId);
    const newToggle = guildSettings?.suggestion_thread_enabled === false;
    await updateGuildSettings(interaction.guildId, { suggestion_thread_enabled: newToggle });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'slowmode_sel') {
    await interaction.deferUpdate().catch(() => {});
    const slowmode = parseInt(interaction.values[0], 10) || 0;
    await updateGuildSettings(interaction.guildId, { suggestion_thread_slowmode: slowmode });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'jtc_limit_btn') {
    const modal = new ModalBuilder()
      .setCustomId('fb:panel:jtc_limit_mod:0')
      .setTitle('Set Default JTC User Limit');

    const limitInput = new TextInputBuilder()
      .setCustomId('limit_val')
      .setLabel('User Limit (0 = Unlimited, max 99)')
      .setStyle(TextInputStyle.Short)
      .setValue('0')
      .setRequired(true)
      .setMaxLength(2);

    modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
    return interaction.showModal(modal);
  }

  if (action === 'jtc_limit_mod') {
    const rawVal = interaction.fields.getTextInputValue('limit_val');
    const limit = Math.min(Math.max(parseInt(rawVal, 10) || 0, 0), 99);
    await interaction.deferUpdate().catch(() => {});
    await updateGuildSettings(interaction.guildId, { jtc_default_limit: limit });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'voice'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'cd_btn') {
    const modal = new ModalBuilder()
      .setCustomId('fb:panel:cd_mod:0')
      .setTitle('Set Suggestion Cooldown');

    const cdInput = new TextInputBuilder()
      .setCustomId('cd_sec')
      .setLabel('Cooldown in Seconds (0 to disable)')
      .setStyle(TextInputStyle.Short)
      .setValue('0')
      .setRequired(true)
      .setMaxLength(4);

    modal.addComponents(new ActionRowBuilder().addComponents(cdInput));
    return interaction.showModal(modal);
  }

  if (action === 'cd_mod') {
    const rawVal = interaction.fields.getTextInputValue('cd_sec');
    const parsed = parseInt(rawVal, 10);
    const cd = isNaN(parsed) ? 0 : Math.max(parsed, 0);
    await interaction.deferUpdate().catch(() => {});
    await updateGuildSettings(interaction.guildId, { suggestion_cooldown: cd });
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'bot_profile') {
    const currentSettings = await getGuildSettings(interaction.guildId);

    const modal = new ModalBuilder()
      .setCustomId('fb:panel:bot_profile_mod:0')
      .setTitle('Edit Server Bot Profile');

    const nickInput = new TextInputBuilder()
      .setCustomId('bot_nick')
      .setLabel('Server Nickname / Display Name')
      .setStyle(TextInputStyle.Short)
      .setValue(currentSettings?.bot_nickname || '')
      .setPlaceholder('e.g. AVA or Server Assistant')
      .setRequired(false)
      .setMaxLength(32);

    const bioInput = new TextInputBuilder()
      .setCustomId('bot_bio')
      .setLabel('About Me / Bio')
      .setStyle(TextInputStyle.Paragraph)
      .setValue(currentSettings?.bot_bio || '')
      .setPlaceholder('Enter bot description or server info...')
      .setRequired(false)
      .setMaxLength(190);

    const iconInput = new TextInputBuilder()
      .setCustomId('bot_icon')
      .setLabel('Avatar Icon URL (PNG/JPG/WebP)')
      .setStyle(TextInputStyle.Short)
      .setValue(currentSettings?.bot_avatar_url || '')
      .setPlaceholder('https://example.com/icon.png')
      .setRequired(false)
      .setMaxLength(256);

    const bannerInput = new TextInputBuilder()
      .setCustomId('bot_banner')
      .setLabel('Banner Image URL')
      .setStyle(TextInputStyle.Short)
      .setValue(currentSettings?.bot_banner_url || '')
      .setPlaceholder('https://example.com/banner.png')
      .setRequired(false)
      .setMaxLength(256);

    modal.addComponents(
      new ActionRowBuilder().addComponents(nickInput),
      new ActionRowBuilder().addComponents(bioInput),
      new ActionRowBuilder().addComponents(iconInput),
      new ActionRowBuilder().addComponents(bannerInput)
    );
    return interaction.showModal(modal);
  }

  if (action === 'bot_profile_mod') {
    const rawNick = interaction.fields.getTextInputValue('bot_nick')?.trim() || '';
    const rawBio = interaction.fields.getTextInputValue('bot_bio')?.trim() || '';
    const rawIcon = interaction.fields.getTextInputValue('bot_icon')?.trim() || '';
    const rawBanner = interaction.fields.getTextInputValue('bot_banner')?.trim() || '';

    const me = interaction.guild?.members?.me;
    const editPayload = {
      reason: `Bot profile updated via Staff Panel by ${interaction.user.tag}`
    };
    const dbUpdates = {
      bot_nickname: rawNick || null,
      bot_bio: rawBio || null,
      bot_avatar_url: rawIcon || null,
      bot_banner_url: rawBanner || null
    };

    if (rawNick !== '') editPayload.nick = rawNick;
    else editPayload.nick = null;

    if (rawBio !== '') editPayload.bio = rawBio;
    else editPayload.bio = null;

    if (rawIcon) editPayload.avatar = rawIcon;
    else editPayload.avatar = null;

    if (rawBanner) editPayload.banner = rawBanner;
    else editPayload.banner = null;

    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe(editPayload);
      } else if (me?.setNickname && editPayload.nick !== undefined) {
        await me.setNickname(editPayload.nick, editPayload.reason);
      }
    } catch (err) {
      logger.warn({ err, guildId: interaction.guildId }, 'Error updating Discord guild member bot profile via editMe');
    }

    await updateGuildSettings(interaction.guildId, dbUpdates);
    await interaction.deferUpdate().catch(() => {});
    const payload = await renderStaffPanel({
      guild: interaction.guild,
      activeTab: 'settings'
    });
    return safeUpdatePanel(interaction, payload);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. COMPONENT BUILDER ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeComponentBuilderInteraction(interaction, action, id) {
  if (action === 'modal') {
    const isAuthorized = await checkStaffPermission(interaction);
    if (!isAuthorized) {
      return interaction.reply({
        content: '⛔ You need Manage Server permission or Staff role to publish components.',
        flags: MessageFlags.Ephemeral
      });
    }

    const title = interaction.fields.getTextInputValue('cb_title')?.trim();
    const body = interaction.fields.getTextInputValue('cb_body')?.trim();
    const thumb = interaction.fields.getTextInputValue('cb_thumb')?.trim();
    const img = interaction.fields.getTextInputValue('cb_img')?.trim();
    const btnRaw = interaction.fields.getTextInputValue('cb_btn')?.trim();

    const targetChannel = interaction.guild?.channels?.cache?.get(id) || interaction.channel;
    if (!targetChannel || !targetChannel.isTextBased()) {
      return interaction.reply({
        content: '❌ Target channel was not found or is not a text channel.',
        flags: MessageFlags.Ephemeral
      });
    }

    const builder = new ComponentBuilder();
    if (title) builder.setTitle(title);
    if (body) {
      if (title) builder.addSeparator();
      builder.addText(body);
    }
    if (thumb) builder.setThumbnail(thumb);
    if (img) builder.addMediaGallery(img);
    if (btnRaw && btnRaw.includes('|')) {
      const [label, url] = btnRaw.split('|').map(s => s.trim());
      if (label && url && (url.startsWith('http://') || url.startsWith('https://'))) {
        builder.addButton({ label, url });
      }
    }

    const payload = builder.build();
    await targetChannel.send(payload);

    return interaction.reply({
      content: `✅ **Component Published!** Successfully sent to <#${targetChannel.id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. BOT PROFILE INTERACTIVE PANEL ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeBotProfileInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Server permission or Staff role to customize the bot profile.',
      flags: MessageFlags.Ephemeral
    });
  }

  const currentSettings = await getGuildSettings(interaction.guildId);

  // ── 1. MODAL OPENERS ──
  if (action === 'nick') {
    return interaction.showModal(buildNicknameModal(currentSettings?.bot_nickname));
  }

  if (action === 'bio') {
    return interaction.showModal(buildBioModal(currentSettings?.bot_bio));
  }

  if (action === 'avatar') {
    return interaction.showModal(buildAvatarModal(currentSettings?.bot_avatar_url));
  }

  if (action === 'banner') {
    return interaction.showModal(buildBannerModal(currentSettings?.bot_banner_url));
  }

  if (action === 'edit_all') {
    return interaction.showModal(buildAllProfileModal({
      nick: currentSettings?.bot_nickname,
      bio: currentSettings?.bot_bio,
      avatar: currentSettings?.bot_avatar_url,
      banner: currentSettings?.bot_banner_url
    }));
  }

  // ── 2. RESET PROFILE TO DEFAULT ──
  if (action === 'reset') {
    await interaction.deferUpdate().catch(() => {});
    const me = interaction.guild?.members?.me;
    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe({
          nick: null,
          avatar: null,
          banner: null,
          bio: null,
          reason: `Reset bot profile by ${interaction.user.tag}`
        }).catch(() => {});
      } else if (me?.setNickname) {
        await me.setNickname(null).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, 'Error resetting bot profile via editMe');
    }

    const clearedSettings = {
      bot_nickname: null,
      bot_avatar_url: null,
      bot_banner_url: null,
      bot_bio: null
    };
    await updateGuildSettings(interaction.guildId, clearedSettings);

    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: clearedSettings,
      note: 'Default profile restored.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  // ── 3. REFRESH PANEL ──
  if (action === 'refresh') {
    await interaction.deferUpdate().catch(() => {});
    const latestSettings = await getGuildSettings(interaction.guildId);
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: latestSettings,
      note: 'Panel refreshed.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  // ── 4. MODAL SUBMISSIONS ──
  const me = interaction.guild?.members?.me;

  if (action === 'nick_mod') {
    const rawNick = interaction.fields.getTextInputValue('bp_nick')?.trim() || '';
    const newNick = rawNick || null;
    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe({ nick: newNick });
      } else if (me?.setNickname) {
        await me.setNickname(newNick);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to set bot nickname via editMe');
    }

    const updated = await updateGuildSettings(interaction.guildId, { bot_nickname: newNick });
    await interaction.deferUpdate().catch(() => {});
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: updated,
      note: newNick ? `Nickname set to **${newNick}**` : 'Nickname reset to default.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'bio_mod') {
    const rawBio = interaction.fields.getTextInputValue('bp_bio')?.trim() || '';
    const newBio = rawBio || null;
    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe({ bio: newBio });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to set bot bio via editMe');
    }

    const updated = await updateGuildSettings(interaction.guildId, { bot_bio: newBio });
    await interaction.deferUpdate().catch(() => {});
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: updated,
      note: newBio ? 'About Me bio updated.' : 'About Me bio cleared.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'avatar_mod') {
    const rawAvatar = interaction.fields.getTextInputValue('bp_avatar')?.trim() || '';
    const newAvatar = rawAvatar || null;
    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe({ avatar: newAvatar });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to set bot avatar via editMe');
    }

    const updated = await updateGuildSettings(interaction.guildId, { bot_avatar_url: newAvatar });
    await interaction.deferUpdate().catch(() => {});
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: updated,
      note: newAvatar ? 'Avatar icon updated.' : 'Avatar reset to default.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'banner_mod') {
    const rawBanner = interaction.fields.getTextInputValue('bp_banner')?.trim() || '';
    const newBanner = rawBanner || null;
    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe({ banner: newBanner });
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to set bot banner via editMe');
    }

    const updated = await updateGuildSettings(interaction.guildId, { bot_banner_url: newBanner });
    await interaction.deferUpdate().catch(() => {});
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: updated,
      note: newBanner ? 'Banner updated.' : 'Banner reset to default.'
    });
    return safeUpdatePanel(interaction, payload);
  }

  if (action === 'all_mod') {
    const rawNick = interaction.fields.getTextInputValue('bp_nick')?.trim() || '';
    const rawBio = interaction.fields.getTextInputValue('bp_bio')?.trim() || '';
    const rawAvatar = interaction.fields.getTextInputValue('bp_avatar')?.trim() || '';
    const rawBanner = interaction.fields.getTextInputValue('bp_banner')?.trim() || '';

    const editPayload = {
      nick: rawNick || null,
      bio: rawBio || null,
      avatar: rawAvatar || null,
      banner: rawBanner || null
    };

    try {
      if (me && typeof interaction.guild.members.editMe === 'function') {
        await interaction.guild.members.editMe(editPayload);
      } else if (me?.setNickname && editPayload.nick !== undefined) {
        await me.setNickname(editPayload.nick);
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to set bot profile via editMe');
    }

    const dbUpdates = {
      bot_nickname: rawNick || null,
      bot_bio: rawBio || null,
      bot_avatar_url: rawAvatar || null,
      bot_banner_url: rawBanner || null
    };

    const updated = await updateGuildSettings(interaction.guildId, dbUpdates);
    await interaction.deferUpdate().catch(() => {});
    const payload = buildBotProfilePanel({
      guild: interaction.guild,
      client: interaction.client,
      currentSettings: updated,
      note: 'All profile attributes updated.'
    });
    return safeUpdatePanel(interaction, payload);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. AUTOMOD ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeAutoModInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Server permission or configured Staff role to modify AutoMod settings.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;
  const settings = await getGuildSettings(guildId);

  // 1. Protection Toggles
  if (action === 'toggle') {
    const toggleMap = {
      master: { automod_enabled: settings.automod_enabled === false },
      invites: { automod_anti_invites: !settings.automod_anti_invites },
      links: { automod_anti_links: !settings.automod_anti_links },
      spam: { automod_anti_spam: !settings.automod_anti_spam },
      mentions: { automod_anti_mentions: !settings.automod_anti_mentions },
      caps: { automod_anti_caps: !settings.automod_anti_caps },
      words: { automod_word_filter: !settings.automod_word_filter }
    };

    const update = toggleMap[id];
    if (update) {
      await updateGuildSettings(guildId, update);
    }
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 2. Action Select Menu
  if (action === 'action_sel') {
    const chosenAction = interaction.values?.[0] || 'delete';
    await updateGuildSettings(guildId, { automod_action: chosenAction });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 3. Log Channel Select Menu
  if (action === 'chan_sel') {
    const chosenChan = interaction.values?.[0] || null;
    await updateGuildSettings(guildId, { automod_log_channel_id: chosenChan });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 4. Prohibited Words Modal Trigger
  if (action === 'words_modal') {
    const modal = buildBannedWordsModal(settings.automod_banned_words || []);
    return interaction.showModal(modal);
  }

  // 5. Prohibited Words Modal Submit
  if (action === 'words_submit') {
    const rawWords = interaction.fields.getTextInputValue('words_list') || '';
    const parsedWords = rawWords
      .split(/[,\n]+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 0);

    await updateGuildSettings(guildId, {
      automod_banned_words: parsedWords,
      automod_word_filter: parsedWords.length > 0
    });

    return interaction.reply({
      content: `✅ Prohibited word list updated with **${parsedWords.length}** phrase(s).`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 6. Exception Role Select Menu
  if (action === 'except_role') {
    const chosenRoles = interaction.values || [];
    await updateGuildSettings(guildId, {
      automod_ignored_role_ids: chosenRoles,
      automod_exception_role_id: chosenRoles[0] || null
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 7. Clear Exception Roles
  if (action === 'clear_except') {
    await updateGuildSettings(guildId, {
      automod_ignored_role_ids: [],
      automod_exception_role_id: null
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 8. Reset Defaults
  if (action === 'reset') {
    await updateGuildSettings(guildId, {
      automod_enabled: true,
      automod_anti_invites: false,
      automod_anti_links: false,
      automod_anti_spam: false,
      automod_anti_mentions: false,
      automod_anti_caps: false,
      automod_word_filter: false,
      automod_action: 'delete',
      automod_exception_role_id: null,
      automod_ignored_role_ids: []
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }

  // 9. Refresh Panel
  if (action === 'refresh') {
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoModPanel(updated, interaction.guild));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BOOST TRACKER & AUTO-ROLE ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeBoostInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Server permission or configured Staff role to modify Boost settings.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;
  const settings = await getGuildSettings(guildId);

  // 1. Role Select Menu for Booster Perk Role
  if (action === 'role_sel') {
    const chosenRole = interaction.values?.[0] || null;
    await updateGuildSettings(guildId, { boost_role_id: chosenRole, boost_auto_role_enabled: true });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }

  // 2. Channel Select Menu for Boost Announcement Channel
  if (action === 'chan_sel') {
    const chosenChan = interaction.values?.[0] || null;
    await updateGuildSettings(guildId, { boost_channel_id: chosenChan });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }

  // 3. Toggle Tracking
  if (action === 'toggle_track') {
    const newState = settings.boost_tracking_enabled === false;
    await updateGuildSettings(guildId, { boost_tracking_enabled: newState });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }

  // 4. Toggle Auto-Role
  if (action === 'toggle_role') {
    const newState = settings.boost_auto_role_enabled === false;
    await updateGuildSettings(guildId, { boost_auto_role_enabled: newState });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }

  // 5. Clear Booster Role
  if (action === 'clear_role') {
    await updateGuildSettings(guildId, { boost_role_id: null });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }

  // 6. Custom Boost Message Modal
  if (action === 'edit_msg') {
    const modal = buildBoostMessageModal(settings.boost_message);
    return interaction.showModal(modal);
  }

  // 7. Custom Boost Message Submit
  if (action === 'msg_submit') {
    const newMsg = interaction.fields.getTextInputValue('boost_text')?.trim() || '';
    await updateGuildSettings(guildId, { boost_message: newMsg });
    return interaction.reply({
      content: '✅ Custom boost celebration message updated successfully.',
      flags: MessageFlags.Ephemeral
    });
  }

  // 8. Test Celebration Card
  if (action === 'test') {
    const testCard = buildBoostCelebrationCard({
      member: interaction.member,
      guild: interaction.guild,
      boostCount: (interaction.guild.premiumSubscriptionCount || 0) + 1,
      tier: interaction.guild.premiumTier || 1,
      customMessage: settings.boost_message
    });

    const targetChanId = settings.boost_channel_id || interaction.channelId;
    const targetChan = interaction.guild.channels.cache.get(targetChanId);
    if (targetChan && targetChan.isTextBased?.()) {
      await targetChan.send(testCard).catch(() => {});
      return interaction.reply({
        content: `🎉 Test boost celebration card dispatched to <#${targetChan.id}>!`,
        flags: MessageFlags.Ephemeral
      });
    }

    return interaction.reply({
      ...testCard,
      flags: MessageFlags.Ephemeral
    });
  }

  // 9. Refresh Panel
  if (action === 'refresh') {
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildBoostPanel(updated, interaction.guild));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. STICKY NOTES ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeStickyInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Messages or Manage Server permission to configure Sticky Notes.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;

  // 1. Channel Selection
  if (action === 'chan_sel') {
    const channelId = interaction.values?.[0] || null;
    const activeNotes = await getAllStickyNotes(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyPanel(interaction.guild, activeNotes, channelId));
  }

  // 2. Edit Modal Open
  if (action === 'edit_modal') {
    if (!id || id === 'none') {
      return interaction.reply({ content: '⚠️ Please select a channel from the menu first.', flags: MessageFlags.Ephemeral });
    }
    const note = await getStickyNote(id);
    const modal = buildStickyNoteModal(id, note?.content || '');
    return interaction.showModal(modal);
  }

  // 3. Modal Submit
  if (action === 'submit') {
    const content = interaction.fields.getTextInputValue('sticky_content')?.trim();
    await setStickyNote(guildId, id, content);
    return interaction.reply({
      content: `✅ Sticky note configured for <#${id}>! It will automatically stay pinned at the bottom of the channel.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // 4. Toggle Active / Paused
  if (action === 'toggle') {
    if (!id || id === 'none') return;
    await toggleStickyNote(id);
    const activeNotes = await getAllStickyNotes(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyPanel(interaction.guild, activeNotes, id));
  }

  // 5. Delete Sticky Note
  if (action === 'delete') {
    if (!id || id === 'none') return;
    await deleteStickyNote(id);
    const activeNotes = await getAllStickyNotes(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyPanel(interaction.guild, activeNotes, null));
  }

  // 6. Refresh
  if (action === 'refresh') {
    const activeNotes = await getAllStickyNotes(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyPanel(interaction.guild, activeNotes, null));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. STICKY ROLES ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeStickyRolesInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Roles or Manage Server permission to configure Sticky Roles.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;

  // 1. Role Selection Menu
  if (action === 'role_sel') {
    const chosenRoles = interaction.values || [];
    await updateGuildSettings(guildId, {
      sticky_role_ids: chosenRoles,
      sticky_all_roles: chosenRoles.length === 0
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyRolesPanel(updated, interaction.guild));
  }

  // 2. Toggle System
  if (action === 'toggle') {
    const settings = await getGuildSettings(guildId);
    await updateGuildSettings(guildId, { sticky_roles_enabled: settings.sticky_roles_enabled === false });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyRolesPanel(updated, interaction.guild));
  }

  // 3. Toggle Mode (All Roles vs Whitelist)
  if (action === 'mode') {
    const settings = await getGuildSettings(guildId);
    await updateGuildSettings(guildId, { sticky_all_roles: settings.sticky_all_roles === false });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyRolesPanel(updated, interaction.guild));
  }

  // 4. Clear Whitelist
  if (action === 'clear') {
    await updateGuildSettings(guildId, { sticky_role_ids: [], sticky_all_roles: true });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyRolesPanel(updated, interaction.guild));
  }

  // 5. Refresh
  if (action === 'refresh') {
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildStickyRolesPanel(updated, interaction.guild));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. AUTO-ROLE ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeAutoRoleInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Roles or Manage Server permission to configure Auto-Roles.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;

  // 1. Member Role Selection (Multi-role merge)
  if (action === 'mem_sel') {
    const pickedRoles = interaction.values || [];
    const settings = await getGuildSettings(guildId);
    const existing = Array.isArray(settings.autorole_member_role_ids) ? settings.autorole_member_role_ids : (settings.autorole_member_role_id ? [settings.autorole_member_role_id] : []);
    const merged = Array.from(new Set([...existing, ...pickedRoles]));

    await updateGuildSettings(guildId, {
      autorole_member_role_ids: merged,
      autorole_member_role_id: merged[0] || null,
      autorole_enabled: true
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 1.1 Remove single member role
  if (action === 'mem_rem') {
    const toRemove = interaction.values?.[0];
    const settings = await getGuildSettings(guildId);
    const existing = Array.isArray(settings.autorole_member_role_ids) ? settings.autorole_member_role_ids : (settings.autorole_member_role_id ? [settings.autorole_member_role_id] : []);
    const filtered = existing.filter(id => id !== toRemove);

    await updateGuildSettings(guildId, {
      autorole_member_role_ids: filtered,
      autorole_member_role_id: filtered[0] || null
    });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 2. Bot Role Selection
  if (action === 'bot_sel') {
    const chosenRole = interaction.values?.[0] || null;
    await updateGuildSettings(guildId, { autorole_bot_role_id: chosenRole, autorole_enabled: true });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 3. Toggle System
  if (action === 'toggle') {
    const settings = await getGuildSettings(guildId);
    await updateGuildSettings(guildId, { autorole_enabled: settings.autorole_enabled === false });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 4. Clear Member Roles
  if (action === 'clear_mem') {
    await updateGuildSettings(guildId, { autorole_member_role_ids: [], autorole_member_role_id: null });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 5. Clear Bot Role
  if (action === 'clear_bot') {
    await updateGuildSettings(guildId, { autorole_bot_role_id: null });
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }

  // 6. Refresh
  if (action === 'refresh') {
    const updated = await getGuildSettings(guildId);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, buildAutoRolePanel(updated, interaction.guild));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. SERVER LOGS ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function routeLogsInteraction(interaction, action, id) {
  const isAuthorized = await checkStaffPermission(interaction);
  if (!isAuthorized) {
    return interaction.reply({
      content: '⛔ You need Manage Server permission to configure Server Logs.',
      flags: MessageFlags.Ephemeral
    });
  }

  const guildId = interaction.guildId;

  // 1. Set Global Log Channel
  if (action === 'set_global_chan' || action === 'set_chan') {
    const chosenChan = interaction.values?.[0] || null;
    await updateLogConfig(guildId, { globalChannelId: chosenChan, enabled: Boolean(chosenChan) });
    const panel = await buildLogsPanel(interaction.guild);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, panel);
  }

  // 2. Toggle Master Logging
  if (action === 'toggle_master') {
    const current = await getLogConfig(guildId);
    await updateLogConfig(guildId, { enabled: !current.enabled });
    const panel = await buildLogsPanel(interaction.guild);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, panel);
  }

  // 3. Toggle Category
  if (action === 'toggle_cat') {
    const category = interaction.values?.[0];
    if (category) {
      const current = await getLogConfig(guildId);
      const isCatActive = current.categories[category] !== false;
      await updateLogConfig(guildId, {
        categories: { [category]: !isCatActive }
      });
    }
    const panel = await buildLogsPanel(interaction.guild);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, panel);
  }

  // 4. Send Test Log
  if (action === 'test') {
    const testCard = buildLogCard({
      eventName: 'Test Server Log',
      emoji: '🔔',
      category: 'server',
      user: interaction.user,
      targetId: interaction.guildId,
      details: [
        format.kvLine('Logging Status', '🟢 Connected & Fully Operational'),
        format.kvLine('Triggered By', format.userMention(interaction.user.id)),
        format.kvLine('Status', 'Operational')
      ]
    });

    await dispatchLog(interaction.guild, { category: 'server', cardPayload: testCard });
    return interaction.reply({
      content: '🔔 Test log successfully dispatched to your configured log channel!',
      flags: MessageFlags.Ephemeral
    });
  }

  // 5. Refresh
  if (action === 'refresh') {
    const panel = await buildLogsPanel(interaction.guild);
    await interaction.deferUpdate().catch(() => {});
    return safeUpdatePanel(interaction, panel);
  }
}

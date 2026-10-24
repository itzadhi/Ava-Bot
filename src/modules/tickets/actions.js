import {
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { errorCard, successCard, confirmCard } from '../../ui/cards.js';
import { container } from '../../utils/ui/components.js';
import {
  getTicketById,
  getTicketByChannel,
  recoverTicketFromChannel,
  updateTicket,
  getTicketSettings,
  getTicketCategory,
  addTicketNote
} from '../../db/tickets.js';
import { getGuildRoles } from '../../db/permify.js';
import { refreshTicketControlCard } from './controls.js';
import { sendTicketLog } from './logs.js';
import { generateAndSaveTranscript } from './transcript.js';
import { sendRatingPrompt } from './ratings.js';
import { logger } from '../../utils/logger.js';
import { perm } from '../../core/permissions/permApply.js';

/**
 * Checks if a member has staff or administration permissions for a ticket
 */
export async function isTicketStaff(member, ticket, settings = null) {
  if (!member) return false;
  if (
    member.id === member.guild?.ownerId ||
    member.permissions?.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.permissions?.has(PermissionFlagsBits.ManageChannels)
  ) {
    return true;
  }

  const s = settings || (await getTicketSettings(member.guild?.id));
  const staffRoles = new Set([
    ...(s?.support_role_ids || []),
    ...(s?.admin_role_ids || [])
  ]);

  if (ticket?.category_id) {
    const cat = await getTicketCategory(ticket.category_id);
    if (cat?.support_role_ids) {
      for (const r of cat.support_role_ids) staffRoles.add(r);
    }
  }

  const permifyRoles = await getGuildRoles(member.guild?.id).catch(() => null);
  if (permifyRoles?.staff) {
    for (const r of permifyRoles.staff) staffRoles.add(r);
  }
  if (permifyRoles?.owner) {
    for (const r of permifyRoles.owner) staffRoles.add(r);
  }

  return staffRoles.size > 0 && member.roles?.cache?.some(r => staffRoles.has(r.id));
}

/**
 * Universal helper to resolve ticket context, member, and channel across interactions and command options
 */
async function resolveTicketAndChannel(target, ticketIdOrOptions) {
  let member, user, guild, ticket, channel, isOptionsCall = false;

  if (target && target.ticket) {
    isOptionsCall = true;
    ticket = target.ticket;
    member = target.member;
    user = member?.user || member;
    guild = member?.guild;
    channel = target.channel || guild?.channels?.cache?.get(ticket?.channel_id);
  } else {
    const interaction = target;
    member = interaction.member;
    user = interaction.user;
    guild = interaction.guild;
    const ticketId = ticketIdOrOptions;

    // 1. Query by ticketId and channel context
    ticket = await getTicketById(ticketId, guild?.id, interaction.channelId);

    // 2. Query by channel if not found
    if (!ticket && guild?.id && interaction.channelId) {
      ticket = await getTicketByChannel(guild.id, interaction.channelId);
    }

    // 3. Rehydrate from Discord channel if still missing or if old temp ID
    if ((!ticket || ticket.id?.startsWith('temp_')) && interaction.channel) {
      const recovered = await recoverTicketFromChannel(interaction.channel);
      if (recovered) ticket = recovered;
    }

    channel = interaction.channel || guild?.channels?.cache?.get(ticket?.channel_id);
  }

  return { member, user, guild, ticket, channel, isOptionsCall };
}

/**
 * Safe interaction reply/followUp helper
 */
async function safeReply(target, payload) {
  if (!target || typeof target.reply !== 'function') return;
  try {
    if (target.replied || target.deferred) {
      return await target.followUp(payload);
    }
    return await target.reply(payload);
  } catch (err) {
    logger.debug({ err: err.message }, 'safeReply caught error on interaction response');
  }
}

/**
 * 1. Claim or Unclaim a Ticket
 */
export async function handleClaimToggle(target, ticketIdOrOptions) {
  const { member, user, guild, ticket, channel, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);

  if (!ticket || ticket.status === 'closed') {
    if (isOptionsCall) return { success: false, error: 'Ticket is closed or no longer active.' };
    return safeReply(target, errorCard({
      title: 'Ticket Inactive',
      reason: 'This ticket is closed or no longer active.',
      ephemeral: true
    }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff) {
    if (isOptionsCall) return { success: false, error: 'Only designated support staff can claim tickets.' };
    return safeReply(target, errorCard({
      title: 'Staff Only',
      reason: 'Only designated support staff can claim tickets.',
      ephemeral: true
    }));
  }

  const isClaimedByMe = ticket.claimed_by === member.id;
  const newClaimedBy = isClaimedByMe ? null : member.id;
  const newClaimedAt = isClaimedByMe ? null : new Date().toISOString();
  const newStatus = isClaimedByMe ? 'open' : 'claimed';

  await updateTicket(ticket.id, {
    claimed_by: newClaimedBy,
    claimed_at: newClaimedAt,
    status: newStatus
  });

  if (channel) {
    await refreshTicketControlCard(channel, ticket.id).catch(() => {});
  }

  // Audit log
  sendTicketLog(guild, {
    eventTitle: isClaimedByMe ? 'Ticket Unclaimed' : 'Ticket Claimed',
    emoji: isClaimedByMe ? '↩️' : '👑',
    ticket,
    staff: member.user || member
  }).catch(() => {});

  if (isOptionsCall) {
    return { success: true, claimed: !isClaimedByMe };
  }

  return safeReply(target, successCard({
    title: isClaimedByMe ? 'Ticket Unclaimed' : 'Ticket Claimed',
    subtitle: isClaimedByMe
      ? `✋ <@${member.id}> has released the claim on **Ticket #${ticket.ticket_number}**.`
      : `👑 <@${member.id}> has claimed **Ticket #${ticket.ticket_number}**!`,
    ephemeral: false
  }));
}

/**
 * 2. Close Ticket
 */
export async function handleCloseTicket(target, ticketIdOrOptions, reason = null) {
  const { member, user, guild, ticket, channel, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);
  const closeReason = (target && target.reason) || reason || (isOptionsCall ? 'Closed via command' : 'Closed via interaction');

  if (!ticket || ticket.status === 'closed') {
    if (isOptionsCall) return { success: false, error: 'Ticket is already closed.' };
    return safeReply(target, errorCard({
      title: 'Already Closed',
      reason: 'This ticket is already closed.',
      ephemeral: true
    }));
  }

  const isOwner = ticket.owner_id === user.id;
  const isStaff = await isTicketStaff(member, ticket);

  if (!isOwner && !isStaff) {
    if (isOptionsCall) return { success: false, error: 'Only the ticket owner or staff can close this ticket.' };
    return safeReply(target, errorCard({
      title: 'Permission Denied',
      reason: 'Only the ticket owner or support staff can close this ticket.',
      ephemeral: true
    }));
  }

  if (!channel) {
    await updateTicket(ticket.id, {
      status: 'closed',
      closed_by: user.id,
      closed_at: new Date().toISOString(),
      close_reason: closeReason
    });
    if (isOptionsCall) return { success: true };
    return safeReply(target, errorCard({
      title: 'Channel Missing',
      reason: 'The ticket channel could not be found.',
      ephemeral: true
    }));
  }

  if (!isOptionsCall) {
    await safeReply(target, container({
      title: 'Closing Ticket',
      lines: [`🔒 Closing **Ticket #${ticket.ticket_number}**... Generating transcript and cleaning up.`],
      ephemeral: true
    }));
  }

  // Mark closed in database
  const closedRecord = await updateTicket(ticket.id, {
    status: 'closed',
    closed_by: user.id,
    closed_at: new Date().toISOString(),
    close_reason: closeReason
  });

  // 1. Generate & save transcript
  let transcriptResult = null;
  try {
    transcriptResult = await generateAndSaveTranscript(channel, closedRecord);
  } catch (err) {
    logger.warn({ err, ticketId: ticket.id }, 'Transcript generation error');
  }

  // 2. Audit Log Event
  sendTicketLog(guild, {
    eventTitle: 'Ticket Closed',
    emoji: '🔒',
    ticket: closedRecord,
    staff: isStaff ? user : null,
    reason: closeReason,
    extraDetails: [
      { label: 'Closed By', value: `<@${user.id}>` },
      ...(transcriptResult?.url ? [{ label: 'Transcript', value: `[View HTML Transcript](${transcriptResult.url})` }] : [])
    ]
  }).catch(() => {});

  // 3. DM Transcript & Rating Prompt to Ticket Owner
  try {
    const ownerUser = await guild.client.users.fetch(ticket.owner_id).catch(() => null);
    if (ownerUser) {
      await sendRatingPrompt(ownerUser, guild, closedRecord, transcriptResult);
    }
  } catch (_) {}

  // 4. Update control card in channel
  await refreshTicketControlCard(channel, ticket.id).catch(() => {});

  // 5. Post countdown and schedule channel auto-deletion
  const settings = await getTicketSettings(guild.id);
  const delaySec = Math.max(settings?.autodelete_delay_seconds || 10, 5);

  const countdownCard = container({
    title: 'Ticket Closed',
    lines: [
      `⏱️ Ticket closed by <@${user.id}>. This channel will automatically be deleted in **${delaySec} seconds**.`,
      ...(transcriptResult?.url ? [`📄 Transcript saved: [Click here to view transcript](${transcriptResult.url})`] : [])
    ]
  });

  await channel.send(countdownCard).catch(() => {});

  setTimeout(async () => {
    try {
      const liveChan = guild.channels.cache.get(ticket.channel_id);
      if (liveChan) {
        await liveChan.delete(`AVA Ticket #${ticket.ticket_number} Closed`).catch(() => {});
      }
    } catch (_) {}
  }, delaySec * 1000);

  return { success: true };
}

/**
 * 3. Close Request (Staff asking Owner to confirm close)
 */
export async function handleCloseRequest(interaction, ticketId) {
  const { member, guild, ticket, channel } = await resolveTicketAndChannel(interaction, ticketId);

  if (!ticket || ticket.status === 'closed') {
    return safeReply(interaction, errorCard({ title: 'Inactive Ticket', reason: 'This ticket is not active.', ephemeral: true }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff) {
    return safeReply(interaction, errorCard({ title: 'Staff Only', reason: 'Only staff can send a close request.', ephemeral: true }));
  }

  await updateTicket(ticket.id, {
    close_request_from: member.id,
    close_request_at: new Date().toISOString()
  });

  if (!channel) return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tkt:ctl:close_req_yes:${ticket.id}`)
      .setLabel('Confirm Close')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tkt:ctl:close_req_no:${ticket.id}`)
      .setLabel('Keep Open')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
  );

  const reqCard = container({
    title: 'Close Requested',
    lines: [
      `📢 <@${ticket.owner_id}>, staff member <@${member.id}> has requested to close this ticket.`,
      'Please confirm if your issue has been resolved:'
    ],
    rows: [row]
  });

  await channel.send(reqCard);

  return safeReply(interaction, container({
    title: 'Request Sent',
    lines: [`📩 Close request sent to <@${ticket.owner_id}>.`],
    ephemeral: true
  }));
}

/**
 * 4. Lock / Unlock Ticket
 */
export async function handleLockToggle(target, ticketIdOrOptions) {
  const { member, guild, ticket, channel, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);

  if (!ticket || ticket.status === 'closed') {
    if (isOptionsCall) return { success: false, error: 'Ticket is closed.' };
    return safeReply(target, errorCard({ title: 'Ticket Inactive', reason: 'This ticket is closed or no longer active.', ephemeral: true }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff) {
    if (isOptionsCall) return { success: false, error: 'Only staff can lock/unlock tickets.' };
    return safeReply(target, errorCard({ title: 'Staff Only', reason: 'Only staff can lock/unlock tickets.', ephemeral: true }));
  }

  if (!channel) {
    if (isOptionsCall) return { success: false, error: 'Channel missing.' };
    return safeReply(target, errorCard({ title: 'Channel Missing', reason: 'Ticket channel could not be found.', ephemeral: true }));
  }

  const isCurrentlyLocked = ticket.status === 'locked';
  const newStatus = isCurrentlyLocked ? (ticket.claimed_by ? 'claimed' : 'open') : 'locked';

  // Toggle channel permissions for owner
  await perm.apply({
    guildId: guild.id,
    feature: 'tickets',
    targetType: 'channel',
    targetId: channel.id,
    op: 'edit_channel_overwrite',
    field: 'permissionOverwrites',
    oldValue: channel.permissionOverwrites?.cache?.get(ticket.owner_id),
    newValue: { SendMessages: isCurrentlyLocked ? true : false },
    reason: `AVA Tickets: ${isCurrentlyLocked ? 'Unlock' : 'Lock'} ticket #${ticket.ticket_number}`,
    execute: () => channel.permissionOverwrites.edit(ticket.owner_id, {
      SendMessages: isCurrentlyLocked ? true : false
    })
  }).catch(() => {});

  await updateTicket(ticket.id, { status: newStatus });
  await refreshTicketControlCard(channel, ticket.id);

  sendTicketLog(guild, {
    eventTitle: isCurrentlyLocked ? 'Ticket Unlocked' : 'Ticket Locked',
    emoji: isCurrentlyLocked ? '🔓' : '🔐',
    ticket,
    staff: member.user || member
  }).catch(() => {});

  if (isOptionsCall) {
    return { success: true, locked: !isCurrentlyLocked };
  }

  return safeReply(target, container({
    title: isCurrentlyLocked ? 'Ticket Unlocked' : 'Ticket Locked',
    lines: [
      isCurrentlyLocked
        ? `🔓 **Ticket #${ticket.ticket_number}** has been unlocked. <@${ticket.owner_id}> can send messages.`
        : `🔐 **Ticket #${ticket.ticket_number}** has been locked. <@${ticket.owner_id}> cannot send messages.`
    ],
    ephemeral: false
  }));
}

/**
 * 5. Priority Change
 */
export async function handleChangePriority(target, ticketIdOrOptions, newPriorityArg = null) {
  const { member, guild, ticket, channel, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);
  const newPriority = (target && target.newPriority) || newPriorityArg;

  if (!ticket || ticket.status === 'closed') {
    if (isOptionsCall) return { success: false, error: 'Ticket is closed.' };
    return safeReply(target, errorCard({ title: 'Ticket Inactive', reason: 'This ticket is closed or no longer active.', ephemeral: true }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff) {
    if (isOptionsCall) return { success: false, error: 'Only staff can change ticket priority.' };
    return safeReply(target, errorCard({ title: 'Staff Only', reason: 'Only staff can change ticket priority.', ephemeral: true }));
  }

  const valid = ['low', 'normal', 'high', 'urgent'];
  if (!valid.includes(newPriority)) {
    if (isOptionsCall) return { success: false, error: 'Invalid priority level.' };
    return safeReply(target, errorCard({ title: 'Invalid Priority', reason: 'Please select a valid priority level.', ephemeral: true }));
  }

  await updateTicket(ticket.id, { priority: newPriority });

  if (channel) {
    await refreshTicketControlCard(channel, ticket.id).catch(() => {});
    await channel.setTopic(`🎫 Ticket #${ticket.ticket_number} • Owner: ${ticket.owner_username || ticket.owner_id} • Priority: ${newPriority.toUpperCase()}`).catch(() => {});
  }

  sendTicketLog(guild, {
    eventTitle: 'Priority Changed',
    emoji: '⚡',
    ticket,
    staff: member.user || member,
    extraDetails: [{ label: 'New Priority', value: `\`${newPriority.toUpperCase()}\`` }]
  }).catch(() => {});

  if (isOptionsCall) return { success: true };

  return safeReply(target, container({
    title: 'Priority Updated',
    lines: [`⚡ Priority for **Ticket #${ticket.ticket_number}** set to **${newPriority.toUpperCase()}**.`]
  }));
}

/**
 * 6. Add / Remove User
 */
export async function handleModifyUserAccess(target, ticketIdOrOptions, targetUserIdArg = null, isAddArg = true) {
  const { member, guild, ticket, channel, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);
  const targetUserId = (target && target.targetUserId) || targetUserIdArg;
  const isAdd = target && target.action !== undefined ? target.action === 'add' : (target && target.isAdd !== undefined ? target.isAdd : isAddArg);

  if (!ticket || ticket.status === 'closed') {
    if (isOptionsCall) return { success: false, error: 'Ticket is closed.' };
    return safeReply(target, errorCard({ title: 'Ticket Inactive', reason: 'This ticket is closed or no longer active.', ephemeral: true }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff && ticket.owner_id !== member.id) {
    if (isOptionsCall) return { success: false, error: 'Only staff can manage ticket participants.' };
    return safeReply(target, errorCard({ title: 'Staff Only', reason: 'Only staff can manage ticket participants.', ephemeral: true }));
  }

  if (!channel) {
    if (isOptionsCall) return { success: false, error: 'Ticket channel missing.' };
    return safeReply(target, errorCard({ title: 'Channel Missing', reason: 'Ticket channel could not be found.', ephemeral: true }));
  }

  if (isAdd) {
    await perm.apply({
      guildId: guild.id,
      feature: 'tickets',
      targetType: 'channel',
      targetId: channel.id,
      op: 'edit_channel_overwrite',
      field: 'permissionOverwrites',
      oldValue: channel.permissionOverwrites?.cache?.get(targetUserId),
      newValue: { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true },
      reason: `AVA Tickets: Add participant ${targetUserId} to ticket #${ticket.ticket_number}`,
      execute: () => channel.permissionOverwrites.edit(targetUserId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true
      })
    });
    if (isOptionsCall) return { success: true };
    return safeReply(target, container({
      title: 'Participant Added',
      lines: [`➕ Added <@${targetUserId}> to **Ticket #${ticket.ticket_number}**.`]
    }));
  } else {
    await perm.apply({
      guildId: guild.id,
      feature: 'tickets',
      targetType: 'channel',
      targetId: channel.id,
      op: 'delete_channel_overwrite',
      field: 'permissionOverwrites',
      oldValue: channel.permissionOverwrites?.cache?.get(targetUserId),
      newValue: null,
      reason: `AVA Tickets: Remove participant ${targetUserId} from ticket #${ticket.ticket_number}`,
      execute: () => channel.permissionOverwrites.delete(targetUserId)
    }).catch(() => {});
    if (isOptionsCall) return { success: true };
    return safeReply(target, container({
      title: 'Participant Removed',
      lines: [`➖ Removed <@${targetUserId}> from **Ticket #${ticket.ticket_number}**.`]
    }));
  }
}

/**
 * 7. Add Staff Note
 */
export async function handleAddStaffNote(target, ticketIdOrOptions, contentArg = null) {
  const { member, guild, ticket, isOptionsCall } = await resolveTicketAndChannel(target, ticketIdOrOptions);
  const content = (target && target.noteContent) || contentArg;

  if (!ticket) {
    if (isOptionsCall) return { success: false, error: 'Ticket not found.' };
    return safeReply(target, errorCard({ title: 'Ticket Not Found', reason: 'The ticket record could not be found.', ephemeral: true }));
  }

  const isStaff = await isTicketStaff(member, ticket);
  if (!isStaff) {
    if (isOptionsCall) return { success: false, error: 'Only staff can add internal notes.' };
    return safeReply(target, errorCard({ title: 'Staff Only', reason: 'Only staff can add internal notes.', ephemeral: true }));
  }

  await addTicketNote(ticket.id, guild.id, member.id, member.user?.tag || member.user?.username || member.id, content);

  if (isOptionsCall) return { success: true };

  return safeReply(target, container({
    title: 'Internal Staff Note Added',
    lines: [
      `📝 Saved to **Ticket #${ticket.ticket_number}**:`,
      format.quote(content)
    ],
    ephemeral: true
  }));
}

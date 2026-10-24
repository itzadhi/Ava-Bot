import {
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { errorCard, successCard } from '../../ui/cards.js';
import {
  getTicketSettings,
  getTicketCategory,
  getCategoryQuestions,
  getUserOpenTickets,
  getNextTicketNumber,
  createTicket,
  updateTicket,
  isBlacklisted
} from '../../db/tickets.js';
import { getGuildRoles } from '../../db/permify.js';
import { checkCategoryAccess } from './categories.js';
import { buildTicketControlCard } from './controls.js';
import { sendTicketLog } from './logs.js';
import { logger } from '../../utils/logger.js';
import { perm } from '../../core/permissions/permApply.js';

// In-memory user cooldowns (cooldown_seconds)
const userCooldowns = new Map();

/**
 * Builds the mandatory Ticket Reason modal (with any optional category custom questions appended)
 */
export async function buildOpenTicketReasonModal(categoryOrId, panelId = '0') {
  let category = null;
  let categoryId = 'default';

  if (categoryOrId) {
    if (typeof categoryOrId === 'object') {
      category = categoryOrId;
      categoryId = category.id || 'default';
    } else if (categoryOrId !== 'default') {
      categoryId = categoryOrId;
      category = await getTicketCategory(categoryId).catch(() => null);
    }
  }

  const catTitle = category?.name ? `${category.name.slice(0, 30)} Ticket` : 'Open Ticket';

  const modal = new ModalBuilder()
    .setCustomId(`tkt:modal_open:${categoryId}:${panelId}`)
    .setTitle(catTitle.slice(0, 45));

  // 1. Mandatory Reason field
  const reasonInput = new TextInputBuilder()
    .setCustomId('ticket_reason')
    .setLabel('Reason for opening ticket *')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Describe your issue or what you need assistance with...')
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

  // 2. Additional category questions if configured (up to 4 more)
  if (category?.id) {
    const questions = await getCategoryQuestions(category.id).catch(() => []);
    for (let i = 0; i < Math.min(questions.length, 4); i++) {
      const q = questions[i];
      const qInput = new TextInputBuilder()
        .setCustomId(`q_${i}`)
        .setLabel(q.label.slice(0, 45))
        .setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
        .setRequired(q.required !== false)
        .setMinLength(q.min_length || 0)
        .setMaxLength(Math.min(q.max_length || 1000, 1000));

      if (q.placeholder) {
        qInput.setPlaceholder(q.placeholder.slice(0, 100));
      }

      modal.addComponents(new ActionRowBuilder().addComponents(qInput));
    }
  }

  return modal;
}

export const buildTicketQuestionsModal = buildOpenTicketReasonModal;

/**
 * Validates pre-flight requirements and opens a ticket channel
 */
export async function handleOpenTicketFlow({
  interaction,
  categoryId,
  panelId = '0',
  questionAnswers = {},
  reason = null
}) {
  const guild = interaction.guild;
  const member = interaction.member;
  const user = interaction.user;

  if (!guild || !member) {
    return interaction.reply(errorCard({
      title: 'Server Only',
      reason: 'Tickets can only be opened inside a Discord server.',
      ephemeral: true
    }));
  }

  // 1. Fetch settings and category
  const [settings, category] = await Promise.all([
    getTicketSettings(guild.id),
    categoryId && categoryId !== 'default' ? getTicketCategory(categoryId) : null
  ]);

  if (!settings.enabled) {
    return interaction.reply(errorCard({
      title: 'Ticket System Disabled',
      reason: 'The ticket system is currently disabled on this server.',
      fix: 'Contact server administration for assistance.',
      ephemeral: true
    }));
  }

  // 2. Blacklist Check
  const memberRoleIds = Array.from(member.roles.cache.keys());
  const blacklisted = await isBlacklisted(guild.id, user.id, memberRoleIds);
  if (blacklisted.blacklisted) {
    return interaction.reply(errorCard({
      title: 'Access Denied',
      reason: `You are blacklisted from opening tickets in this server.`,
      fix: `Reason: ${blacklisted.reason}`,
      ephemeral: true
    }));
  }

  // 3. User Cooldown Check
  const cdSeconds = settings.cooldown_seconds || 30;
  const cdKey = `${guild.id}:${user.id}`;
  const lastOpened = userCooldowns.get(cdKey);
  if (lastOpened && (Date.now() - lastOpened) < cdSeconds * 1000) {
    const remaining = Math.ceil((cdSeconds * 1000 - (Date.now() - lastOpened)) / 1000);
    return interaction.reply(errorCard({
      title: 'Cooldown Active',
      reason: `Please wait **${remaining}s** before opening another ticket.`,
      ephemeral: true
    }));
  }

  // 4. Role Access Verification for Category
  if (category) {
    const access = checkCategoryAccess(member, category);
    if (!access.allowed) {
      return interaction.reply(errorCard({
        title: 'Category Restricted',
        reason: access.reason,
        ephemeral: true
      }));
    }
  }

  // 5. Open Ticket Limits Check (Global & Category)
  const userOpenTickets = await getUserOpenTickets(guild.id, user.id);
  const maxGlobal = settings.max_open_per_user || 3;
  if (userOpenTickets.length >= maxGlobal) {
    return interaction.reply(errorCard({
      title: 'Ticket Limit Reached',
      reason: `You already have **${userOpenTickets.length}** open tickets (Server limit is **${maxGlobal}**).`,
      fix: 'Please close an active ticket before opening a new one.',
      ephemeral: true
    }));
  }

  if (category) {
    const catTickets = userOpenTickets.filter(t => t.category_id === category.id);
    const maxCat = category.max_open_per_user || 1;
    if (catTickets.length >= maxCat) {
      return interaction.reply(errorCard({
        title: 'Category Limit Reached',
        reason: `You already have an open ticket in **${category.name}**.`,
        fix: 'Please use your existing ticket in this category.',
        ephemeral: true
      }));
    }
  }

  // 6. Check Bot Permissions
  const me = guild.members.me;
  if (!me) {
    return interaction.reply(errorCard({
      title: 'Bot Initialization Error',
      reason: 'Could not resolve bot member permissions.',
      ephemeral: true
    }));
  }

  const requiredPerms = [
    [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
    [PermissionFlagsBits.ViewChannel, 'View Channels'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.AttachFiles, 'Attach Files'],
    [PermissionFlagsBits.ReadMessageHistory, 'Read Message History']
  ];

  const missing = requiredPerms.filter(([flag]) => !me.permissions.has(flag)).map(([, name]) => `\`${name}\``);
  if (missing.length > 0) {
    return interaction.reply(errorCard({
      title: 'Bot Missing Permissions',
      reason: `I am missing required server permissions to create tickets: ${missing.join(', ')}.`,
      fix: 'Please ask an administrator to grant the bot these permissions.',
      ephemeral: true
    }));
  }

  // 7. Check if Reason/Form was already provided
  if (!reason && Object.keys(questionAnswers).length === 0) {
    const modal = await buildOpenTicketReasonModal(category || categoryId, panelId);
    return interaction.showModal(modal);
  }

  if (reason && !questionAnswers['Reason']) {
    questionAnswers['Reason'] = reason;
  }

  // Defer ephemeral response while creating channel
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  // 8. Generate Ticket Number & Format Channel Name
  const ticketNumber = await getNextTicketNumber(guild.id);
  const paddedNumber = String(ticketNumber).padStart(4, '0');
  const catName = category?.name || 'Support';

  const nameTemplate = category?.name_format || settings.name_format || 'ticket-{number}';
  const cleanUsername = user.username.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 15) || 'user';
  const channelName = nameTemplate
    .replace(/\{number\}/gi, paddedNumber)
    .replace(/\{username\}/gi, cleanUsername)
    .replace(/\{category\}/gi, catName.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
    .slice(0, 95);

  // 9. Configure Permission Overwrites
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions
      ]
    },
    {
      id: me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  // Grant support roles access
  const supportRoles = new Set([
    ...(settings.support_role_ids || []),
    ...(settings.admin_role_ids || []),
    ...(category?.support_role_ids || [])
  ]);

  for (const roleId of supportRoles) {
    const role = guild.roles.cache.get(roleId);
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks
        ]
      });
    }
  }

  // Deny regular member roles access so they cannot see private tickets
  const guildRoles = await getGuildRoles(guild.id).catch(() => ({ member: [] }));
  for (const roleId of guildRoles.member || []) {
    if (!supportRoles.has(roleId)) {
      overwrites.push({
        id: roleId,
        deny: [PermissionFlagsBits.ViewChannel]
      });
    }
  }

  // Determine parent category channel
  let parentCategory = null;
  const targetParentId = category?.channel_category_id || settings.channel_category_id;
  if (targetParentId) {
    const parentChannel = guild.channels.cache.get(targetParentId);
    if (parentChannel && parentChannel.type === ChannelType.GuildCategory) {
      if (parentChannel.children.cache.size < 50) {
        parentCategory = parentChannel.id;
      }
    }
  }

  // 10. Create Discord Channel
  let ticketChannel;
  try {
    const permRes = await perm.apply({
      guildId: guild.id,
      feature: 'tickets',
      targetType: 'channel',
      targetId: 'new',
      op: 'create_channel_with_overwrites',
      field: 'permissionOverwrites',
      oldValue: null,
      newValue: overwrites,
      reason: `AVA Tickets: Create ticket #${ticketNumber} channel`,
      execute: () => guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentCategory,
        permissionOverwrites: overwrites,
        topic: `🎫 Ticket #${ticketNumber} • Owner: ${user.tag} (${user.id}) • Category: ${catName}`
      })
    });
    if (!permRes.executed || !permRes.result) {
      return interaction.editReply(errorCard({
        title: 'Permission Writes Disabled',
        reason: 'Ticket channel creation is currently paused by the server administrator (PERMISSION_WRITES=off).',
        ephemeral: true
      }));
    }
    ticketChannel = permRes.result;
  } catch (err) {
    logger.error({ err, guildId: guild.id, userId: user.id }, 'Failed to create ticket text channel');
    return interaction.editReply(errorCard({
      title: 'Channel Creation Failed',
      reason: `Discord could not create the channel: ${err.message}`,
      fix: 'Verify the category does not exceed 50 channels and bot has Manage Channels.',
      ephemeral: true
    }));
  }

  // Record cooldown
  userCooldowns.set(cdKey, Date.now());

  // 11. Persist to Database FIRST to establish permanent ticket record
  const createdRecord = await createTicket({
    guildId: guild.id,
    channelId: ticketChannel.id,
    ticketNumber,
    categoryId: category?.id || null,
    categoryName: catName,
    ownerId: user.id,
    ownerUsername: user.tag || user.username,
    questionAnswers
  });

  // 12. Post In-Ticket Welcome Card (Pure Components V2 with real permanent ticket ID)
  const welcomePayload = buildTicketControlCard({
    ticket: createdRecord,
    category,
    welcomeText: category?.welcome_template || settings.welcome_message
  });

  // Role & owner notification ping: send clean transient ping to trigger Discord push notification without corrupting V2 payload
  const pingMentions = [];
  if (category?.ping_role_ids && category.ping_role_ids.length > 0) {
    for (const rId of category.ping_role_ids) {
      if (guild.roles.cache.has(rId)) {
        pingMentions.push(`<@&${rId}>`);
      }
    }
  }

  const pingTargets = [...pingMentions, `<@${user.id}>`].filter(Boolean);
  if (pingTargets.length > 0) {
    try {
      const pingMsg = await ticketChannel.send({
        content: pingTargets.join(' '),
        allowedMentions: {
          users: [user.id],
          roles: category?.ping_role_ids || []
        }
      });
      if (pingMsg?.deletable) {
        await pingMsg.delete().catch(() => {});
      }
    } catch (_) {}
  }

  let controlMsg = null;
  try {
    controlMsg = await ticketChannel.send(welcomePayload);
    if (controlMsg) {
      await updateTicket(createdRecord.id, { control_message_id: controlMsg.id });
      createdRecord.control_message_id = controlMsg.id;
    }
  } catch (err) {
    logger.warn({ err, channelId: ticketChannel.id }, 'Failed to post ticket welcome card');
  }

  // 13. Send user's opening reason message using user's profile pic and display name (Webhook relay)
  const userReason = reason || questionAnswers['Reason'] || questionAnswers['reason'] || null;
  if (userReason && userReason.trim()) {
    try {
      const avatarURL = typeof user.displayAvatarURL === 'function'
        ? user.displayAvatarURL({ extension: 'png', size: 256 })
        : (user.avatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png');
      const displayName = member.displayName || user.displayName || user.username;

      let webhook = null;
      try {
        webhook = await ticketChannel.createWebhook({
          name: 'Ticket User Relay',
          avatar: avatarURL
        });
      } catch (whErr) {
        logger.debug({ err: whErr.message }, 'Could not create ticket relay webhook');
      }

      if (webhook) {
        await webhook.send({
          content: userReason.trim(),
          username: displayName,
          avatarURL: avatarURL
        });
        await webhook.delete('AVA temporary ticket relay').catch(() => {});
      } else {
        // Fallback if bot lacks ManageWebhooks
        await ticketChannel.send({
          content: `> **${format.escapeMarkdown(displayName)}**: ${format.escapeMarkdown(userReason.trim())}`
        }).catch(() => {});
      }
    } catch (relayErr) {
      logger.warn({ err: relayErr.message }, 'Failed to relay user reason in ticket channel');
    }
  }

  // 14. Audit Log Event
  sendTicketLog(guild, {
    eventTitle: 'Ticket Opened',
    emoji: '🎫',
    ticket: createdRecord,
    user,
    extraDetails: [
      { label: 'Category', value: `\`${catName}\`` },
      { label: 'Channel', value: `<#${ticketChannel.id}>` }
    ]
  }).catch(() => {});

  // 14. Reply to user with Link Button inside container (Pure Components V2)
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Go to Ticket')
      .setURL(`https://discord.com/channels/${guild.id}/${ticketChannel.id}`)
      .setStyle(ButtonStyle.Link)
  );

  return interaction.editReply(
    successCard({
      title: 'Ticket Created',
      subtitle: `Your ticket has been opened in <#${ticketChannel.id}>.`,
      body: `**Ticket:** \`#${ticketNumber}\` · **Category:** \`${catName}\``,
      rows: [linkRow],
      ephemeral: true
    })
  );
}

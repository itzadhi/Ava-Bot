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
import { checkCategoryAccess } from './categories.js';
import { buildTicketControlCard } from './controls.js';
import { sendTicketLog } from './logs.js';
import { logger } from '../../utils/logger.js';

// In-memory user cooldowns (cooldown_seconds)
const userCooldowns = new Map();

/**
 * Builds a Modal for category custom questions
 */
export async function buildTicketQuestionsModal(category, panelId = '0') {
  const questions = await getCategoryQuestions(category.id);
  const modal = new ModalBuilder()
    .setCustomId(`tkt:modal_open:${category.id}:${panelId}`)
    .setTitle(`${category.name.slice(0, 40)} Form`);

  for (let i = 0; i < Math.min(questions.length, 5); i++) {
    const q = questions[i];
    const input = new TextInputBuilder()
      .setCustomId(`q_${i}`)
      .setLabel(q.label.slice(0, 45))
      .setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setRequired(q.required !== false)
      .setMinLength(q.min_length || 0)
      .setMaxLength(Math.min(q.max_length || 1000, 1000));

    if (q.placeholder) {
      input.setPlaceholder(q.placeholder.slice(0, 100));
    }

    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }

  return modal;
}

/**
 * Validates pre-flight requirements and opens a ticket channel
 */
export async function handleOpenTicketFlow({
  interaction,
  categoryId,
  panelId = '0',
  questionAnswers = {}
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

  // 7. Check if Category has Questions and this wasn't from a Modal Submission
  if (category && Object.keys(questionAnswers).length === 0) {
    const questions = await getCategoryQuestions(category.id);
    if (questions.length > 0) {
      const modal = await buildTicketQuestionsModal(category, panelId);
      return interaction.showModal(modal);
    }
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
    ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentCategory,
      permissionOverwrites: overwrites,
      topic: `🎫 Ticket #${ticketNumber} • Owner: ${user.tag} (${user.id}) • Category: ${catName}`
    });
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

  // 11. Post Welcome Card into the Ticket Channel
  const placeholderTicket = {
    id: `temp_${Date.now()}`,
    guild_id: guild.id,
    channel_id: ticketChannel.id,
    ticket_number: ticketNumber,
    category_id: category?.id || null,
    category_name: catName,
    owner_id: user.id,
    owner_username: user.tag || user.username,
    status: 'open',
    priority: 'normal',
    claimed_by: null,
    created_at: new Date().toISOString(),
    question_answers: questionAnswers
  };

  // 11. Post In-Ticket Welcome Card (Pure Components V2 - NO legacy content)
  const welcomePayload = buildTicketControlCard({
    ticket: placeholderTicket,
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
  } catch (err) {
    logger.warn({ err, channelId: ticketChannel.id }, 'Failed to post ticket welcome card');
  }

  // 12. Persist to Database
  const createdRecord = await createTicket({
    guildId: guild.id,
    channelId: ticketChannel.id,
    ticketNumber,
    categoryId: category?.id || null,
    categoryName: catName,
    ownerId: user.id,
    ownerUsername: user.tag || user.username,
    controlMessageId: controlMsg?.id || null,
    questionAnswers
  });

  // 13. Audit Log Event
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

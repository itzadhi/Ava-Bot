import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { successCard } from '../../ui/cards.js';
import { createTicketRating, updateTicket, getTicketSettings } from '../../db/tickets.js';
import { sendTicketLog } from './logs.js';
import { logger } from '../../utils/logger.js';

export function getStarString(count) {
  const c = Math.max(1, Math.min(count, 5));
  return '⭐'.repeat(c) + '☆'.repeat(5 - c);
}

/**
 * Builds the rating prompt Components V2 payload
 */
export function buildRatingPromptPayload(guild, ticket, transcriptResult = null) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ⭐ How was your support experience?\n` +
      `Your ticket **#${ticket?.ticket_number || ''}** in **${format.escapeMarkdown(guild?.name || 'the server')}** has been closed.`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const lines = [
    `📂 **Category:** \`${ticket?.category_name || 'General Support'}\``,
    ...(ticket?.claimed_by ? [`👑 **Assisted by:** <@${ticket.claimed_by}>`] : []),
    `\nPlease take a moment to rate the service you received:`
  ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder());

  // 1-5 Star buttons
  const starsRow = new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map(num => 
      new ButtonBuilder()
        .setCustomId(`tkt:rate:${guild?.id || '0'}:${ticket?.id || '0'}:${num}`)
        .setLabel(`${num} Star${num > 1 ? 's' : ''}`)
        .setEmoji('⭐')
        .setStyle(ButtonStyle.Secondary)
    )
  );

  container.addActionRowComponents(starsRow);

  const payload = {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };

  if (transcriptResult?.html) {
    const attachment = new AttachmentBuilder(Buffer.from(transcriptResult.html), {
      name: transcriptResult.fileName || `transcript-ticket-${ticket?.ticket_number || 1}.html`
    });
    payload.files = [attachment];
  }

  return payload;
}

/**
 * Sends a rating prompt with 1-5 star buttons to the ticket owner via DM
 */
export async function sendRatingPrompt(ownerUserOrGuild, guildOrTicket, ticketOpt = null, transcriptResult = null) {
  let ownerUser = null;
  let guild = null;
  let ticket = null;

  if (ownerUserOrGuild && typeof ownerUserOrGuild.send === 'function') {
    ownerUser = ownerUserOrGuild;
    guild = guildOrTicket;
    ticket = ticketOpt;
  } else {
    guild = ownerUserOrGuild;
    ticket = guildOrTicket;
  }

  const payload = buildRatingPromptPayload(guild, ticket, transcriptResult);

  if (!ownerUser) {
    return payload;
  }

  const settings = await getTicketSettings(guild?.id);
  if (settings && !settings.rating_enabled) return null;

  try {
    return await ownerUser.send(payload);
  } catch (err) {
    logger.debug({ err, userId: ownerUser?.id }, 'Could not DM rating prompt to ticket owner (DMs closed)');
    return null;
  }
}

/**
 * Builds the optional review modal after clicking a star rating
 */
export function buildRatingFeedbackModal(guildId, ticketId, stars) {
  const modal = new ModalBuilder()
    .setCustomId(`tkt:rate_modal:${guildId}:${ticketId}:${stars}`)
    .setTitle(`Rate Support (${stars} Stars)`);

  const reviewInput = new TextInputBuilder()
    .setCustomId('review_text')
    .setLabel('Your Feedback (Optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Tell us what went well or how we can improve...')
    .setRequired(false)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder().addComponents(reviewInput));
  return modal;
}

/**
 * Handles saving the rating and logging review
 */
export async function handleRatingSubmission({
  guild,
  user,
  ticket,
  stars,
  feedback = null
}) {
  const ratingNum = parseInt(stars, 10) || 5;

  // Save to database
  await createTicketRating({
    ticketId: ticket.id,
    guildId: guild.id,
    userId: user.id,
    staffId: ticket.claimed_by || ticket.closed_by || null,
    rating: ratingNum,
    feedback: feedback || null
  });

  await updateTicket(ticket.id, { rating: ratingNum });

  // Audit log
  sendTicketLog(guild, {
    eventTitle: 'Ticket Rated',
    emoji: '⭐',
    ticket,
    user,
    extraDetails: [
      { label: 'Rating', value: `${getStarString(ratingNum)} (\`${ratingNum} / 5\`)` },
      ...(ticket.claimed_by ? [{ label: 'Assisted Staff', value: `<@${ticket.claimed_by}>` }] : []),
      ...(feedback ? [{ label: 'Customer Review', value: `> ${format.escapeMarkdown(feedback)}` }] : [])
    ]
  }).catch(() => {});

  return successCard({
    title: 'Thank You for Your Feedback!',
    subtitle: `Your **${ratingNum}-star** rating has been submitted to **${format.escapeMarkdown(guild.name)}**.`,
    details: [
      { label: 'Rating', value: `${getStarString(ratingNum)} (${ratingNum}/5)` },
      ...(feedback ? [{ label: 'Feedback', value: feedback }] : [])
    ],
    ephemeral: true
  });
}

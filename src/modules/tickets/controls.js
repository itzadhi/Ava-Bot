import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import {
  getTicketById,
  getTicketByChannel,
  getTicketCategory,
  updateTicket,
  recoverTicketFromChannel
} from '../../db/tickets.js';
import { logger } from '../../utils/logger.js';

const PRIORITY_CONFIG = {
  low: { label: 'Low', emoji: '⚪' },
  normal: { label: 'Normal', emoji: '🟢' },
  high: { label: 'High', emoji: '🟠' },
  urgent: { label: 'Urgent', emoji: '🔴' }
};

/**
 * Builds the inside-ticket welcome control card payload
 */
export function buildTicketControlCard({
  ticket,
  category = null,
  welcomeText = null,
  bannerUrl = null,
  thumbnailUrl = null
}) {
  const container = new ContainerBuilder();

  const prio = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.normal;
  const isClaimed = Boolean(ticket.claimed_by);
  const statusEmoji = ticket.status === 'closed' ? '🔒' : ticket.status === 'locked' ? '🔐' : '🎫';

  // Active banner & thumbnail resolution
  const activeBanner = bannerUrl || ticket.banner_url || category?.banner_url || null;
  const activeThumbnail = thumbnailUrl || ticket.thumbnail_url || category?.thumbnail_url || null;

  // 1. Banner Image (Top MediaGalleryBuilder if configured)
  if (activeBanner) {
    try {
      const media = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(activeBanner)
      );
      container.addMediaGalleryComponents(media);
      container.addSeparatorComponents(new SeparatorBuilder());
    } catch (_) {}
  }

  // 2. Title Heading (with optional Thumbnail accessory)
  const title = `## ${statusEmoji} ${ticket.category_name} — Ticket #${ticket.ticket_number}`;
  if (activeThumbnail) {
    try {
      const headerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(activeThumbnail));
      container.addSectionComponents(headerSection);
    } catch (_) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // 3. Ticket Metadata Block
  const createdUnix = Math.floor(new Date(ticket.created_at).getTime() / 1000);
  const claimText = isClaimed ? `👑 Claimed by <@${ticket.claimed_by}>` : '⏳ **Unclaimed** *(Click Claim to assign yourself)*';

  const metaLines = [
    `👑 **Ticket Owner:** <@${ticket.owner_id}> (\`${ticket.owner_username}\`)`,
    `📂 **Category:** \`${ticket.category_name}\` · ⚡ **Priority:** ${prio.emoji} \`${prio.label}\``,
    `🛡️ **Status:** \`${ticket.status.toUpperCase()}\` · ${claimText}`,
    `⏰ **Opened:** <t:${createdUnix}:F> (<t:${createdUnix}:R>)`
  ];

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(metaLines.join('\n')));

  // 4. Question Form Answers (if any)
  const answers = ticket.question_answers || {};
  const answerEntries = Object.entries(answers);

  if (answerEntries.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const qaLines = ['### 📋 Form Details'];
    for (const [qLabel, qAns] of answerEntries) {
      qaLines.push(`**${format.escapeMarkdown(qLabel)}**\n> ${format.escapeMarkdown(String(qAns))}`);
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(qaLines.join('\n\n')));
  }

  // 5. Custom Welcome Note
  const note = welcomeText || category?.welcome_template || 'Thank you for reaching out! A staff member will assist you shortly. Use the controls below to manage this ticket.';
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`💬 ${note}`)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // 6. In-Ticket Controls: Row 1 (Primary Action Buttons)
  const isClosed = ticket.status === 'closed';

  const row1 = new ActionRowBuilder().addComponents(
    greyButton({
      id: `tkt:ctl:claim:${ticket.id}`,
      label: isClaimed ? 'Unclaim' : 'Claim',
      emoji: isClaimed ? '↩️' : '✋',
      disabled: isClosed
    }),
    greyButton({
      id: `tkt:ctl:close:${ticket.id}`,
      label: 'Close',
      emoji: '🔒',
      disabled: isClosed
    }),
    greyButton({
      id: `tkt:ctl:close_req:${ticket.id}`,
      label: 'Close Request',
      emoji: '📩',
      disabled: isClosed
    }),
    greyButton({
      id: `tkt:ctl:priority:${ticket.id}`,
      label: 'Priority',
      emoji: '⚡',
      disabled: isClosed
    })
  );

  // 7. In-Ticket Controls: Row 2 (Staff & Tools Select Menu)
  const toolsMenu = new StringSelectMenuBuilder()
    .setCustomId(`tkt:ctl:tools_sel:${ticket.id}`)
    .setPlaceholder('Ticket management tools...');

  const toolOptions = [
    new StringSelectMenuOptionBuilder()
      .setLabel(ticket.status === 'locked' ? 'Unlock Ticket' : 'Lock Ticket')
      .setDescription(ticket.status === 'locked' ? 'Allow ticket owner to send messages again' : 'Prevent ticket owner from sending messages')
      .setValue('lock_toggle')
      .setEmoji('🔐'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Add User')
      .setDescription('Add an additional member to this ticket channel')
      .setValue('add_user')
      .setEmoji('➕'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Remove User')
      .setDescription('Remove a member from this ticket channel')
      .setValue('remove_user')
      .setEmoji('➖'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Add Role')
      .setDescription('Grant a server role access to view this ticket')
      .setValue('add_role')
      .setEmoji('🛡️'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Remove Role')
      .setDescription('Revoke a server role access to this ticket')
      .setValue('remove_role')
      .setEmoji('🚫'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Transfer Ticket')
      .setDescription('Transfer claim assignment to another staff member')
      .setValue('transfer')
      .setEmoji('👑'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Rename Ticket')
      .setDescription('Change the name of this ticket channel')
      .setValue('rename')
      .setEmoji('✏️'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Internal Staff Note')
      .setDescription('Add a private note visible only to staff')
      .setValue('note')
      .setEmoji('📝'),
    new StringSelectMenuOptionBuilder()
      .setLabel('Save Transcript')
      .setDescription('Generate an HTML transcript snapshot of this ticket')
      .setValue('transcript')
      .setEmoji('📄')
  ];

  if (isClosed) {
    toolOptions.unshift(
      new StringSelectMenuOptionBuilder()
        .setLabel('Reopen Ticket')
        .setDescription('Reactivate this closed ticket')
        .setValue('reopen')
        .setEmoji('🔓')
    );
  }

  toolsMenu.addOptions(toolOptions);
  const row2 = new ActionRowBuilder().addComponents(toolsMenu);

  container.addActionRowComponents(row1);
  container.addActionRowComponents(row2);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Refreshes the welcome control card in the ticket channel after state changes
 */
export async function refreshTicketControlCard(channel, ticketId) {
  if (!channel || !channel.isTextBased()) return null;

  try {
    let ticket = await getTicketById(ticketId, channel.guildId, channel.id);
    if (!ticket && channel.guildId) {
      ticket = await getTicketByChannel(channel.guildId, channel.id);
    }
    if (!ticket && channel.name?.startsWith('ticket-')) {
      ticket = await recoverTicketFromChannel(channel).catch(() => null);
    }
    if (!ticket) return null;

    let message = ticket.control_message_id
      ? await channel.messages.fetch(ticket.control_message_id).catch(() => null)
      : null;

    if (!message) {
      const msgs = await channel.messages.fetch({ limit: 10 }).catch(() => []);
      const botId = channel.client?.user?.id;
      message = msgs.find(m => (!botId || m.author.id === botId) && m.components?.length > 0) || null;
      if (message) {
        await updateTicket(ticket.id, { control_message_id: message.id }).catch(() => {});
      }
    }

    if (!message) return null;

    const category = ticket.category_id ? await getTicketCategory(ticket.category_id).catch(() => null) : null;
    const payload = buildTicketControlCard({ ticket, category });
    await message.edit(payload).catch(err => {
      logger.warn({ err, ticketId }, 'Failed to edit ticket control message');
    });
    return message;
  } catch (err) {
    logger.warn({ err, ticketId }, 'Error in refreshTicketControlCard');
    return null;
  }
}

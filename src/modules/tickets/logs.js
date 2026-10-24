import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { getTicketSettings } from '../../db/tickets.js';
import { logger } from '../../utils/logger.js';

/**
 * Builds a standardized Components V2 Ticket Event Log Card
 */
export function buildTicketLogCard({
  eventTitle,
  emoji = '🎫',
  ticket = null,
  user = null,
  staff = null,
  reason = null,
  extraDetails = []
}) {
  const container = new ContainerBuilder();

  // 1. Heading Section
  const heading = `## ${emoji} ${eventTitle}`;
  const avatar = staff?.displayAvatarURL?.({ size: 128 }) || user?.displayAvatarURL?.({ size: 128 });

  if (avatar) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar))
    );
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // 2. Key-Value Details
  const lines = [];

  if (ticket) {
    lines.push(format.kvLine('Ticket', `**#${ticket.ticket_number}** (<#${ticket.channel_id}>)`));
    lines.push(format.kvLine('Owner', `<@${ticket.owner_id}> (\`${ticket.owner_username}\`)`));
    if (ticket.category_name) {
      lines.push(format.kvLine('Category', `\`${ticket.category_name}\``));
    }
    if (ticket.priority) {
      const prioEmoji = ticket.priority === 'urgent' ? '🔴' : ticket.priority === 'high' ? '🟠' : ticket.priority === 'low' ? '⚪' : '🟢';
      lines.push(format.kvLine('Priority', `${prioEmoji} \`${ticket.priority.toUpperCase()}\``));
    }
  }

  if (user && (!ticket || user.id !== ticket.owner_id)) {
    lines.push(format.kvLine('Target User', `<@${user.id}> (\`${user.tag || user.username}\`)`));
  }

  if (staff) {
    lines.push(format.kvLine('Staff Member', `<@${staff.id}> (\`${staff.tag || staff.username}\`)`));
  }

  for (const detail of extraDetails) {
    if (detail.label && detail.value) {
      lines.push(format.kvLine(detail.label, detail.value));
    }
  }

  if (reason) {
    lines.push(format.kvLine('Reason', `> ${format.escapeMarkdown(reason)}`));
  }

  lines.push(format.kvLine('Timestamp', `<t:${Math.floor(Date.now() / 1000)}:F> (<t:${Math.floor(Date.now() / 1000)}:R>)`));

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  // 3. Footer
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# AVA • Ticket System Logs`)
  );

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Sends a log card to the configured ticket log channel
 */
export async function sendTicketLog(guild, payload) {
  if (!guild) return;
  try {
    const settings = await getTicketSettings(guild.id);
    if (!settings?.log_channel_id) return;

    const channel = guild.channels.cache.get(settings.log_channel_id);
    if (!channel || !channel.isTextBased()) return;

    const card = buildTicketLogCard(payload);
    await channel.send(card).catch(err => {
      logger.warn({ err, guildId: guild.id }, 'Failed to post ticket log card');
    });
  } catch (err) {
    logger.warn({ err, guildId: guild.id }, 'Error in sendTicketLog');
  }
}

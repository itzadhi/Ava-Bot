import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db, isUsingMockDb } from '../../db/client.js';
import { saveTicketTranscript, getTicketSettings } from '../../db/tickets.js';
import { buildTicketLogCard } from './logs.js';
import { logger } from '../../utils/logger.js';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(d) {
  const date = new Date(d);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Paginates and fetches all messages in a channel up to limit (default 1000)
 */
export async function fetchAllMessages(channel, limit = 1000) {
  const messages = [];
  let lastId = null;

  while (messages.length < limit) {
    const fetchLimit = Math.min(100, limit - messages.length);
    const options = { limit: fetchLimit };
    if (lastId) options.before = lastId;

    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || batch.size === 0) break;

    messages.push(...batch.values());
    lastId = batch.last()?.id;

    if (batch.size < fetchLimit) break;
  }

  // Chronological order (oldest first)
  return messages.reverse();
}

/**
 * Generates modern dark-mode HTML transcript content
 */
export function renderHtmlTranscript({ guild, channel, ticket, messages = [], guildName = null, channelName = null }) {
  const resolvedGuildName = escapeHtml(guild?.name || guildName || (typeof guild === 'string' ? guild : 'Discord Server'));
  const resolvedChannelName = escapeHtml(channel?.name || channelName || (typeof channel === 'string' ? channel : `ticket-${ticket?.ticket_number || ''}`));
  const ticketNum = ticket?.ticket_number || 1;
  const ownerName = escapeHtml(ticket?.owner_username || ticket?.owner_id || 'User');
  const categoryName = escapeHtml(ticket?.category_name || 'Support');

  let messageRowsHtml = '';

  for (const m of messages) {
    const authorName = escapeHtml(m.author?.tag || m.author?.username || 'Unknown');
    const authorAvatar = m.author?.displayAvatarURL?.({ size: 64 }) || 'https://cdn.discordapp.com/embed/avatars/0.png';
    const isBot = m.author?.bot;
    const timeStr = formatTimestamp(m.createdAt);

    let contentHtml = escapeHtml(m.content || '');
    // Format basic code blocks
    contentHtml = contentHtml.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
    contentHtml = contentHtml.replace(/`([^`]+)`/g, '<code>$1</code>');
    contentHtml = contentHtml.replace(/\n/g, '<br>');

    // Attachments
    let attachmentsHtml = '';
    if (m.attachments && m.attachments.size > 0) {
      attachmentsHtml = '<div class="attachments">';
      for (const att of m.attachments.values()) {
        const isImg = att.contentType?.startsWith('image/');
        if (isImg) {
          attachmentsHtml += `<a href="${att.url}" target="_blank"><img src="${att.url}" class="att-img" alt="Attachment" /></a>`;
        } else {
          attachmentsHtml += `<div class="att-file">📎 <a href="${att.url}" target="_blank">${escapeHtml(att.name)}</a></div>`;
        }
      }
      attachmentsHtml += '</div>';
    }

    messageRowsHtml += `
      <div class="message-row">
        <img class="avatar" src="${authorAvatar}" alt="Avatar" />
        <div class="message-body">
          <div class="header">
            <span class="username">${authorName}</span>
            ${isBot ? '<span class="bot-badge">BOT</span>' : ''}
            <span class="timestamp">${timeStr}</span>
          </div>
          <div class="content">${contentHtml}</div>
          ${attachmentsHtml}
        </div>
      </div>
    `;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Transcript — Ticket #${ticketNum} (${resolvedChannelName})</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #1e1f22; color: #dbdee1; font-family: 'gg sans', 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.4; padding: 24px; }
    .container { max-width: 900px; margin: 0 auto; background: #2b2d31; border-radius: 8px; border: 1px solid #383a40; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
    .top-bar { padding: 20px 24px; background: #111214; border-bottom: 1px solid #383a40; }
    .top-title { font-size: 20px; font-weight: 700; color: #f2f3f5; display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .top-meta { font-size: 12px; color: #949ba4; }
    .messages { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
    .message-row { display: flex; gap: 14px; align-items: flex-start; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: #383a40; flex-shrink: 0; }
    .message-body { flex: 1; min-width: 0; }
    .header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .username { font-weight: 600; color: #f2f3f5; font-size: 15px; }
    .bot-badge { background: #5865f2; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 4px; border-radius: 3px; }
    .timestamp { font-size: 11px; color: #949ba4; }
    .content { color: #dbdee1; word-break: break-word; }
    code { background: #1e1f22; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 12px; }
    pre { background: #1e1f22; border: 1px solid #383a40; padding: 8px; border-radius: 4px; margin: 6px 0; overflow-x: auto; }
    .attachments { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
    .att-img { max-width: 400px; max-height: 300px; border-radius: 4px; border: 1px solid #383a40; }
    .att-file { background: #1e1f22; padding: 6px 10px; border-radius: 4px; border: 1px solid #383a40; width: fit-content; }
    .att-file a { color: #00a8fc; text-decoration: none; }
    .footer { padding: 14px 24px; background: #111214; border-top: 1px solid #383a40; font-size: 12px; color: #949ba4; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div class="top-title">🎫 Ticket #${ticketNum} — ${resolvedChannelName}</div>
      <div class="top-meta">Server: <strong>${resolvedGuildName}</strong> · Owner: <strong>${ownerName}</strong> · Category: <strong>${categoryName}</strong> · Messages: <strong>${messages.length}</strong></div>
    </div>
    <div class="messages">
      ${messageRowsHtml}
    </div>
    <div class="footer">
      Generated on ${formatTimestamp(new Date())} · Argoni Ticket System
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates and uploads the transcript, and posts it to the transcript channel
 */
export async function generateAndSaveTranscript(channel, ticket) {
  const guild = channel.guild;
  const messages = await fetchAllMessages(channel, 1000);
  const htmlContent = renderHtmlTranscript({ guild, channel, ticket, messages });
  const fileName = `transcript-ticket-${ticket.ticket_number}.html`;

  let transcriptUrl = null;
  const storagePath = `transcripts/${guild.id}/${ticket.id}.html`;

  // 1. Try uploading to Supabase Storage
  try {
    const { data, error } = await db.storage
      .from('transcripts')
      .upload(storagePath, Buffer.from(htmlContent), {
        contentType: 'text/html',
        upsert: true
      });

    if (!error) {
      // In live Supabase, get public url
      const supabaseUrl = process.env.SUPABASE_URL;
      if (supabaseUrl && !isUsingMockDb()) {
        transcriptUrl = `${supabaseUrl}/storage/v1/object/public/transcripts/${storagePath}`;
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to upload transcript to Supabase Storage');
  }

  // 2. Fallback to local file in transcripts/ folder
  const localDir = path.resolve(process.cwd(), 'transcripts', guild.id);
  await fs.promises.mkdir(localDir, { recursive: true }).catch(() => {});
  const localFilePath = path.join(localDir, `${ticket.id}.html`);
  await fs.promises.writeFile(localFilePath, htmlContent, 'utf8').catch(() => {});

  // 3. Persist record in database
  await saveTicketTranscript({
    ticketId: ticket.id,
    guildId: guild.id,
    channelId: channel.id,
    ticketNumber: ticket.ticket_number,
    ownerId: ticket.owner_id,
    htmlUrl: transcriptUrl,
    storagePath,
    messageCount: messages.length
  });

  // 4. Send to configured transcript channel
  const settings = await getTicketSettings(guild.id);
  const transcriptChanId = settings?.transcript_channel_id || settings?.log_channel_id;

  if (transcriptChanId) {
    const logChannel = guild.channels.cache.get(transcriptChanId);
    if (logChannel && logChannel.isTextBased()) {
      const attachment = new AttachmentBuilder(Buffer.from(htmlContent), { name: fileName });
      const logCard = buildTicketLogCard({
        eventTitle: 'Transcript Saved',
        emoji: '📄',
        ticket,
        extraDetails: [
          { label: 'Messages', value: `\`${messages.length}\`` },
          ...(transcriptUrl ? [{ label: 'Hosted URL', value: `[View Online](${transcriptUrl})` }] : [])
        ]
      });

      const components = [...logCard.components];
      if (transcriptUrl) {
        components.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setLabel('View Transcript')
              .setURL(transcriptUrl)
              .setStyle(ButtonStyle.Link)
          )
        );
      }

      await logChannel.send({
        ...logCard,
        components,
        files: [attachment]
      }).catch(err => {
        logger.warn({ err }, 'Failed to send transcript to log channel');
      });
    }
  }

  return {
    url: transcriptUrl,
    html: htmlContent,
    fileName,
    messageCount: messages.length
  };
}

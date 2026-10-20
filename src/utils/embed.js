/**
 * Sanitizes an embed from a stored snapshot so it complies with Discord's REST API for sending.
 * Strips disallowed read-only fields (type, video, provider, proxy_url, etc.)
 * Ensures all fields are valid strings and not empty.
 * @param {object} raw
 * @returns {object|null}
 */
export function sanitizeEmbedForSend(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const e = (typeof raw.toJSON === 'function' ? raw.toJSON() : (raw.data || raw)) || {};

  const sanitized = {};

  if (e.title !== undefined && e.title !== null) {
    const titleStr = String(e.title).trim();
    if (titleStr) sanitized.title = titleStr.slice(0, 256);
  }

  if (e.description !== undefined && e.description !== null) {
    const descStr = String(e.description).trim();
    if (descStr) sanitized.description = descStr.slice(0, 4096);
  }

  if (typeof e.url === 'string' && (e.url.startsWith('http://') || e.url.startsWith('https://'))) {
    sanitized.url = e.url;
  }

  if (e.color !== undefined && e.color !== null && !isNaN(e.color)) {
    sanitized.color = Number(e.color);
  }

  if (e.timestamp) {
    try {
      sanitized.timestamp = new Date(e.timestamp).toISOString();
    } catch (_) {}
  }

  if (e.footer) {
    const footerText = typeof e.footer === 'string' ? e.footer : e.footer.text;
    if (footerText !== undefined && footerText !== null) {
      const ftStr = String(footerText).trim();
      if (ftStr) {
        sanitized.footer = { text: ftStr.slice(0, 2048) };
        const footerIcon = typeof e.footer === 'object' ? (e.footer.icon_url || e.footer.iconURL) : null;
        if (typeof footerIcon === 'string' && (footerIcon.startsWith('http://') || footerIcon.startsWith('https://'))) {
          sanitized.footer.icon_url = footerIcon;
        }
      }
    }
  }

  const rawImg = e.image;
  const imgUrl = typeof rawImg === 'string' ? rawImg : (rawImg?.url || rawImg?.proxy_url);
  if (typeof imgUrl === 'string' && (imgUrl.startsWith('http://') || imgUrl.startsWith('https://'))) {
    sanitized.image = { url: imgUrl };
  }

  const rawThumb = e.thumbnail;
  const thumbUrl = typeof rawThumb === 'string' ? rawThumb : (rawThumb?.url || rawThumb?.proxy_url);
  if (typeof thumbUrl === 'string' && (thumbUrl.startsWith('http://') || thumbUrl.startsWith('https://'))) {
    sanitized.thumbnail = { url: thumbUrl };
  }

  if (e.author) {
    const authorName = typeof e.author === 'string' ? e.author : e.author.name;
    if (authorName !== undefined && authorName !== null) {
      const anStr = String(authorName).trim();
      if (anStr) {
        sanitized.author = { name: anStr.slice(0, 256) };
        if (typeof e.author === 'object') {
          if (typeof e.author.url === 'string' && (e.author.url.startsWith('http://') || e.author.url.startsWith('https://'))) {
            sanitized.author.url = e.author.url;
          }
          const authorIcon = e.author.icon_url || e.author.iconURL;
          if (typeof authorIcon === 'string' && (authorIcon.startsWith('http://') || authorIcon.startsWith('https://'))) {
            sanitized.author.icon_url = authorIcon;
          }
        }
      }
    }
  }

  if (Array.isArray(e.fields) && e.fields.length > 0) {
    const validFields = [];
    for (const f of e.fields) {
      if (f && f.name !== undefined && f.name !== null && f.value !== undefined && f.value !== null) {
        const nameStr = String(f.name).trim();
        const valueStr = String(f.value).trim();
        if (nameStr && valueStr) {
          validFields.push({
            name: nameStr.slice(0, 256),
            value: valueStr.slice(0, 1024),
            inline: Boolean(f.inline)
          });
        }
      }
    }
    if (validFields.length > 0) {
      sanitized.fields = validFields.slice(0, 25);
    }
  }

  const hasVisibleContent = sanitized.title || sanitized.description || sanitized.image || sanitized.thumbnail || sanitized.fields || sanitized.author || sanitized.footer;
  if (!hasVisibleContent) {
    return null;
  }

  return sanitized;
}

/**
 * Sanitizes an array of embeds for sending via Webhook
 * @param {Array} embeds
 * @returns {Array}
 */
export function sanitizeEmbeds(embeds) {
  if (!Array.isArray(embeds)) return [];
  return embeds
    .map(e => sanitizeEmbedForSend(e))
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * Converts Discord Components V2 structures (Containers, Sections, TextDisplays, Thumbnails)
 * into a rich Embed suitable for Discord Webhooks.
 * @param {Array} components
 * @returns {object|null}
 */
export function componentsToEmbed(components) {
  if (!Array.isArray(components) || components.length === 0) return null;
  let color = null;
  let thumbnail = null;
  let image = null;
  const textBlocks = [];
  const linkButtons = [];

  function walk(node) {
    if (!node) return;
    const data = node.data || node;

    // Accent color from container
    if (data.accent_color && !color) {
      color = Number(data.accent_color);
    }

    // Accessory (Thumbnail, Button, Media)
    const acc = node.accessory || node.data?.accessory || data.accessory;
    if (acc) {
      const accData = acc.data || acc;
      const mediaUrl = acc.media?.data?.url || acc.media?.url || accData.media?.url || accData.media?.proxy_url || accData.url || accData.proxy_url;
      if (mediaUrl && !thumbnail) {
        thumbnail = { url: mediaUrl };
      }
      const btnUrl = accData.url || acc.url;
      const btnLabel = accData.label || acc.label;
      if (btnUrl && btnLabel) {
        linkButtons.push(`[${btnLabel}](${btnUrl})`);
      }
    }

    // Direct media object
    const mediaObj = node.media || data.media;
    if (mediaObj) {
      const mUrl = mediaObj.data?.url || mediaObj.url || mediaObj.proxy_url;
      if (mUrl && !thumbnail) {
        thumbnail = { url: mUrl };
      }
    }

    // Content from TextDisplay or general component
    const content = data.content !== undefined ? data.content : node.content;
    if (content !== undefined && content !== null) {
      const cStr = String(content).trim();
      if (cStr) textBlocks.push(cStr);
    }

    // Link buttons inside ActionRows
    const nodeType = data.type !== undefined ? data.type : node.type;
    const nodeUrl = data.url || node.url;
    const nodeLabel = data.label || node.label;
    if (nodeType === 2 && nodeUrl && nodeLabel) {
      linkButtons.push(`[${nodeLabel}](${nodeUrl})`);
    }

    const children = node.components || data.components;
    if (Array.isArray(children)) {
      for (const child of children) {
        walk(child);
      }
    }
  }

  for (const c of components) {
    walk(c);
  }

  if (linkButtons.length > 0) {
    textBlocks.push('🔗 ' + linkButtons.join(' • '));
  }

  if (textBlocks.length === 0 && !thumbnail && !image) {
    return null;
  }

  return {
    color: color || 0x5865F2,
    description: textBlocks.join('\n\n').slice(0, 4096),
    thumbnail: thumbnail || undefined,
    image: image || undefined
  };
}

/**
 * Extracts and sanitizes full message payload from a Discord.js Message instance.
 * Handles text, attachments, classic embeds, and converts Components V2 cards into rich embeds.
 * @param {import('discord.js').Message} m
 * @returns {object}
 */
export function extractMessagePayload(m) {
  if (!m) return null;

  let text = typeof m.content === 'string' ? m.content : '';
  if (!text.replace(/[\s\u200b\u200c\u200d\ufeff]/g, '')) {
    text = '';
  } else {
    text = text.trim();
  }

  const attachments = Array.from(m.attachments?.values() || []).map(a => ({
    name: a.name,
    url: a.url
  }));

  const rawComponents = Array.isArray(m.components)
    ? m.components.map(c => (typeof c?.toJSON === 'function' ? c.toJSON() : (c?.data || c)))
    : [];

  const rawEmbeds = Array.from(m.embeds || []).map(e => {
    if (typeof e?.toJSON === 'function') return e.toJSON();
    if (e?.data) return e.data;
    return e;
  });

  // If message has Components V2 containers/sections, convert them into an embed
  if (rawComponents.length > 0) {
    const compEmbed = componentsToEmbed(m.components);
    if (compEmbed) {
      if (rawEmbeds.length === 0) {
        rawEmbeds.push(compEmbed);
      }
      if (!text && !rawEmbeds.length) {
        text = compEmbed.description?.slice(0, 2000) || '';
      }
    }
  }

  // Fallback to attachment links if text is empty
  if (!text && attachments.length > 0) {
    text = attachments.map(a => a.url).filter(Boolean).join('\n');
  }

  return {
    id: m.id,
    authorId: m.author?.id || '0',
    authorName: m.author?.username || 'User',
    authorAvatar: typeof m.author?.displayAvatarURL === 'function' ? m.author.displayAvatarURL() : null,
    content: text,
    createdAt: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
    attachments,
    embeds: rawEmbeds,
    components: rawComponents,
    referenceMessageId: m.reference?.messageId || null
  };
}

export default {
  sanitizeEmbedForSend,
  sanitizeEmbeds,
  componentsToEmbed,
  extractMessagePayload
};

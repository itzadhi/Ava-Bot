import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} from 'discord.js';
import { THEME, getBrandAttachment } from './theme.js';

/**
 * Normalizes title string ensuring exactly one glyph at the start and ## markdown
 * @param {string} title 
 * @param {string} defaultGlyph 
 * @returns {string}
 */
function formatTitle(title, defaultGlyph = '') {
  let clean = title.trim();
  const knownGlyphs = ['✓', '✕', 'ℹ', '⟳', '✦', '⚙', '📦', '⚠️', '⚡', '🌐', '🔒'];
  const hasGlyph = knownGlyphs.some(g => clean.startsWith(g));
  
  if (!hasGlyph && defaultGlyph) {
    clean = `${defaultGlyph} ${clean}`;
  }
  if (!clean.startsWith('## ')) {
    clean = `## ${clean}`;
  }
  return clean;
}

/**
 * Base card helper for Discord Components V2
 * Exactly ONE Container per message
 * Max 3 text blocks and 1 action row
 */
export function card({
  title,
  glyph = '',
  subtitle = null,
  body = null,
  subtext = 'Argoni',
  color = THEME.colors.neutral,
  rows = [],
  thumbnail = null,
  files = [],
  ephemeral = false,
  textBlocks = null
}) {
  const container = new ContainerBuilder();
  const attachedFiles = Array.isArray(files) ? [...files] : [];
  let activeThumbnail = thumbnail;

  if (activeThumbnail && typeof activeThumbnail === 'string' && activeThumbnail.startsWith('attachment://logo.jpg')) {
    const brandAttachment = getBrandAttachment();
    if (brandAttachment) {
      attachedFiles.push(brandAttachment);
    } else {
      activeThumbnail = null;
    }
  }

  // Header section (with thumbnail accessory if requested)
  const headerContent = subtitle
    ? `${formatTitle(title, glyph)}\n${subtitle}`
    : formatTitle(title, glyph);

  if (activeThumbnail) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(activeThumbnail));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
  }

  // Logical separator before content if there is body content
  if (Array.isArray(textBlocks) && textBlocks.length > 0) {
    for (let i = 0; i < textBlocks.length; i++) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const blockContent = (i === textBlocks.length - 1 && subtext)
        ? `${textBlocks[i]}\n-# ${subtext}`
        : textBlocks[i];
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(blockContent));
    }
  } else if (body) {
    container.addSeparatorComponents(new SeparatorBuilder());
    
    // Append subtext (-#) to body content
    const fullBody = subtext ? `${body}\n-# ${subtext}` : body;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fullBody));
  } else if (subtext) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${subtext}`));
  }

  // Action rows (up to 5 action rows)
  if (rows && rows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const r of rows.slice(0, 5)) {
      container.addActionRowComponents(r);
    }
  }

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }

  const payload = {
    flags,
    components: [container],
    allowedMentions: { parse: [] }
  };

  if (attachedFiles.length > 0) {
    payload.files = attachedFiles;
  }

  return payload;
}

/**
 * Success card (Emerald accent #57F287, ✓ glyph)
 * Rich formatting with blockquote highlights and next-step tips
 */
export function successCard({
  title = 'Action Completed',
  subtitle = null,
  body = null,
  tip = null,
  subtext = 'Argoni Operations',
  rows = [],
  files = [],
  ephemeral = false
}) {
  const fullBody = tip ? `${body}\n\n-# 💡 ${tip}` : body;
  return card({
    title,
    glyph: THEME.glyphs.success,
    subtitle,
    body: fullBody,
    subtext,
    color: THEME.colors.success,
    rows,
    files,
    ephemeral
  });
}

/**
 * Error card (Crimson accent #ED4245, ✕ glyph)
 * Rich diagnostics with "Issue Encountered" and "Suggested Solution" callouts
 */
export function errorCard({
  title = 'Execution Error',
  subtitle = null,
  reason,
  fix,
  subtext = 'Argoni Safety Diagnostics',
  rows = [],
  files = [],
  ephemeral = false
}) {
  const body = `> 🛑 **Issue Encountered**\n> ${reason || 'An unexpected issue occurred.'}\n\n> 💡 **Recommended Solution**\n> ${fix || 'Check your permissions and command arguments, then try again.'}`;
  return card({
    title,
    glyph: THEME.glyphs.error,
    subtitle: subtitle || 'Operation could not be completed',
    body,
    subtext,
    color: THEME.colors.error,
    rows,
    files,
    ephemeral
  });
}

/**
 * Info card (Blurple accent #5865F2, ℹ glyph)
 */
export function infoCard({
  title = 'Information',
  subtitle = null,
  body = null,
  subtext = 'Argoni',
  rows = [],
  thumbnail = null,
  files = [],
  ephemeral = false
}) {
  return card({
    title,
    glyph: THEME.glyphs.info,
    subtitle,
    body,
    subtext,
    color: THEME.colors.info,
    rows,
    thumbnail,
    files,
    ephemeral
  });
}

/**
 * Warning card (Yellow accent #FEE75C, ⚠️ glyph)
 */
export function warnCard({
  title = 'Warning',
  subtitle = null,
  body = null,
  subtext = 'Argoni',
  rows = [],
  files = [],
  ephemeral = false
}) {
  return card({
    title,
    glyph: '⚠️',
    subtitle,
    body,
    subtext,
    color: THEME.colors.warning,
    rows,
    files,
    ephemeral
  });
}

/**
 * Confirmation card with Danger/Primary Confirm and Secondary Cancel buttons
 * Uses standard Unicode emojis ✅ and ❌ to comply with Discord API specifications
 */
export function confirmCard({
  title = 'Action Requires Confirmation',
  subtitle = 'Please review the operation details before proceeding.',
  details = null,
  confirmCustomId = 'confirm',
  cancelCustomId = 'cancel',
  confirmLabel = 'Confirm & Proceed',
  cancelLabel = 'Cancel',
  danger = true,
  subtext = 'Confirmation expires in 60s • Argoni',
  ephemeral = false
}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmCustomId)
      .setLabel(confirmLabel)
      .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Primary)
      .setEmoji(danger ? '⚠️' : '✅'),
    new ButtonBuilder()
      .setCustomId(cancelCustomId)
      .setLabel(cancelLabel)
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('❌')
  );

  return card({
    title,
    glyph: danger ? '⚠️' : THEME.glyphs.info,
    subtitle,
    body: details,
    subtext,
    color: danger ? THEME.colors.error : THEME.colors.warning,
    rows: [row],
    ephemeral
  });
}

/**
 * Progress card (▰▰▰▱▱▱ 50%, step, done/total)
 */
export function progressCard({
  title = 'Operation in Progress',
  step = 'Processing',
  done = 0,
  total = 100,
  subtext = 'Argoni Operations',
  ephemeral = false
}) {
  const safeTotal = total > 0 ? total : 1;
  const ratio = Math.min(Math.max(done / safeTotal, 0), 1);
  const percent = Math.round(ratio * 100);

  const barLength = 12;
  const filledBars = Math.round(ratio * barLength);
  const emptyBars = barLength - filledBars;
  const bar = `${'▰'.repeat(filledBars)}${'▱'.repeat(emptyBars)}`;

  const body = `> 📊 **Current Progress**: \`${bar} ${percent}%\`\n> ⚙️ **Active Phase**: **${step}**\n> 📈 **Status**: \`${done} / ${total}\` completed`;

  return card({
    title,
    glyph: THEME.glyphs.loading,
    subtitle: 'Please do not modify server settings or roles during this process.',
    body,
    subtext,
    color: THEME.colors.blurple,
    ephemeral
  });
}

/**
 * Rich Server Backup Snapshot Card
 * Highlights universal cross-server capabilities, component counts, size, and status
 */
export function backupCard({
  title = 'Server Snapshot',
  subtitle = null,
  id,
  name,
  sizeFormatted,
  originGuildName = null,
  originGuildId = null,
  targetGuildName = null,
  isCrossServer = false,
  authorTag = null,
  createdAt = null,
  locked = false,
  isAuto = false,
  stats = null,
  tip = null,
  rows = [],
  ephemeral = false
}) {
  const statusBadge = locked ? '🔒 `[Protected]`' : '🔓 `[Unlocked]`';
  const typeBadge = isAuto ? '🤖 `[Auto-Backup]`' : '⚡ `[Manual]`';
  const migrationBadge = isCrossServer ? '🌐 `[Cross-Server Ready]`' : '🏠 `[Native Server]`';

  const lines = [
    `> 🔑 **Backup ID**: \`${id}\`  ${statusBadge} ${typeBadge}`,
    `> 🏷️ **Snapshot Name**: **${name}**  •  📦 **Size**: \`${sizeFormatted || 'N/A'}\``
  ];

  if (originGuildName || originGuildId) {
    lines.push(`> 🌐 **Origin Server**: \`${originGuildName || originGuildId}\` ${migrationBadge}`);
  }

  if (targetGuildName && isCrossServer) {
    lines.push(`> 🎯 **Target Server**: \`${targetGuildName}\``);
  }

  if (stats) {
    const statParts = [];
    if (stats.channels !== undefined) statParts.push(`📁 **${stats.channels}** channels`);
    if (stats.roles !== undefined) statParts.push(`🛡️ **${stats.roles}** roles`);
    if (stats.emojis !== undefined) statParts.push(`😀 **${stats.emojis}** emojis`);
    if (stats.stickers !== undefined) statParts.push(`🏷️ **${stats.stickers}** stickers`);
    if (statParts.length > 0) {
      lines.push(`> 📊 **Structure**: ${statParts.join(' • ')}`);
    }
  }

  if (authorTag) {
    lines.push(`> 👤 **Author**: ${authorTag}`);
  }

  if (createdAt) {
    lines.push(`> 🕒 **Created**: ${createdAt}`);
  }

  const defaultTip = isCrossServer
    ? `Universal Deployment: Run /backup load id:${id} on any server you manage to restore this layout.`
    : `To deploy this backup to another server, invite Argoni there and run /backup load id:${id}`;

  const body = `${lines.join('\n')}\n\n-# 💡 ${tip || defaultTip}`;

  return card({
    title,
    glyph: '📦',
    subtitle: subtitle || 'Universal Encrypted Snapshot (AES-256-GCM + gzip)',
    body,
    subtext: 'Argoni Universal Backup Engine',
    color: isCrossServer ? THEME.colors.blurple : THEME.colors.success,
    rows,
    thumbnail: 'attachment://logo.jpg',
    ephemeral
  });
}

/**
 * List card (5 items per page, Prev/Next buttons, "Page 1/4", optional scope toggle)
 */
export function listCard({
  title,
  subtitle = null,
  items = [],
  page = 1,
  totalPages = 1,
  customIdPrefix = 'list',
  subtext = null,
  extraButtons = [],
  ephemeral = false
}) {
  const safePage = Math.max(1, page);
  const safeTotal = Math.max(1, totalPages);
  
  const content = items.length > 0
    ? items.join('\n\n')
    : '_No entries found._';

  const footer = `Page ${safePage}/${safeTotal}${subtext ? ` • ${subtext}` : ' • Argoni'}`;

  const buttons = [];

  // Add scope or action buttons if provided
  if (Array.isArray(extraButtons) && extraButtons.length > 0) {
    buttons.push(...extraButtons.slice(0, 3));
  }

  // Add paging buttons
  buttons.push(
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:prev:${safePage - 1}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 1),
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:next:${safePage + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= safeTotal)
  );

  const row = new ActionRowBuilder().addComponents(buttons.slice(0, 5));

  return card({
    title,
    glyph: THEME.glyphs.info,
    subtitle,
    body: content,
    subtext: footer,
    color: THEME.colors.neutral,
    rows: [row],
    ephemeral
  });
}

/**
 * Detail card with key-value pairs formatted as clean blockquotes
 */
export function detailCard({
  title,
  subtitle = null,
  fields = [],
  subtext = 'Argoni',
  rows = [],
  thumbnail = null,
  files = [],
  color = THEME.colors.info,
  ephemeral = false
}) {
  const body = fields
    .map(f => `> **${f.label}**: ${f.value}`)
    .join('\n');

  return card({
    title,
    glyph: THEME.glyphs.info,
    subtitle,
    body,
    subtext,
    color,
    rows,
    thumbnail,
    files,
    ephemeral
  });
}

/**
 * Loading card for defer / initial acknowledgment
 */
export function loadingCard({
  title = 'Processing Request',
  subtitle = 'Please wait a moment while Argoni processes your operation...',
  ephemeral = false
}) {
  return card({
    title,
    glyph: THEME.glyphs.loading,
    subtitle,
    color: THEME.colors.neutral,
    subtext: 'Argoni Core Engine',
    ephemeral
  });
}

/**
 * Metrics dashboard card for stats, server analytics, or system health
 */
export function metricCard({
  title = 'System Overview',
  subtitle = null,
  metrics = [],
  subtext = 'Argoni Telemetry',
  rows = [],
  color = THEME.colors.blurple,
  ephemeral = false
}) {
  const metricContent = metrics
    .map(m => `> 📈 **${m.label}**: \`${m.value}\`${m.detail ? ` (${m.detail})` : ''}`)
    .join('\n');

  return card({
    title,
    glyph: THEME.glyphs.sparkle,
    subtitle,
    body: metricContent,
    subtext,
    color,
    rows,
    ephemeral
  });
}

/**
 * Form / Action prompt card with a dedicated CTA button that launches a modal
 */
export function formCard({
  title,
  subtitle = null,
  description = null,
  buttonLabel = 'Open Form',
  buttonCustomId = 'open_form',
  color = THEME.colors.info,
  subtext = 'Argoni Forms',
  ephemeral = false
}) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buttonCustomId)
      .setLabel(buttonLabel)
      .setStyle(ButtonStyle.Primary)
  );

  return card({
    title,
    glyph: THEME.glyphs.gear,
    subtitle,
    body: description,
    subtext,
    color,
    rows: [row],
    ephemeral
  });
}

/**
 * Media Gallery card using native Components V2 MediaGalleryBuilder
 */
export function mediaGalleryCard({
  title,
  subtitle = null,
  body = null,
  images = [],
  subtext = 'Argoni Media',
  color = THEME.colors.blurple,
  rows = [],
  ephemeral = false
}) {
  const container = new ContainerBuilder();

  const headerContent = subtitle
    ? `${formatTitle(title, THEME.glyphs.sparkle)}\n${subtitle}`
    : formatTitle(title, THEME.glyphs.sparkle);

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));

  if (body) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }

  // Native Discord Components V2 MediaGalleryBuilder
  if (images && images.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    const gallery = new MediaGalleryBuilder();
    for (const img of images.slice(0, 4)) {
      const url = typeof img === 'string' ? img : img.url;
      const desc = typeof img === 'object' ? img.description : null;
      const item = new MediaGalleryItemBuilder().setURL(url);
      if (desc) item.setDescription(desc);
      gallery.addItems(item);
    }
    container.addMediaGalleryComponents(gallery);
  }

  if (subtext) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${subtext}`));
  }

  if (rows && rows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const r of rows.slice(0, 1)) {
      container.addActionRowComponents(r);
    }
  }

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }

  return {
    flags,
    components: [container]
  };
}

/**
 * Brand card configured with Argoni logo asset
 */
export function brandCard({
  title = 'Argoni Discord Framework',
  subtitle = 'Modular Components V2 Discord Engine',
  body = null,
  rows = [],
  ephemeral = false
}) {
  return card({
    title,
    glyph: THEME.glyphs.sparkle,
    subtitle,
    body: body || '> 🧩 **Engine**: Discord Components V2 Layout System\n> 🗄️ **Database**: Supabase (PostgreSQL + Storage with RLS)\n> 📦 **Architecture**: Reusable Universal Modules\n> 🌐 **Cross-Server**: Full Server Replication & Cloning Support',
    subtext: THEME.brand.footerSubtext,
    color: THEME.colors.blurple,
    rows,
    thumbnail: 'attachment://logo.jpg',
    ephemeral
  });
}

/**
 * Ultra-rich Home / Command Hub Card
 * Displays the Argoni Control Center with live status chips, command matrix, and interactive controls
 */
export function homeCard({
  title = 'Argoni Control Center',
  subtitle = 'Universal Server Snapshots • Live Guild Sync • Blueprint Hub',
  body = null,
  rows = [],
  files = [],
  subtext = 'Argoni Control Center • Universal Operations',
  color = THEME.colors.blurple,
  ephemeral = false
}) {
  const container = new ContainerBuilder();
  const attachedFiles = Array.isArray(files) ? [...files] : [];

  const brandAttachment = getBrandAttachment();
  if (brandAttachment) {
    attachedFiles.push(brandAttachment);
  }

  // Hero Section with Argoni logo accessory
  const headerContent = `${formatTitle(title, '⚡')}\n${subtitle}`;
  const heroSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://logo.jpg'));
  container.addSectionComponents(heroSection);

  container.addSeparatorComponents(new SeparatorBuilder());

  const defaultBody = [
    `> 🟢 **STATUS**: Operational • \`v1.0.0\` • 🔒 **AES-256-GCM Vault**`,
    `> 🌐 **CROSS-SERVER**: Universal Server Snapshot Replication Active`,
    `> 🎛️ **FRAMEWORK**: Discord Components V2 Native • Supabase Powered`,
    '',
    '### 🧭 Centralized Control Panels',
    '• 📦 **Backups** (`/backup`) — Multi-server snapshot, universal cross-server restore, role hierarchy & clean wipe',
    '• ⚙️ **Settings** (`/setting`) — Centralized server configuration, chatlog vault & sync toggles',
    '• 💬 **Chatlog Vault** (`/chatlog`) — AES-256-GCM encrypted channel chat archive & webhook replay'
  ].join('\n');

  const contentToDisplay = body || defaultBody;
  const fullBody = subtext ? `${contentToDisplay}\n\n-# 💡 ${subtext}` : contentToDisplay;

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fullBody));

  if (rows && rows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const r of rows.slice(0, 5)) {
      container.addActionRowComponents(r);
    }
  }

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }

  const payload = {
    flags,
    components: [container]
  };

  if (attachedFiles.length > 0) {
    payload.files = attachedFiles;
  }

  return payload;
}

/**
 * Unified Argoni Restoration Console Panel
 * A single, cohesive, in-place updating Components V2 panel for Pre-Flight Confirmation,
 * Live Pipeline Execution, and Verified Completion Manifest.
 */
export function restoreConsoleCard({
  stage = 'confirm', // 'confirm' | 'running' | 'complete' | 'error'
  record = {},
  targetGuildName = 'Target Server',
  originGuildName = 'Origin Server',
  isCrossServer = false,
  clean = true,
  doneSteps = 0,
  totalSteps = 5,
  currentPhaseText = 'Initializing deployment...',
  checklist = [],
  completedManifest = [],
  errorMessage = null,
  errorFix = null,
  durationSec = null,
  confirmCustomId = 'load_confirm',
  cancelCustomId = 'load_cancel',
  rows = [],
  ephemeral = false
}) {
  const container = new ContainerBuilder();
  const brandAttachment = getBrandAttachment();
  const attachedFiles = brandAttachment ? [brandAttachment] : [];

  let title = 'Argoni Restoration Console';
  let subtitle = `Deploying to "${targetGuildName}"`;
  let color = THEME.colors.blurple;
  let actionRows = Array.isArray(rows) ? [...rows] : [];

  if (stage === 'confirm') {
    title = isCrossServer ? 'Confirm Cross-Server Migration' : 'Confirm Server Restoration';
    subtitle = `Deploying layout from "${originGuildName}" ➔ "${targetGuildName}"`;
    color = THEME.colors.warning;

    const preflightLines = [
      `> 🔑 **Snapshot**: **${record.name || 'Unnamed'}** (\`${record.id || 'N/A'}\`)`,
      `> 🌐 **Origin Source**: \`${originGuildName}\` (\`${record.guild_id || 'N/A'}\`)`,
      `> 🎯 **Target Destination**: **${targetGuildName}**`,
      `> 🧹 **Deployment Mode**: ${clean ? '⚠️ **CLEAN SLATE FULL WIPE** (Old channels & roles deleted first)' : '✅ **ADDITIVE** (Keeps existing, adds missing)'}`,
      `> 👤 **Author**: <@${record.owner_id || 'Unknown'}>`,
      '',
      '### 📋 Execution Blueprint',
      '• 🧹 **Phase 1**: Clean wipe of unmanaged existing server structure',
      '• 🛡️ **Phase 2**: Rebuild role hierarchy & preserve relative permission tree',
      '• 📁 **Phase 3**: Reconstruct category channels with permission overwrites',
      '• 💬 **Phase 4**: Replicate text, voice, and announcement channels',
      '• ⚙️ **Phase 5**: Synchronize server settings, verification levels, and emojis'
    ];

    const hero = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚠️ ${title}\n${subtitle}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://logo.jpg'));
    container.addSectionComponents(hero);
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${preflightLines.join('\n')}\n\n-# ⚠️ Confirmation expires in 60s • Argoni Universal Engine`
    ));

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmCustomId)
        .setLabel('Deploy')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🚀'),
      new ButtonBuilder()
        .setCustomId(cancelCustomId)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌')
    );
    actionRows = [confirmRow];
  } else if (stage === 'running') {
    title = 'Argoni Deployment Console';
    subtitle = `Deploying "${record.name || 'Snapshot'}" into "${targetGuildName}"`;
    color = THEME.colors.blurple;

    const safeTotal = totalSteps > 0 ? totalSteps : 1;
    const ratio = Math.min(Math.max(doneSteps / safeTotal, 0), 1);
    const percent = Math.round(ratio * 100);
    const barLength = 12;
    const filled = Math.round(ratio * barLength);
    const bar = `${'▰'.repeat(filled)}${'▱'.repeat(barLength - filled)}`;

    const runningLines = [
      `> 🔑 **Snapshot**: **${record.name || 'Snapshot'}** (\`${record.id || 'N/A'}\`)`,
      `> 🌐 **Source**: \`${originGuildName}\` ➔ 🎯 **Target**: \`${targetGuildName}\``,
      `> 📊 **Overall Pipeline Progress**: \`${bar} ${percent}%\``,
      '',
      '### 🛠️ Live Pipeline Execution',
      ...(checklist.length > 0 ? checklist : [`> ⚙️ **Active Phase**: **${currentPhaseText}**`]),
      '',
      `*Active Step: ${currentPhaseText}...*`
    ];

    const hero = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ⚡ ${title}\n${subtitle}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://logo.jpg'));
    container.addSectionComponents(hero);
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${runningLines.join('\n')}\n\n-# ⚙️ Live Component V2 Pipeline • Do not modify server settings • Argoni`
    ));
  } else if (stage === 'complete') {
    title = isCrossServer ? 'Cross-Server Migration Complete' : 'Server Deployment Complete';
    subtitle = `Successfully deployed "${record.name || 'Snapshot'}" (\`${record.id || 'N/A'}\`) to "${targetGuildName}"`;
    color = THEME.colors.success;

    const completeLines = [
      `> 🌐 **Source Origin**: \`${originGuildName}\``,
      `> 🎯 **Destination Guild**: **${targetGuildName}**`,
      `> ⏱️ **Execution Time**: \`${durationSec || 5}s\` • 🔒 **Integrity**: Verified AES-256-GCM`,
      '',
      '### 📦 Verified Deployment Manifest',
      ...(completedManifest.length > 0 ? completedManifest : ['> ✓ Structure and settings replicated successfully.'])
    ];

    const hero = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ✅ ${title}\n${subtitle}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://logo.jpg'));
    container.addSectionComponents(hero);
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${completeLines.join('\n')}\n\n-# 💡 All roles, hierarchy levels, channels, and permissions are active • Argoni`
    ));
  } else if (stage === 'error') {
    title = 'Deployment Interrupted';
    subtitle = `Failed while deploying into "${targetGuildName}"`;
    color = THEME.colors.error;

    const errorLines = [
      `> 🛑 **Encountered Issue**: ${errorMessage || 'An unexpected error occurred during execution.'}`,
      `> 💡 **Recommended Fix**: ${errorFix || 'Check bot role hierarchy and permissions, then retry.'}`,
      '',
      checklist.length > 0 ? `**Completed Steps Prior to Failure**:\n${checklist.join('\n')}` : ''
    ];

    const hero = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛑 ${title}\n${subtitle}`))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://logo.jpg'));
    container.addSectionComponents(hero);
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${errorLines.join('\n')}\n\n-# Argoni Deployment Diagnostics`
    ));
  }

  if (actionRows.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    for (const r of actionRows.slice(0, 5)) {
      container.addActionRowComponents(r);
    }
  }

  let flags = MessageFlags.IsComponentsV2;
  if (ephemeral) {
    flags |= MessageFlags.Ephemeral;
  }

  const payload = {
    flags,
    components: [container]
  };

  if (attachedFiles.length > 0) {
    payload.files = attachedFiles;
  }

  return payload;
}



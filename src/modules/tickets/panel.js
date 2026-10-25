import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags
} from 'discord.js';
import * as format from '../../utils/ui/format.js';
import { successCard, errorCard } from '../../ui/cards.js';
import { logger } from '../../utils/logger.js';
import { getTicketCategories, getTicketPanels, getTicketPanel, saveTicketPanel, deleteTicketPanel } from '../../db/tickets.js';
import { ensureDefaultCategories } from './categories.js';

/**
 * Builds the public Components V2 Ticket Panel message to be deployed in channels
 */
export async function buildPublishedPanelCard({ panel, categories = [] }) {
  const container = new ContainerBuilder();

  // 1. Banner Image (Top MediaGalleryBuilder if configured)
  if (panel.banner_url) {
    try {
      const media = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(panel.banner_url)
      );
      container.addMediaGalleryComponents(media);
      container.addSeparatorComponents(new SeparatorBuilder());
    } catch (_) {}
  }

  // 2. Header Section (with optional Thumbnail accessory)
  const headingText = `## ${panel.button_emoji || '🎫'} ${panel.title || 'Support Tickets'}`;
  if (panel.thumbnail_url) {
    try {
      const headerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(panel.thumbnail_url));
      container.addSectionComponents(headerSection);
    } catch (_) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // 3. Description Section
  const desc = panel.description || 'Need help or have questions? Open a ticket below to speak directly with our staff team.';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${desc}\n\n` +
      `-# ⚡ *Our support team responds promptly during active hours.*`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // Filter categories enabled for this panel (max 25 for Discord ActionRow limit)
  const enabledCategories = categories.filter(c => 
    c.is_enabled !== false &&
    (!panel.category_ids?.length || panel.category_ids.includes(c.id))
  ).slice(0, 25);

  // 4. Action Controls based on panel.style
  if (panel.style === 'buttons') {
    // Buttons layout (chunked into rows of up to 5)
    const rows = [];
    let currentRow = new ActionRowBuilder();

    for (let i = 0; i < enabledCategories.length; i++) {
      const cat = enabledCategories[i];
      if (currentRow.components.length === 5) {
        rows.push(currentRow);
        currentRow = new ActionRowBuilder();
      }

      const btn = new ButtonBuilder()
        .setCustomId(`tkt:panel:open:${panel.id}:${cat.id}`)
        .setLabel(cat.name.slice(0, 80))
        .setStyle(ButtonStyle.Secondary);

      if (cat.emoji) {
        btn.setEmoji(cat.emoji);
      }
      currentRow.addComponents(btn);
    }

    if (currentRow.components.length > 0) {
      rows.push(currentRow);
    }

    // Fallback if no categories
    if (rows.length === 0) {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tkt:panel:open:${panel.id}:default`)
          .setLabel(panel.button_label || 'Open Ticket')
          .setEmoji(panel.button_emoji || '🎫')
          .setStyle(ButtonStyle.Secondary)
      ));
    }

    for (const r of rows) {
      container.addActionRowComponents(r);
    }

  } else if (panel.style === 'single') {
    // Single button layout
    const singleRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`tkt:panel:single:${panel.id}`)
        .setLabel(panel.button_label || 'Open Ticket')
        .setEmoji(panel.button_emoji || '🎫')
        .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(singleRow);

  } else {
    // Default 'select' dropdown layout
    const select = new StringSelectMenuBuilder()
      .setCustomId(`tkt:panel:sel:${panel.id}`)
      .setPlaceholder('Select a ticket category to open...')
      .setMinValues(1)
      .setMaxValues(1);

    const options = enabledCategories.slice(0, 25).map(cat => {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(cat.name.slice(0, 100))
        .setValue(cat.id)
        .setDefault(false);

      if (cat.description) {
        opt.setDescription(cat.description.slice(0, 100));
      }
      if (cat.emoji) {
        opt.setEmoji(cat.emoji);
      }
      return opt;
    });

    if (options.length === 0) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel('General Support')
          .setDescription('Open a general support ticket')
          .setValue('default')
          .setEmoji('🎫')
          .setDefault(false)
      );
    }

    select.addOptions(options);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Builds the Interactive Staff Setup Panel for managing & deploying ticket panels
 */
export async function renderPanelManagerDashboard(guildOrOpts, selectedPanelId = null) {
  const guild = guildOrOpts?.guild || guildOrOpts;
  const targetPanelId = guildOrOpts?.selectedPanelId || selectedPanelId || null;

  const [panels, categories] = await Promise.all([
    getTicketPanels(guild.id),
    ensureDefaultCategories(guild.id)
  ]);

  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## 🎫 Ticket Panel Management\n` +
      `Create, customize, and deploy ticket creation panels anywhere across **${format.escapeMarkdown(guild.name)}**.`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const activePanel = panels.find(p => p.id === targetPanelId) || panels[0] || null;

  if (activePanel) {
    const channelRef = activePanel.channel_id ? `<#${activePanel.channel_id}>` : '*Not deployed*';
    const messageRef = activePanel.message_id ? `\`${activePanel.message_id}\`` : '*None*';
    const catCount = activePanel.category_ids?.length || categories.length;

    const bannerStatus = activePanel.banner_url ? `[View Banner](${activePanel.banner_url})` : '`None`';
    const thumbStatus = activePanel.thumbnail_url ? `[View Thumbnail](${activePanel.thumbnail_url})` : '`None`';

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 📌 Active Panel: **${format.escapeMarkdown(activePanel.title)}**\n` +
        `• **Target Channel:** ${channelRef}\n` +
        `• **Panel Message ID:** ${messageRef}\n` +
        `• **Interaction Style:** \`${activePanel.style.toUpperCase()}\` (Dropdown vs Buttons)\n` +
        `• **Categories Assigned:** \`${catCount}\` categories available\n` +
        `• **Banner:** ${bannerStatus}\n` +
        `• **Thumbnail:** ${thumbStatus}`
      )
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `ℹ️ *No ticket panels exist yet on this server. Click **Create Panel** below to get started.*`
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  // Row 1: Panel Selection (if multiple)
  if (panels.length > 1) {
    const panelSelect = new StringSelectMenuBuilder()
      .setCustomId('tkt:mgr:panel_sel')
      .setPlaceholder('Switch active panel...')
      .addOptions(
        panels.slice(0, 25).map(p => 
          new StringSelectMenuOptionBuilder()
            .setLabel(p.title.slice(0, 100))
            .setDescription(`Deployed in: ${p.channel_id ? `#${guild.channels.cache.get(p.channel_id)?.name || p.channel_id}` : 'Draft'}`)
            .setValue(p.id)
            .setDefault(p.id === activePanel?.id)
        )
      );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(panelSelect));
  }

  // Row 2: Target Channel Selector for Deploying
  if (activePanel) {
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId(`tkt:mgr:deploy_chan:${activePanel.id}`)
      .setPlaceholder('Deploy / Publish this panel to text channel...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));

    // Row 3: Category Multi-Select for this Panel
    if (categories.length > 0) {
      const catSelect = new StringSelectMenuBuilder()
        .setCustomId(`tkt:mgr:cat_sel:${activePanel.id}`)
        .setPlaceholder('Select categories to include in this panel...')
        .setMinValues(1)
        .setMaxValues(Math.min(categories.length, 25))
        .addOptions(
          categories.slice(0, 25).map(c =>
            new StringSelectMenuOptionBuilder()
              .setLabel(c.name.slice(0, 100))
              .setValue(c.id)
              .setDescription(c.description ? c.description.slice(0, 100) : 'Ticket Category')
              .setEmoji(c.emoji || '📁')
              .setDefault(Array.isArray(activePanel.category_ids) && activePanel.category_ids.includes(c.id))
          )
        );
      container.addActionRowComponents(new ActionRowBuilder().addComponents(catSelect));
    }
  }

  // Row 4: Action Buttons (Max 5 buttons per ActionRow)
  const buttonsRow = new ActionRowBuilder().addComponents(
    ...(activePanel ? [
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:edit_btn:${activePanel.id}`)
        .setLabel('Edit Content')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:img_btn:${activePanel.id}`)
        .setLabel('Set Images')
        .setEmoji('🖼️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:style_btn:${activePanel.id}`)
        .setLabel(`Style: ${activePanel.style === 'buttons' ? 'Select' : 'Buttons'}`)
        .setEmoji('🎛️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('tkt:mgr:create_btn')
        .setLabel('New Panel')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:del_btn:${activePanel.id}`)
        .setLabel('Delete')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Secondary)
    ] : [
      new ButtonBuilder()
        .setCustomId('tkt:mgr:create_btn')
        .setLabel('Create Panel')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Secondary)
    ])
  );

  container.addActionRowComponents(buttonsRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * In-memory map of active drag & drop image uploads
 * userId -> { panelId, type: 'banner'|'thumbnail', channelId, expiresAt }
 */
export const pendingPanelUploads = new Map();

/**
 * Renders the interactive Components V2 image configuration screen for a panel
 */
export async function renderPanelImageConfigCard(guildOrOpts, panelId) {
  const guild = guildOrOpts?.guild || guildOrOpts;
  const panel = await getTicketPanel(panelId);

  const container = new ContainerBuilder();

  // Top banner preview if set
  if (panel?.banner_url) {
    try {
      const media = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(panel.banner_url)
      );
      container.addMediaGalleryComponents(media);
      container.addSeparatorComponents(new SeparatorBuilder());
    } catch (_) {}
  }

  const titleText = `## 🖼️ Panel Image Settings: **${format.escapeMarkdown(panel?.title || 'Support Tickets')}**`;
  if (panel?.thumbnail_url) {
    try {
      const headerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(panel.thumbnail_url));
      container.addSectionComponents(headerSection);
    } catch (_) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(titleText));
  }

  container.addSeparatorComponents(new SeparatorBuilder());

  const bannerStatus = panel?.banner_url ? `[View Banner](${panel.banner_url})` : '`None`';
  const thumbStatus = panel?.thumbnail_url ? `[View Thumbnail](${panel.thumbnail_url})` : '`None`';

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Customize artwork for this ticket creation panel. You can **drag & drop** or upload image files directly into this channel, or enter external URLs.\n\n` +
      `• **Top Media Banner:** ${bannerStatus}\n` +
      `  *Renders as a wide header card banner.*\n` +
      `• **Header Thumbnail:** ${thumbStatus}\n` +
      `  *Renders as an accessory icon beside the panel heading.*\n\n` +
      `💡 **Drag & Drop Upload:** Click an upload button below, then drag & drop your image file into this channel!`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // Row 1: Upload (Drag & Drop) and URL Modal
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tkt:mgr:arm_drop:${panel.id}:banner`)
      .setLabel('Upload Banner (Drag & Drop)')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tkt:mgr:arm_drop:${panel.id}:thumbnail`)
      .setLabel('Upload Thumbnail (Drag & Drop)')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tkt:mgr:img_modal_open:${panel.id}`)
      .setLabel('Enter URLs')
      .setEmoji('🔗')
      .setStyle(ButtonStyle.Secondary)
  );

  // Row 2: Clear and Back
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tkt:mgr:clear_images:${panel.id}`)
      .setLabel('Clear Images')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tkt:mgr:back_dash:${panel.id}`)
      .setLabel('Back to Dashboard')
      .setEmoji('⬅️')
      .setStyle(ButtonStyle.Secondary)
  );

  container.addActionRowComponents(row1, row2);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Catches dropped image uploads in channels for armed panel customization
 * @param {import('discord.js').Message} message
 * @returns {Promise<boolean>} True if handled
 */
export async function handleTicketImageDrop(message) {
  if (!message || message.author?.bot || !message.guild || !message.attachments || message.attachments.size === 0) {
    return false;
  }

  const pending = pendingPanelUploads.get(message.author.id);
  if (!pending) return false;

  // Validate channel match and 60-second window
  if (pending.channelId !== message.channel.id || Date.now() > pending.expiresAt) {
    pendingPanelUploads.delete(message.author.id);
    return false;
  }

  // Find image attachment
  const attachment = message.attachments.find(a =>
    a.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(a.name || '')
  );

  if (!attachment) {
    return false;
  }

  pendingPanelUploads.delete(message.author.id);

  const { panelId, type } = pending;
  const panel = await getTicketPanel(panelId);
  if (!panel) return false;

  const updateFields = type === 'banner'
    ? { banner_url: attachment.url }
    : { thumbnail_url: attachment.url };

  const updated = await saveTicketPanel({
    ...panel,
    ...updateFields
  });

  // If panel is already deployed to Discord, update the live message
  if (panel.channel_id && panel.message_id) {
    try {
      const targetChan = message.guild.channels.cache.get(panel.channel_id);
      const msg = await targetChan?.messages.fetch(panel.message_id).catch(() => null);
      if (msg) {
        const categories = await getTicketCategories(message.guild.id);
        const updatedCard = await buildPublishedPanelCard({ panel: updated, categories });
        await msg.edit(updatedCard).catch(() => {});
      }
    } catch (_) {}
  }

  // Delete raw file message to keep channel clean
  await message.delete().catch(() => {});

  // Send pure Components V2 confirmation card
  const typeLabel = type === 'banner' ? 'Banner' : 'Thumbnail';
  await message.channel.send(successCard({
    title: `${typeLabel} Image Set`,
    subtitle: `Successfully saved ${typeLabel.toLowerCase()} image for **${format.escapeMarkdown(panel.title)}** via drag & drop.`,
    body: `[Preview Image](${attachment.url})`
  })).catch(() => {});

  return true;
}

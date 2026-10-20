import {
  ContainerBuilder,
  TextDisplayBuilder,
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
import { getTicketCategories, getTicketPanels, getTicketPanel, saveTicketPanel, deleteTicketPanel } from '../../db/tickets.js';
import { ensureDefaultCategories } from './categories.js';

/**
 * Builds the public Components V2 Ticket Panel message to be deployed in channels
 */
export async function buildPublishedPanelCard({ panel, categories = [] }) {
  const container = new ContainerBuilder();

  // 1. Header Section
  const headingText = `## ${panel.button_emoji || '🎫'} ${panel.title || 'Support Tickets'}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headingText));

  container.addSeparatorComponents(new SeparatorBuilder());

  // 2. Banner Image (MediaGalleryBuilder)
  if (panel.banner_url) {
    try {
      const media = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(panel.banner_url)
      );
      container.addMediaGalleryComponents(media);
      container.addSeparatorComponents(new SeparatorBuilder());
    } catch (_) {}
  }

  // 3. Description Section
  const desc = panel.description || 'Need help or have questions? Open a ticket below to speak directly with our staff team.';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${desc}\n\n` +
      `-# ⚡ *Our support team responds promptly during active hours.*`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // Filter categories enabled for this panel
  const enabledCategories = categories.filter(c => 
    c.is_enabled !== false &&
    (!panel.category_ids?.length || panel.category_ids.includes(c.id))
  );

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
          .setStyle(ButtonStyle.Primary)
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
        .setStyle(ButtonStyle.Primary)
    );
    container.addActionRowComponents(singleRow);

  } else {
    // Default 'select' dropdown layout
    const select = new StringSelectMenuBuilder()
      .setCustomId(`tkt:panel:sel:${panel.id}`)
      .setPlaceholder('Select a ticket category to open...');

    const options = enabledCategories.slice(0, 25).map(cat => {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(cat.name.slice(0, 100))
        .setValue(cat.id);

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
export async function renderPanelManagerDashboard(guild, selectedPanelId = null) {
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

  const activePanel = panels.find(p => p.id === selectedPanelId) || panels[0] || null;

  if (activePanel) {
    const channelRef = activePanel.channel_id ? `<#${activePanel.channel_id}>` : '*Not deployed*';
    const messageRef = activePanel.message_id ? `\`${activePanel.message_id}\`` : '*None*';
    const catCount = activePanel.category_ids?.length || categories.length;

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### 📌 Active Panel: **${format.escapeMarkdown(activePanel.title)}**\n` +
        `• **Target Channel:** ${channelRef}\n` +
        `• **Panel Message ID:** ${messageRef}\n` +
        `• **Interaction Style:** \`${activePanel.style.toUpperCase()}\` (Dropdown vs Buttons)\n` +
        `• **Categories Assigned:** \`${catCount}\` categories available\n` +
        `• **Banner:** ${activePanel.banner_url ? '`Configured`' : '`None`'}`
      )
    );
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `ℹ️ *No ticket panels exist yet on this server. Click **Create New Panel** below to get started.*`
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
  }

  // Row 3: Action Buttons
  const buttonsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('tkt:mgr:create_btn')
      .setLabel('Create Panel')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Primary),
    ...(activePanel ? [
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:edit_btn:${activePanel.id}`)
        .setLabel('Edit Content')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:style_btn:${activePanel.id}`)
        .setLabel(`Style: ${activePanel.style === 'buttons' ? 'Select' : 'Buttons'}`)
        .setEmoji('🎛️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tkt:mgr:del_btn:${activePanel.id}`)
        .setLabel('Delete')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    ] : [])
  );

  container.addActionRowComponents(buttonsRow);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

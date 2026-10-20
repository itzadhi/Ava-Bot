import {
  PermissionFlagsBits,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { ComponentBuilder } from '../../ui/builder.js';
import { errorCard, successCard } from '../../ui/cards.js';

export default {
  name: 'componentbuilder',
  aliases: ['buildcomponent', 'cardbuilder', 'cbuilder', 'embedbuilder'],
  description: 'Build and send modern Discord Components V2 cards, announcements, and button panels',
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  args: [
    {
      name: 'title',
      description: 'Title heading for the component card',
      type: 'string',
      required: false
    },
    {
      name: 'body',
      description: 'Main body description / markdown text for the card',
      type: 'string',
      required: false
    },
    {
      name: 'channel',
      description: 'Channel to send the built component to (default: current channel)',
      type: 'channel',
      required: false
    },
    {
      name: 'thumbnail',
      description: 'Image URL for the right-hand thumbnail',
      type: 'string',
      required: false
    },
    {
      name: 'image',
      description: 'Image URL for the media gallery banner',
      type: 'string',
      required: false
    },
    {
      name: 'button_label',
      description: 'Label for an optional link button',
      type: 'string',
      required: false
    },
    {
      name: 'button_url',
      description: 'HTTP/HTTPS destination URL for the link button',
      type: 'string',
      required: false
    },
    {
      name: 'interactive',
      description: 'Open interactive modal builder (default: true if no title/body provided)',
      type: 'boolean',
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be used inside a Discord server.',
        ephemeral: true
      }));
    }

    const title = ctx.args?.title?.trim();
    const body = ctx.args?.body?.trim();
    const isInteractive = ctx.args?.interactive === true || (!title && !body);
    const targetChannel = ctx.args?.channel || ctx.channel;

    // ── CASE 1: INTERACTIVE MODAL BUILDER ──
    if (isInteractive) {
      if (typeof ctx.showModal !== 'function') {
        return ctx.reply(errorCard({
          title: 'Interactive Modal Unavailable',
          reason: 'Interactive modals can only be opened from slash commands.',
          fix: 'Please provide arguments directly: `!componentbuilder title:"My Card" body:"Content here"`',
          ephemeral: true
        }));
      }

      const modal = new ModalBuilder()
        .setCustomId(`fb:cb:modal:${targetChannel.id}`)
        .setTitle('Components V2 Builder');

      const titleInput = new TextInputBuilder()
        .setCustomId('cb_title')
        .setLabel('Card Title')
        .setStyle(TextInputStyle.Short)
        .setValue(title || '')
        .setPlaceholder('e.g. Server Announcements')
        .setRequired(true)
        .setMaxLength(100);

      const bodyInput = new TextInputBuilder()
        .setCustomId('cb_body')
        .setLabel('Message Body (Markdown Supported)')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(body || '')
        .setPlaceholder('Enter description, lists, rules, or update information...')
        .setRequired(true)
        .setMaxLength(2000);

      const thumbInput = new TextInputBuilder()
        .setCustomId('cb_thumb')
        .setLabel('Thumbnail Image URL (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(ctx.args?.thumbnail || '')
        .setPlaceholder('https://example.com/logo.png')
        .setRequired(false)
        .setMaxLength(256);

      const imgInput = new TextInputBuilder()
        .setCustomId('cb_img')
        .setLabel('Banner Media Image URL (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(ctx.args?.image || '')
        .setPlaceholder('https://example.com/banner.png')
        .setRequired(false)
        .setMaxLength(256);

      const btnInput = new TextInputBuilder()
        .setCustomId('cb_btn')
        .setLabel('Link Button: "Label | https://url" (Optional)')
        .setStyle(TextInputStyle.Short)
        .setValue(
          ctx.args?.button_label && ctx.args?.button_url
            ? `${ctx.args.button_label} | ${ctx.args.button_url}`
            : ''
        )
        .setPlaceholder('e.g. Join Discord | https://discord.gg/example')
        .setRequired(false)
        .setMaxLength(200);

      modal.addComponents(
        new ActionRowBuilder().addComponents(titleInput),
        new ActionRowBuilder().addComponents(bodyInput),
        new ActionRowBuilder().addComponents(thumbInput),
        new ActionRowBuilder().addComponents(imgInput),
        new ActionRowBuilder().addComponents(btnInput)
      );

      return ctx.showModal(modal);
    }

    // ── CASE 2: DIRECT PARAMETER BUILD ──
    const builder = new ComponentBuilder();

    if (title) {
      builder.setTitle(title);
    }

    if (body) {
      if (title) builder.addSeparator();
      builder.addText(body);
    }

    if (ctx.args?.thumbnail) {
      builder.setThumbnail(ctx.args.thumbnail.trim());
    }

    if (ctx.args?.image) {
      builder.addMediaGallery(ctx.args.image.trim());
    }

    if (ctx.args?.button_label && ctx.args?.button_url) {
      builder.addButton({
        label: ctx.args.button_label.trim(),
        url: ctx.args.button_url.trim()
      });
    }

    const payload = builder.build();

    try {
      if (targetChannel.id === ctx.channel.id && !ctx.isSlash) {
        // Direct prefix invocation in target channel
        return ctx.reply(payload);
      }

      // Send to target channel
      const sent = await targetChannel.send(payload);

      return ctx.reply(successCard({
        title: 'Component Message Sent',
        subtitle: `Successfully deployed to <#${targetChannel.id}>`,
        details: [
          { label: 'Channel', value: `<#${targetChannel.id}>` },
          { label: 'Message Link', value: sent.url ? `[Jump to Message](${sent.url})` : 'Sent' }
        ],
        ephemeral: true
      }));
    } catch (err) {
      return ctx.reply(errorCard({
        title: 'Failed to Send Component',
        reason: err.message,
        ephemeral: true
      }));
    }
  }
};

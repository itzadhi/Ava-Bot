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
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  MessageFlags
} from 'discord.js';
import { THEME, getBrandAttachment } from './theme.js';

/**
 * Fluent, chainable builder for Discord Components V2.
 * Simplifies constructing rich Containers, TextDisplays, Separators, Sections, MediaGalleries,
 * and ActionRows with automatic row-chunking and V2 message flag compliance.
 */
export class ComponentBuilder {
  constructor() {
    this.container = new ContainerBuilder();
    this.files = [];
    this.pendingButtons = [];
    this.actionRows = [];
    this.isEphemeral = false;
    this._hasHeader = false;
  }

  /**
   * Static factory method to instantiate a new builder
   * @returns {ComponentBuilder}
   */
  static create() {
    return new ComponentBuilder();
  }

  /**
   * Sets top header title with optional glyph and markdown formatting
   * @param {string} title
   * @param {string} [glyph='']
   * @returns {ComponentBuilder}
   */
  setTitle(title, glyph = '') {
    if (!title) return this;
    let clean = title.trim();
    if (glyph && !clean.startsWith(glyph)) {
      clean = `${glyph} ${clean}`;
    }
    if (!clean.startsWith('## ') && !clean.startsWith('# ') && !clean.startsWith('### ')) {
      clean = `## ${clean}`;
    }
    this.addText(clean);
    this._hasHeader = true;
    return this;
  }

  /**
   * Sets subtitle / description directly under the title
   * @param {string} subtitle
   * @returns {ComponentBuilder}
   */
  setSubtitle(subtitle) {
    if (!subtitle) return this;
    this.addText(subtitle.trim());
    return this;
  }

  /**
   * Adds a TextDisplay block to the container
   * @param {string} content
   * @returns {ComponentBuilder}
   */
  addText(content) {
    if (!content) return this;
    const str = String(content);
    const safeContent = str.length > 4000 ? str.slice(0, 3997) + '...' : str;
    this.container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(safeContent)
    );
    return this;
  }

  /**
   * Alias for addText
   * @param {string} content
   * @returns {ComponentBuilder}
   */
  text(content) {
    return this.addText(content);
  }

  /**
   * Adds a horizontal separator divider
   * @param {boolean} [divider=true]
   * @returns {ComponentBuilder}
   */
  addSeparator(divider = true) {
    this.container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(divider)
    );
    return this;
  }

  /**
   * Alias for addSeparator
   * @param {boolean} [divider=true]
   * @returns {ComponentBuilder}
   */
  separator(divider = true) {
    return this.addSeparator(divider);
  }

  /**
   * Sets a thumbnail image
   * @param {string} url
   * @returns {ComponentBuilder}
   */
  setThumbnail(url) {
    if (!url) return this;
    if (url.startsWith('attachment://logo.jpg')) {
      const brand = getBrandAttachment();
      if (brand) this.files.push(brand);
    }
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(' '))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(url));
    this.container.addSectionComponents(section);
    return this;
  }

  /**
   * Adds a Section with text and optional accessory (thumbnail or button)
   * @param {string} text
   * @param {object} [accessory]
   * @param {string} [accessory.thumbnail]
   * @param {ButtonBuilder|object} [accessory.button]
   * @returns {ComponentBuilder}
   */
  addSection(text, accessory = null) {
    const section = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(text)
    );

    if (accessory?.thumbnail) {
      section.setThumbnailAccessory(new ThumbnailBuilder().setURL(accessory.thumbnail));
    } else if (accessory?.button) {
      const btn = accessory.button instanceof ButtonBuilder
        ? accessory.button
        : this._createButton(accessory.button);
      section.setButtonAccessory(btn);
    }

    this.container.addSectionComponents(section);
    return this;
  }

  /**
   * Adds a Media Gallery displaying one or more image items
   * @param {string|string[]} images
   * @returns {ComponentBuilder}
   */
  addMediaGallery(images) {
    const list = Array.isArray(images) ? images : [images];
    const valid = list.filter(Boolean);
    if (valid.length === 0) return this;

    const gallery = new MediaGalleryBuilder();
    for (const url of valid) {
      gallery.addItems(
        new MediaGalleryItemBuilder().setURL(url)
      );
    }
    this.container.addMediaGalleryComponents(gallery);
    return this;
  }

  /**
   * Adds an interactive Button to be included in an ActionRow
   * @param {object|ButtonBuilder} options
   * @param {string} [options.id]
   * @param {string} [options.customId]
   * @param {string} [options.label]
   * @param {number|string} [options.style=ButtonStyle.Secondary]
   * @param {string} [options.emoji]
   * @param {string} [options.url]
   * @param {boolean} [options.disabled=false]
   * @returns {ComponentBuilder}
   */
  addButton(options) {
    if (!options) return this;
    const btn = options instanceof ButtonBuilder ? options : this._createButton(options);
    this.pendingButtons.push(btn);
    return this;
  }

  /**
   * Alias for addButton
   */
  button(options) {
    return this.addButton(options);
  }

  /**
   * Adds multiple buttons at once
   * @param {Array<object|ButtonBuilder>} buttons
   * @returns {ComponentBuilder}
   */
  addButtons(buttons) {
    if (Array.isArray(buttons)) {
      for (const b of buttons) {
        this.addButton(b);
      }
    }
    return this;
  }

  /**
   * Adds a String Select Menu in its own ActionRow
   * @param {object} options
   * @param {string} options.id
   * @param {string} [options.placeholder]
   * @param {Array<{ label: string, value: string, description?: string, emoji?: string, default?: boolean }>} options.options
   * @param {number} [options.minValues=1]
   * @param {number} [options.maxValues=1]
   * @param {boolean} [options.disabled=false]
   * @returns {ComponentBuilder}
   */
  addStringSelect(options) {
    this._flushButtons();
    const select = new StringSelectMenuBuilder()
      .setCustomId(options.id || options.customId)
      .setPlaceholder(options.placeholder || 'Select an option...')
      .setMinValues(options.minValues ?? 1)
      .setMaxValues(options.maxValues ?? 1)
      .setDisabled(Boolean(options.disabled));

    if (Array.isArray(options.options)) {
      select.addOptions(options.options.slice(0, 25));
    }

    const row = new ActionRowBuilder().addComponents(select);
    this.actionRows.push(row);
    return this;
  }

  /**
   * Adds a Channel Select Menu in its own ActionRow
   * @param {object} options
   * @param {string} options.id
   * @param {string} [options.placeholder]
   * @param {number[]} [options.channelTypes]
   * @param {number} [options.minValues=1]
   * @param {number} [options.maxValues=1]
   * @param {boolean} [options.disabled=false]
   * @returns {ComponentBuilder}
   */
  addChannelSelect(options) {
    this._flushButtons();
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(options.id || options.customId)
      .setPlaceholder(options.placeholder || 'Select a channel...')
      .setMinValues(options.minValues ?? 1)
      .setMaxValues(options.maxValues ?? 1)
      .setDisabled(Boolean(options.disabled));

    if (Array.isArray(options.channelTypes) && options.channelTypes.length > 0) {
      select.setChannelTypes(options.channelTypes);
    }

    const row = new ActionRowBuilder().addComponents(select);
    this.actionRows.push(row);
    return this;
  }

  /**
   * Adds a Role Select Menu in its own ActionRow
   * @param {object} options
   * @returns {ComponentBuilder}
   */
  addRoleSelect(options) {
    this._flushButtons();
    const select = new RoleSelectMenuBuilder()
      .setCustomId(options.id || options.customId)
      .setPlaceholder(options.placeholder || 'Select a role...')
      .setMinValues(options.minValues ?? 1)
      .setMaxValues(options.maxValues ?? 1)
      .setDisabled(Boolean(options.disabled));

    const row = new ActionRowBuilder().addComponents(select);
    this.actionRows.push(row);
    return this;
  }

  /**
   * Adds a User Select Menu in its own ActionRow
   * @param {object} options
   * @returns {ComponentBuilder}
   */
  addUserSelect(options) {
    this._flushButtons();
    const select = new UserSelectMenuBuilder()
      .setCustomId(options.id || options.customId)
      .setPlaceholder(options.placeholder || 'Select a user...')
      .setMinValues(options.minValues ?? 1)
      .setMaxValues(options.maxValues ?? 1)
      .setDisabled(Boolean(options.disabled));

    const row = new ActionRowBuilder().addComponents(select);
    this.actionRows.push(row);
    return this;
  }

  /**
   * Adds an ActionRow directly
   * @param {ActionRowBuilder} row
   * @returns {ComponentBuilder}
   */
  addRow(row) {
    if (row instanceof ActionRowBuilder) {
      this._flushButtons();
      this.actionRows.push(row);
    }
    return this;
  }

  /**
   * Attaches a file attachment to the message payload
   * @param {import('discord.js').AttachmentBuilder|object} file
   * @returns {ComponentBuilder}
   */
  addFile(file) {
    if (file) this.files.push(file);
    return this;
  }

  /**
   * Marks the response as ephemeral
   * @param {boolean} [ephemeral=true]
   * @returns {ComponentBuilder}
   */
  setEphemeral(ephemeral = true) {
    this.isEphemeral = Boolean(ephemeral);
    return this;
  }

  /**
   * Internal helper to create a ButtonBuilder from plain options
   * @private
   */
  _createButton(opts) {
    const btn = new ButtonBuilder();
    if (opts.url) {
      btn.setURL(opts.url).setStyle(ButtonStyle.Link);
    } else {
      const rawId = String(opts.id || opts.customId || `btn_${Date.now()}`);
      btn.setCustomId(rawId.slice(0, 100));
      btn.setStyle(this._resolveButtonStyle(opts.style));
    }

    if (opts.label) btn.setLabel(String(opts.label));
    if (opts.emoji) btn.setEmoji(opts.emoji);
    if (opts.disabled !== undefined) btn.setDisabled(Boolean(opts.disabled));

    return btn;
  }

  /**
   * Internal helper to resolve string styles to numeric ButtonStyle
   * @private
   */
  _resolveButtonStyle(style) {
    if (style === ButtonStyle.Link || String(style || '').toLowerCase() === 'link') {
      return ButtonStyle.Link;
    }
    return ButtonStyle.Secondary;
  }

  /**
   * Chunks pending buttons into ActionRows of max 5 buttons each
   * @private
   */
  _flushButtons() {
    if (this.pendingButtons.length === 0) return;

    for (let i = 0; i < this.pendingButtons.length; i += 5) {
      const chunk = this.pendingButtons.slice(i, i + 5);
      const row = new ActionRowBuilder().addComponents(...chunk);
      this.actionRows.push(row);
    }

    this.pendingButtons = [];
  }

  /**
   * Compiles and builds the final Discord Components V2 message payload
   * @returns {{ flags: number, components: [ContainerBuilder], files: any[], ephemeral?: boolean }}
   */
  build() {
    this._flushButtons();

    // Append action rows to container
    for (const row of this.actionRows) {
      this.container.addActionRowComponents(row);
    }
    this.actionRows = [];

    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components: [this.container]
    };

    if (this.files.length > 0) {
      payload.files = this.files;
    }

    if (this.isEphemeral) {
      payload.ephemeral = true;
    }

    return payload;
  }

  /**
   * Alias for build()
   */
  toMessagePayload() {
    return this.build();
  }

  /**
   * Returns JSON representation of the built container
   */
  toJSON() {
    return this.build().components[0].toJSON();
  }

  /**
   * Quick factory to build a standard Components V2 message in one call
   * @param {object} options
   * @param {string} [options.title]
   * @param {string} [options.body]
   * @param {string} [options.thumbnail]
   * @param {string} [options.image]
   * @param {Array<object>} [options.buttons]
   * @returns {{ flags: number, components: [ContainerBuilder] }}
   */
  static quick({ title, body, thumbnail, image, buttons = [], color = null }) {
    const builder = new ComponentBuilder();
    if (title) builder.setTitle(title);
    if (body) {
      if (title) builder.addSeparator();
      builder.addText(body);
    }
    if (thumbnail) builder.setThumbnail(thumbnail);
    if (image) builder.addMediaGallery(image);
    if (buttons && buttons.length > 0) builder.addButtons(buttons);
    // Containers remain borderless dark cards without accent colors
    return builder.build();
  }
}

export default ComponentBuilder;

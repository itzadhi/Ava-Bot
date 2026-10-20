import { MessageFlags, ComponentType } from 'discord.js';
import { loadingCard, errorCard, successCard, infoCard, listCard } from '../ui/cards.js';
import { getBrandAttachment } from '../ui/theme.js';

export class CommandContext {
  /**
   * @param {object} options
   * @param {import('discord.js').Client} options.client
   * @param {import('discord.js').ChatInputCommandInteraction|null} options.interaction
   * @param {import('discord.js').Message|null} options.message
   * @param {Record<string, any>} options.args
   * @param {string} options.prefix
   */
  constructor({ client, interaction = null, message = null, args = {}, prefix = 'a!' }) {
    this.client = client;
    this.interaction = interaction;
    this.message = message;
    this.args = args;
    this.prefix = prefix;
    this.isSlash = Boolean(interaction);

    this.user = interaction ? interaction.user : message.author;
    this.member = interaction ? interaction.member : message.member;
    this.guild = interaction ? interaction.guild : message.guild;
    this.channel = interaction ? interaction.channel : message.channel;

    this.deferred = false;
    this.replied = false;
    this.replyMessage = null; // Store reference to bot's response message
  }

  /**
   * Triggers typing in text channel for prefix commands, or defers slash interaction
   * @param {boolean} ephemeral
   */
  async defer(ephemeral = false) {
    if (this.deferred || this.replied) return;

    if (this.isSlash) {
      await this.interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
      this.deferred = true;
    } else {
      if (this.channel?.sendTyping) {
        try {
          await this.channel.sendTyping();
        } catch (_) {}
      }
      // Send an initial loadingCard
      const payload = loadingCard({ ephemeral: false });
      this.replyMessage = await this.message.reply({
        ...payload,
        allowedMentions: { repliedUser: false }
      });
      this.deferred = true;
      this.replied = true;
    }
  }

  /**
   * Replies to the command invocation with a Components V2 payload
   * @param {object} cardPayload 
   * @returns {Promise<any>}
   */
  async reply(cardPayload) {
    if (this.isSlash) {
      if (this.deferred) {
        this.replied = true;
        return this.interaction.editReply(cardPayload);
      }
      this.replied = true;
      return this.interaction.reply(cardPayload);
    } else {
      if (this.deferred && this.replyMessage) {
        return this.replyMessage.edit(cardPayload);
      }
      this.replyMessage = await this.message.reply({
        ...cardPayload,
        allowedMentions: { repliedUser: false }
      });
      this.replied = true;
      return this.replyMessage;
    }
  }

  /**
   * Replies with a card payload along with the Argoni brand logo attachment
   * @param {object} cardPayload
   */
  async replyWithLogo(cardPayload) {
    const attachment = getBrandAttachment();
    const payload = {
      ...cardPayload,
      files: attachment ? [attachment] : []
    };
    return this.reply(payload);
  }

  /**
   * Edits the existing response message in place
   * @param {object} cardPayload 
   * @returns {Promise<any>}
   */
  async edit(cardPayload) {
    if (this.isSlash) {
      return this.interaction.editReply(cardPayload);
    } else {
      if (this.replyMessage) {
        return this.replyMessage.edit(cardPayload);
      }
      return this.reply(cardPayload);
    }
  }

  /**
   * Sends an error card reply
   * @param {string} reason 
   * @param {string} fix 
   * @param {boolean} ephemeral 
   */
  async replyError(reason, fix, ephemeral = true) {
    const payload = errorCard({
      reason,
      fix,
      ephemeral
    });
    return this.reply(payload);
  }

  /**
   * Sends a success card reply
   * @param {object} options
   */
  async replySuccess(options) {
    return this.reply(successCard(options));
  }

  /**
   * Sends an info card reply
   * @param {object} options
   */
  async replyInfo(options) {
    return this.reply(infoCard(options));
  }

  /**
   * Displays a modal to the user (Slash commands only)
   * @param {import('discord.js').ModalBuilder} modal
   */
  async showModal(modal) {
    if (!this.isSlash) {
      return this.replyError(
        'Modals are only supported via slash commands.',
        `Please invoke this command using /${this.interaction?.commandName || 'command'}.`
      );
    }
    return this.interaction.showModal(modal);
  }

  /**
   * Interactive paginator using Components V2 list cards
   * @param {object} options
   * @param {string} options.title
   * @param {Array<string>} options.items
   * @param {number} [options.pageSize=5]
   * @param {number} [options.time=120000]
   */
  async paginate({ title, items, pageSize = 5, time = 120000 }) {
    const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
    let currentPage = 1;
    const customPrefix = `page_${Date.now()}`;

    const render = (page) => {
      const start = (page - 1) * pageSize;
      const slice = items.slice(start, start + pageSize);
      return listCard({
        title,
        items: slice,
        page,
        totalPages,
        customIdPrefix: customPrefix
      });
    };

    await this.reply(render(currentPage));

    let active = true;
    while (active) {
      const interaction = await this.awaitComponent({
        time,
        filter: (i) => i.customId.startsWith(customPrefix)
      });

      if (!interaction) {
        active = false;
        await this.cleanupComponents(true);
        break;
      }

      if (interaction.customId.includes(':next:')) {
        currentPage = Math.min(currentPage + 1, totalPages);
      } else if (interaction.customId.includes(':prev:')) {
        currentPage = Math.max(currentPage - 1, 1);
      }

      await interaction.update(render(currentPage));
    }
  }

  /**
   * Waits for a component interaction (button or select menu)
   * Only the invoking user can interact; other users receive ephemeral "This isn't for you."
   * @param {object} options
   * @param {number} [options.time=60000]
   * @param {Function} [options.filter]
   * @returns {Promise<import('discord.js').MessageComponentInteraction|null>}
   */
  async awaitComponent({ time = 60000, filter = null } = {}) {
    let targetMessage = null;

    if (this.isSlash) {
      targetMessage = await this.interaction.fetchReply().catch(() => null);
    } else {
      targetMessage = this.replyMessage;
    }

    if (!targetMessage) return null;

    try {
      const collector = targetMessage.createMessageComponentCollector({
        time,
        filter: async (i) => {
          if (i.user.id !== this.user.id) {
            await i.reply({
              flags: MessageFlags.Ephemeral,
              content: "This isn't for you."
            }).catch(() => {});
            return false;
          }
          return filter ? filter(i) : true;
        },
        max: 1
      });

      return new Promise((resolve) => {
        collector.on('collect', (interaction) => {
          resolve(interaction);
        });
        collector.on('end', (collected, reason) => {
          if (collected.size === 0) {
            resolve(null);
          }
        });
      });
    } catch (_) {
      return null;
    }
  }

  /**
   * Removes or disables components after an interaction completes or times out
   * @param {boolean} remove If true, removes components, else disables buttons
   */
  async cleanupComponents(remove = true) {
    try {
      if (remove) {
        await this.edit({ components: [] });
      }
    } catch (_) {}
  }
}

export default CommandContext;

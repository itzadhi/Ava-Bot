import { MessageFlags, ComponentType } from 'discord.js';
import { loadingCard, errorCard, successCard, infoCard, listCard } from '../ui/cards.js';
import { getBrandAttachment } from '../ui/theme.js';
import { safeRespond } from '../core/interactions/safeRespond.js';
import { sessionStore } from '../core/interactions/session.js';

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

    this.deferred = Boolean(interaction?.deferred);
    this.replied = Boolean(interaction?.replied);
    this.replyMessage = null; // Store reference to bot's response message
  }

  /**
   * Triggers typing in text channel for prefix commands, or defers slash interaction
   * @param {boolean} ephemeral
   */
  async defer(ephemeral = false) {
    if (this.deferred || this.replied) return;

    if (this.isSlash) {
      if (!this.interaction.deferred && !this.interaction.replied) {
        await this.interaction.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {}).catch(() => {});
      }
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
      }).catch(() => null);
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
      this.replied = true;
      const res = await safeRespond(this.interaction, cardPayload);
      if (res) this.replyMessage = res;
      return res;
    } else {
      if (this.deferred && this.replyMessage) {
        return this.replyMessage.edit(cardPayload).catch(() => null);
      }
      this.replyMessage = await this.message.reply({
        ...cardPayload,
        allowedMentions: { repliedUser: false }
      }).catch(() => null);
      this.replied = true;
      return this.replyMessage;
    }
  }

  /**
   * Replies with a card payload along with the AVA brand logo attachment
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
      return safeRespond(this.interaction, cardPayload);
    } else {
      if (this.replyMessage) {
        return this.replyMessage.edit(cardPayload).catch(() => null);
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
    const currentPage = 1;

    const session = sessionStore.createSession({
      module: 'pager',
      guildId: this.guild?.id || '0',
      userId: this.user.id,
      data: { title, items, pageSize, totalPages, currentPage },
      ttlMs: time || 60 * 60 * 1000
    });

    const customPrefix = `pager:${session.id}:${this.guild?.id || '0'}:${this.user.id}`;

    const start = (currentPage - 1) * pageSize;
    const slice = items.slice(start, start + pageSize);
    const payload = listCard({
      title,
      items: slice,
      page: currentPage,
      totalPages,
      customIdPrefix: customPrefix
    });

    return await this.reply(payload);
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

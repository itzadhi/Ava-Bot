import { MessageFlags } from 'discord.js';
import { logger } from '../utils/logger.js';
import { logError } from '../db/errors.js';
import { errorCard } from '../ui/cards.js';

/**
 * Registry and dispatcher for Discord Component Interactions (Buttons, Select Menus, Modals)
 */
export class ComponentRegistry {
  constructor() {
    this.handlers = [];
  }

  /**
   * Registers a component or modal interaction handler
   * @param {object} handler
   * @param {string|RegExp} handler.customId String, prefix pattern (e.g. 'foo:*'), or RegExp
   * @param {'button'|'select'|'string_select'|'channel_select'|'role_select'|'user_select'|'mentionable_select'|'modal'|'any'} [handler.type='any']
   * @param {boolean} [handler.authorOnly=false]
   * @param {Function} handler.execute Function(interaction, params)
   */
  register(handler) {
    if (!handler.customId) {
      throw new Error('Component handler requires a customId pattern');
    }
    if (typeof handler.execute !== 'function') {
      throw new Error(`Component handler for "${handler.customId}" requires an execute function`);
    }

    let pattern;
    if (handler.customId instanceof RegExp) {
      pattern = handler.customId;
    } else if (typeof handler.customId === 'string' && handler.customId.includes('*')) {
      // Convert wildcard pattern like 'list:*' or 'btn:*:action' to RegExp
      const escaped = handler.customId.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '([^:]+)');
      pattern = new RegExp(`^${escaped}$`);
    } else {
      pattern = handler.customId;
    }

    const entry = {
      pattern,
      originalPattern: handler.customId,
      type: handler.type || 'any',
      authorOnly: Boolean(handler.authorOnly),
      execute: handler.execute
    };

    const existingIdx = this.handlers.findIndex(h => String(h.originalPattern) === String(handler.customId));
    if (existingIdx !== -1) {
      this.handlers[existingIdx] = entry;
    } else {
      this.handlers.push(entry);
    }

    logger.debug(`Registered component handler for: ${handler.customId} (${handler.type || 'any'})`);
  }

  /**
   * Resolves a handler for a given interaction
   * @param {import('discord.js').Interaction} interaction
   * @returns {{ handler: object, params: Array<string>|null }|null}
   */
  resolve(interaction) {
    const customId = interaction.customId;
    if (!customId) return null;

    for (const h of this.handlers) {
      // Verify component type
      if (h.type !== 'any') {
        if (h.type === 'button' && !interaction.isButton()) continue;
        if (h.type === 'modal' && !interaction.isModalSubmit()) continue;
        if (h.type === 'select' && !interaction.isAnySelectMenu()) continue;
        if (h.type === 'string_select' && !interaction.isStringSelectMenu()) continue;
        if (h.type === 'channel_select' && !interaction.isChannelSelectMenu()) continue;
        if (h.type === 'role_select' && !interaction.isRoleSelectMenu()) continue;
        if (h.type === 'user_select' && !interaction.isUserSelectMenu()) continue;
        if (h.type === 'mentionable_select' && !interaction.isMentionableSelectMenu()) continue;
      }

      // Check match
      if (typeof h.pattern === 'string') {
        if (h.pattern === customId) {
          return { handler: h, params: [] };
        }
      } else if (h.pattern instanceof RegExp) {
        const match = customId.match(h.pattern);
        if (match) {
          return { handler: h, params: match.slice(1) };
        }
      }
    }

    return null;
  }

  /**
   * Dispatches an interaction to its registered handler
   * @param {import('discord.js').Interaction} interaction
   * @returns {Promise<boolean>} True if handled, false if no handler found
   */
  async dispatch(interaction) {
    const resolved = this.resolve(interaction);
    if (!resolved) return false;

    const { handler, params } = resolved;

    try {
      // Author-only check
      if (handler.authorOnly) {
        const originalAuthorId = interaction.message?.interaction?.user?.id;
        if (originalAuthorId && interaction.user.id !== originalAuthorId) {
          if (typeof interaction.reply === 'function') {
            await interaction.reply(errorCard({
              title: 'Component Restricted',
              reason: "You cannot interact with this component because you didn't initiate the command.",
              fix: 'Run the command yourself to use its interactive components.',
              ephemeral: true
            })).catch(() => {});
          }
          return true;
        }
      }

      await handler.execute(interaction, params);
      return true;
    } catch (err) {
      logger.error({ err, customId: interaction.customId }, 'Error dispatching component interaction');
      await logError({
        scope: `component:${interaction.customId}`,
        message: err.message,
        stack: err.stack
      });

      const errPayload = errorCard({
        title: 'Interaction Failed',
        subtitle: 'Unable to process component action.',
        reason: 'An unexpected internal error occurred.',
        fix: 'Please try again in a moment.',
        ephemeral: true
      });

      if (interaction.deferred || interaction.replied) {
        await interaction.followUp?.(errPayload).catch(() => {});
      } else {
        await interaction.reply?.(errPayload).catch(() => {});
      }
      return true;
    }
  }

  /**
   * Clears all registered handlers
   */
  clear() {
    this.handlers = [];
  }
}

export const componentRegistry = new ComponentRegistry();

/**
 * Convenience helper to define and register a component handler
 * @param {string|RegExp} customId
 * @param {'button'|'select'|'modal'|'any'} type
 * @param {Function} execute
 * @param {object} [options]
 */
export function defineComponent(customId, type, execute, options = {}) {
  const handler = { customId, type, execute, ...options };
  componentRegistry.register(handler);
  return handler;
}

export default componentRegistry;

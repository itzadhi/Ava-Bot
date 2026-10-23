import { logger } from '../../utils/logger.js';

/**
 * High-performance O(1) Component and Autocomplete Handler Registry
 */
export class FastInteractionRegistry {
  constructor() {
    /** @type {Map<string, { handler: Function, meta: object }>} */
    this.components = new Map();
    /** @type {Map<string, { handler: Function, meta: object }>} */
    this.prefixComponents = new Map();
    /** @type {Map<string, Function>} */
    this.autocompletes = new Map();
  }

  /**
   * Registers a component handler for buttons, select menus, or modals
   * @param {string} key 'module:action' or 'module:*'
   * @param {Function} handler async (interaction, parsed) => void
   * @param {object} [meta={}]
   * @param {boolean} [meta.opensModal=false] True if handler responds with showModal()
   * @param {boolean} [meta.authorOnly=false] True if only initiator can click
   * @param {boolean} [meta.instant=false] True if command/component answers <500ms from cache without defer
   * @param {boolean} [meta.ephemeral=false] True if response is ephemeral
   */
  registerComponent(key, handler, meta = {}) {
    if (!key || typeof key !== 'string') {
      throw new Error('Component key must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new Error(`Handler for component "${key}" must be a function`);
    }

    const entry = {
      handler,
      meta: {
        opensModal: Boolean(meta.opensModal),
        authorOnly: Boolean(meta.authorOnly),
        instant: Boolean(meta.instant),
        ephemeral: Boolean(meta.ephemeral),
        ...meta
      }
    };

    if (key.endsWith(':*')) {
      const prefix = key.slice(0, -2);
      this.prefixComponents.set(prefix, entry);
    } else {
      this.components.set(key, entry);
    }

    logger.debug(`Registered persistent component handler: ${key}`);
  }

  /**
   * Resolves a component handler in O(1) time
   * @param {string} customId
   * @returns {{ handler: Function, meta: object, parsed: object }|null}
   */
  resolveComponent(customId) {
    if (!customId || typeof customId !== 'string') return null;

    // 1. Direct match on full customId
    if (this.components.has(customId)) {
      const entry = this.components.get(customId);
      return { ...entry, parsed: { raw: customId } };
    }

    // 2. Direct match on 'module:action'
    const firstColon = customId.indexOf(':');
    if (firstColon !== -1) {
      const secondColon = customId.indexOf(':', firstColon + 1);
      const modAction = secondColon !== -1 ? customId.substring(0, secondColon) : customId;

      if (this.components.has(modAction)) {
        const entry = this.components.get(modAction);
        return { ...entry, parsed: { modAction, raw: customId } };
      }

      // 3. Prefix match on 'module'
      const moduleName = customId.substring(0, firstColon);
      if (this.prefixComponents.has(moduleName)) {
        const entry = this.prefixComponents.get(moduleName);
        return { ...entry, parsed: { module: moduleName, raw: customId } };
      }
    }

    return null;
  }

  /**
   * Registers an autocomplete handler for slash command options
   * @param {string} commandName
   * @param {string} [optionName=null]
   * @param {Function} handler async (interaction, focusedOption) => Array<{ name: string, value: string|number }>
   */
  registerAutocomplete(commandName, optionName = null, handler) {
    const key = optionName ? `${commandName}:${optionName}` : commandName;
    this.autocompletes.set(key, handler);
    logger.debug(`Registered autocomplete handler for: ${key}`);
  }

  /**
   * Resolves an autocomplete handler
   * @param {string} commandName
   * @param {string} optionName
   * @returns {Function|null}
   */
  resolveAutocomplete(commandName, optionName) {
    const specificKey = `${commandName}:${optionName}`;
    if (this.autocompletes.has(specificKey)) {
      return this.autocompletes.get(specificKey);
    }
    if (this.autocompletes.has(commandName)) {
      return this.autocompletes.get(commandName);
    }
    return null;
  }

  /**
   * Clears registry for testing
   */
  clear() {
    this.components.clear();
    this.prefixComponents.clear();
    this.autocompletes.clear();
  }
}

export const interactionRegistry = new FastInteractionRegistry();
export const registerComponent = (key, handler, meta) => interactionRegistry.registerComponent(key, handler, meta);
export const registerAutocomplete = (cmd, opt, handler) => interactionRegistry.registerAutocomplete(cmd, opt, handler);

export default interactionRegistry;

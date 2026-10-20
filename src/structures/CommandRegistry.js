import {
  SlashCommandBuilder,
  SlashCommandSubcommandBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { logger } from '../utils/logger.js';

export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
    this.categories = new Set();
  }

  /**
   * Registers a command and performs strict startup validation
   * @param {object} command 
   */
  register(command) {
    // 1. Mandatory Fields Validation
    if (!command.name || typeof command.name !== 'string') {
      throw new Error(`Command registration failed: command missing valid name`);
    }

    const name = command.name.toLowerCase();

    if (!command.description || typeof command.description !== 'string') {
      throw new Error(`Command "${name}" missing valid description`);
    }

    if (!command.category || typeof command.category !== 'string') {
      throw new Error(`Command "${name}" missing valid category for registry entry`);
    }

    if (typeof command.execute !== 'function') {
      throw new Error(`Command "${name}" missing execute(ctx) function`);
    }

    // Arguments schema validation
    if (!Array.isArray(command.args) && !Array.isArray(command.subcommands)) {
      throw new Error(`Command "${name}" must provide an args array or subcommands array schema`);
    }

    // 2. Name & Alias Collision Checks
    if (this.commands.has(name)) {
      const existing = this.commands.get(name);
      if (existing === command || existing.name?.toLowerCase() === name) {
        this.commands.set(name, command);
        this.categories.add(command.category);
        return;
      }
      throw new Error(`Command name collision: "${name}" is already registered`);
    }
    if (this.aliases.has(name)) {
      throw new Error(`Command name "${name}" collides with an existing alias for "${this.aliases.get(name)}"`);
    }

    this.commands.set(name, command);
    this.categories.add(command.category);

    // Register aliases
    if (Array.isArray(command.aliases)) {
      for (const alias of command.aliases) {
        const cleanAlias = alias.toLowerCase();
        if (this.commands.has(cleanAlias)) {
          throw new Error(`Alias collision: "${cleanAlias}" on command "${name}" collides with existing command "${cleanAlias}"`);
        }
        if (this.aliases.has(cleanAlias)) {
          throw new Error(`Alias collision: "${cleanAlias}" on command "${name}" collides with alias on "${this.aliases.get(cleanAlias)}"`);
        }
        this.aliases.set(cleanAlias, name);
      }
    }

    logger.debug(`Registered command: /${name} (${command.category})`);
  }

  /**
   * Resolves a command by name or alias
   * @param {string} nameOrAlias 
   * @returns {object|null}
   */
  resolve(nameOrAlias) {
    if (!nameOrAlias) return null;
    const clean = nameOrAlias.toLowerCase();
    if (this.commands.has(clean)) {
      return this.commands.get(clean);
    }
    if (this.aliases.has(clean)) {
      return this.commands.get(this.aliases.get(clean));
    }
    return null;
  }

  /**
   * Converts the command definitions into Discord REST slash command JSON payloads
   * @returns {Array<object>}
   */
  toSlashData() {
    const slashList = [];

    for (const [name, cmd] of this.commands.entries()) {
      const builder = new SlashCommandBuilder()
        .setName(name)
        .setDescription(cmd.description);

      // Permissions
      if (cmd.permissions && cmd.permissions.length > 0) {
        let bit = 0n;
        for (const p of cmd.permissions) {
          bit |= BigInt(p);
        }
        builder.setDefaultMemberPermissions(bit);
      }

      // Subcommands
      if (Array.isArray(cmd.subcommands) && cmd.subcommands.length > 0) {
        for (const sub of cmd.subcommands) {
          const subBuilder = new SlashCommandSubcommandBuilder()
            .setName(sub.name)
            .setDescription(sub.description);

          if (Array.isArray(sub.args)) {
            this._applyArgsToBuilder(subBuilder, sub.args);
          }
          builder.addSubcommand(subBuilder);
        }
      } else if (Array.isArray(cmd.args)) {
        this._applyArgsToBuilder(builder, cmd.args);
      }

      slashList.push(builder.toJSON());
    }

    return slashList;
  }

  /**
   * Internal helper to map args schema to Discord Option builders
   * @private
   */
  _applyArgsToBuilder(builder, args) {
    for (const arg of args) {
      const required = Boolean(arg.required);
      const desc = arg.description || arg.name;

      switch (arg.type) {
        case 'int':
        case 'integer':
          builder.addIntegerOption(opt =>
            opt.setName(arg.name).setDescription(desc).setRequired(required)
          );
          break;

        case 'bool':
        case 'boolean':
          builder.addBooleanOption(opt =>
            opt.setName(arg.name).setDescription(desc).setRequired(required)
          );
          break;

        case 'user':
          builder.addUserOption(opt =>
            opt.setName(arg.name).setDescription(desc).setRequired(required)
          );
          break;

        case 'channel':
          builder.addChannelOption(opt =>
            opt.setName(arg.name).setDescription(desc).setRequired(required)
          );
          break;

        case 'role':
          builder.addRoleOption(opt =>
            opt.setName(arg.name).setDescription(desc).setRequired(required)
          );
          break;

        case 'choice':
          builder.addStringOption(opt => {
            opt.setName(arg.name).setDescription(desc).setRequired(required);
            if (arg.choices) {
              const formattedChoices = arg.choices.map(c => 
                typeof c === 'string' ? { name: c, value: c } : { name: c.name || c.value, value: String(c.value) }
              );
              opt.addChoices(...formattedChoices.slice(0, 25));
            }
            return opt;
          });
          break;

        case 'duration':
        case 'id':
        case 'string':
        default:
          builder.addStringOption(opt => {
            opt.setName(arg.name).setDescription(desc).setRequired(required);
            if (arg.choices) {
              const formattedChoices = arg.choices.map(c => 
                typeof c === 'string' ? { name: c, value: c } : { name: c.name || c.value, value: String(c.value) }
              );
              opt.addChoices(...formattedChoices.slice(0, 25));
            }
            return opt;
          });
          break;
      }
    }
  }

  getAll() {
    return Array.from(this.commands.values());
  }

  getByCategory(category) {
    return Array.from(this.commands.values()).filter(c => c.category === category);
  }
}

export const registry = new CommandRegistry();
export default registry;

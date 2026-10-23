import { MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { logError } from '../../db/errors.js';
import { errorCard } from '../../ui/cards.js';
import { safeRespond } from './safeRespond.js';
import { runHandler } from './runHandler.js';
import { interactionRegistry } from './registry.js';
import { parseCustomId } from './session.js';
import { isAcknowledged, markAcknowledged } from './tracker.js';

// Legacy router imports for seamless backwards-compatibility
import { handleAutoModInteraction } from '../../modules/automod/router.js';
import { handleAntiNukeInteraction } from '../../modules/antinuke/router.js';
import { handlePermifyInteraction } from '../../modules/permify/router.js';
import { handleTicketInteraction } from '../../modules/tickets/router.js';
import { handleFeedbackVoiceInteraction } from '../../modules/router.js';
import { handleDashboardInteraction } from '../../modules/panel/index.js';
import { handleHelpInteraction } from '../../modules/help/panel.js';
import { handleOwnerInteraction } from '../../modules/owner/panel.js';
import { componentRegistry } from '../../structures/ComponentRegistry.js';
import { registry } from '../../structures/CommandRegistry.js';
import { CommandContext } from '../../structures/CommandContext.js';
import { runMiddlewareChain } from '../../middleware/index.js';

/**
 * Known customId patterns that open Discord Modals and must NOT be deferred.
 */
const MODAL_OPENER_PATTERNS = [
  ':modal',
  'tkt:open:',
  'tkt:rename',
  'tkt:topic',
  'tkt:add',
  'tkt:remove',
  'tkt:question',
  'fb:feedback:open',
  'fb:suggest:open',
  'fb:jtc:rename',
  'fb:jtc:limit',
  'fb:tts:custom',
  'fb:profile:',
  'fb:sticky:add',
  'fb:sticky:edit',
  'fb:autorole:rule',
  'owner:modal',
  'permify:name',
  'automod:word:add',
  'automod:regex:add',
  'automod:allow:add',
  'antinuke:trusted:add',
  'antinuke:exempt:add'
];

/**
 * Determines whether a customId triggers a modal.
 * @param {string} customId
 * @param {object} [meta]
 * @returns {boolean}
 */
export function isModalOpener(customId, meta = null) {
  if (meta?.opensModal) return true;
  if (!customId || typeof customId !== 'string') return false;
  return MODAL_OPENER_PATTERNS.some(pat => customId.includes(pat));
}

/**
 * Central Interaction Router - Single entry point for all Discord gateway interactions.
 * Guarantees sub-1s acknowledgement, safe exception boundary, and zero unhandled rejections.
 *
 * @param {import('discord.js').Interaction} interaction
 */
export async function routeInteraction(interaction) {
  // 1. Autocomplete (Non-deferrable, strictly 2-second hard timeout)
  if (interaction.isAutocomplete?.()) {
    return handleAutocomplete(interaction);
  }

  // 2. Slash Commands (ChatInputCommand)
  if (interaction.isChatInputCommand?.()) {
    return handleSlashCommand(interaction);
  }

  // 3. Components (Buttons, Select Menus, Modals)
  if (interaction.isButton?.() || interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) {
    return handleComponentInteraction(interaction);
  }
}

/**
 * Handles Autocomplete interactions from in-memory cache with a 2s hard timeout.
 * @param {import('discord.js').AutocompleteInteraction} interaction
 */
async function handleAutocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);
  const commandName = interaction.commandName;

  const autocompleteHandler = interactionRegistry.resolveAutocomplete(commandName, focusedOption.name);

  const timeoutPromise = new Promise((resolve) => {
    const t = setTimeout(() => resolve([]), 2000);
    if (t.unref) t.unref();
  });

  try {
    let results = [];
    if (autocompleteHandler) {
      results = await Promise.race([
        Promise.resolve().then(() => autocompleteHandler(interaction, focusedOption)),
        timeoutPromise
      ]);
    }

    if (!interaction.responded) {
      await interaction.respond(Array.isArray(results) ? results.slice(0, 25) : []).catch(() => {});
    }
  } catch (err) {
    logger.debug({ err: err.message, commandName }, 'Autocomplete failure, responding with empty list');
    if (!interaction.responded) {
      await interaction.respond([]).catch(() => {});
    }
  }
}

/**
 * Handles Slash Commands with immediate sub-1s acknowledgement and middleware pipeline.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
async function handleSlashCommand(interaction) {
  const command = registry.resolve(interaction.commandName);
  if (!command) {
    return safeRespond(interaction, errorCard({
      title: 'Command Not Found',
      reason: `Command /${interaction.commandName} is not recognized.`,
      fix: 'Use /help to see all available commands.',
      ephemeral: true
    }), { ephemeral: true });
  }

  const isInstant = Boolean(command.instant);
  const isEphemeral = Boolean(command.ephemeral);

  return runHandler(interaction, async (i) => {
    // Extract options into flat args dictionary
    const args = {};
    const subcommand = i.options.getSubcommand(false);
    if (subcommand) {
      args.subcommand = subcommand;
    }

    const subArgs = command.subcommands?.find(s => s.name === subcommand)?.args || command.args || [];
    for (const opt of subArgs) {
      switch (opt.type) {
        case 'user':
          args[opt.name] = i.options.getUser(opt.name)?.id || null;
          break;
        case 'channel':
          args[opt.name] = i.options.getChannel(opt.name)?.id || null;
          break;
        case 'role':
          args[opt.name] = i.options.getRole(opt.name)?.id || null;
          break;
        case 'int':
        case 'integer':
          args[opt.name] = i.options.getInteger(opt.name);
          break;
        case 'bool':
        case 'boolean':
          args[opt.name] = i.options.getBoolean(opt.name);
          break;
        case 'attachment':
        case 'file':
          args[opt.name] = i.options.getAttachment(opt.name);
          break;
        case 'duration':
        case 'id':
        case 'choice':
        case 'string':
        default:
          args[opt.name] = i.options.getString(opt.name);
          break;
      }
    }

    const ctx = new CommandContext({
      client: i.client,
      interaction: i,
      args
    });

    // Run middleware
    const passed = await runMiddlewareChain(ctx, command);
    if (!passed) return;

    // Execute command
    await command.execute(ctx);
  }, {
    name: `/${command.name}`,
    instant: isInstant,
    ephemeral: isEphemeral
  });
}

/**
 * Handles Button, Select Menu, and Modal Submit interactions.
 * @param {import('discord.js').MessageComponentInteraction|import('discord.js').ModalSubmitInteraction} interaction
 */
async function handleComponentInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId) return;

  const parsed = parseCustomId(customId);

  // 1. Check FastInteractionRegistry (O(1) Map lookup)
  const registered = interactionRegistry.resolveComponent(customId);
  if (registered) {
    const opensModal = isModalOpener(customId, registered.meta);
    return runHandler(interaction, (i) => registered.handler(i, parsed), {
      ...registered.meta,
      opensModal,
      parsed
    });
  }

  // 2. Dispatch through structured legacy module routers wrapped with runHandler
  const opensModal = isModalOpener(customId);

  return runHandler(interaction, async (i) => {
    // 0. AutoMod System Routing (automod:*)
    if (customId.startsWith('automod:')) {
      const handled = await handleAutoModInteraction(i);
      if (handled) return;
    }

    // 0.01 Anti-Nuke System Routing (antinuke:*)
    if (customId.startsWith('antinuke:')) {
      const handled = await handleAntiNukeInteraction(i);
      if (handled) return;
    }

    // 0. Permify System Routing (permify:*)
    if (customId.startsWith('permify:')) {
      const handled = await handlePermifyInteraction(i);
      if (handled) return;
    }

    // 0.1 Ticket System Routing (tkt:*)
    if (customId.startsWith('tkt:')) {
      const handled = await handleTicketInteraction(i);
      if (handled) return;
    }

    // 0.1 Central Router for Suggestions, Feedback, JTC, TTS & Logs (fb:*)
    if (customId.startsWith('fb:')) {
      const handled = await handleFeedbackVoiceInteraction(i);
      if (handled) return;
    }

    // 1. Dashboard Routing (dash:*)
    if (customId.startsWith('dash:')) {
      const handled = await handleDashboardInteraction(i);
      if (handled) return;
    }

    // 2. Help Menu Routing (help:*)
    if (customId.startsWith('help:')) {
      const handled = await handleHelpInteraction(i);
      if (handled) return;
    }

    // 3. Owner Panel Routing (owner:*)
    if (customId.startsWith('owner:')) {
      const handled = await handleOwnerInteraction(i);
      if (handled) return;
    }

    // 4. Fallback ComponentRegistry Dispatch
    const legacyHandled = await componentRegistry.dispatch(i);
    if (legacyHandled) return;

    // 5. If no handler found at all (e.g. old panel from previous bot session)
    logger.debug({ customId }, 'Unmatched component interaction, returning graceful expiration card');
    await safeRespond(i, errorCard({
      title: 'Panel Expired',
      subtitle: 'This interactive session is no longer active.',
      reason: 'The bot was restarted or this control panel has expired.',
      fix: 'Please run the command again to generate a new interactive panel.',
      ephemeral: true
    }), { ephemeral: true });
  }, {
    opensModal,
    authorOnly: Boolean(parsed.userId),
    parsed
  });
}

export default {
  routeInteraction,
  isModalOpener
};

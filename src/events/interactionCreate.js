import { CommandContext } from '../structures/CommandContext.js';
import { registry } from '../structures/CommandRegistry.js';
import { runMiddlewareChain } from '../middleware/index.js';
import { logError } from '../db/errors.js';
import { errorCard } from '../ui/cards.js';
import { handleOwnerInteraction } from '../modules/owner/panel.js';
import { componentRegistry } from '../structures/ComponentRegistry.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { handleFeedbackVoiceInteraction } from '../modules/router.js';
import { handleTicketInteraction } from '../modules/tickets/router.js';
import { handleDashboardInteraction } from '../modules/panel/index.js';
import { handleHelpInteraction } from '../modules/help/panel.js';

export async function onInteractionCreate(interaction) {
  try {
    // 0. Ticket System Routing (tkt:*)
    if (interaction.customId?.startsWith('tkt:') || (interaction.isModalSubmit() && interaction.customId?.startsWith('tkt:'))) {
      const handled = await handleTicketInteraction(interaction);
      if (handled) return;
    }

    // 0.1 Central Router for Suggestions, Feedback, JTC, TTS & Logs (fb:*)
    if (interaction.customId?.startsWith('fb:') || (interaction.isModalSubmit() && interaction.customId?.startsWith('fb:'))) {
      const handled = await handleFeedbackVoiceInteraction(interaction);
      if (handled) return;
    }

    // 1. Dashboard Routing (dash:*)
    if (interaction.customId?.startsWith('dash:')) {
      const handled = await handleDashboardInteraction(interaction);
      if (handled) return;
    }

    // 2. Help Menu Routing (help:*)
    if (interaction.customId?.startsWith('help:')) {
      const handled = await handleHelpInteraction(interaction);
      if (handled) return;
    }

    // 3. Owner Panel Routing (owner:*)
    if (interaction.customId?.startsWith('owner:') || (interaction.isModalSubmit() && interaction.customId?.startsWith('owner:'))) {
      return handleOwnerInteraction(interaction);
    }

    // 4. Dynamic Component & Modal Routing
    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const handled = await componentRegistry.dispatch(interaction);
      if (handled) return;
    }

    // 3. Slash Commands
    if (!interaction.isChatInputCommand()) return;

    const command = registry.resolve(interaction.commandName);
    if (!command) {
      return interaction.reply(errorCard({
        title: 'Command Not Found',
        reason: `Command /${interaction.commandName} is not recognized.`,
        fix: 'Use /help to see all available commands.',
        ephemeral: true
      }));
    }

    // Extract options into flat args dictionary
    const args = {};
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand) {
      args.subcommand = subcommand;
    }

    const subArgs = command.subcommands?.find(s => s.name === subcommand)?.args || command.args || [];
    for (const opt of subArgs) {
      switch (opt.type) {
        case 'user':
          args[opt.name] = interaction.options.getUser(opt.name)?.id || null;
          break;
        case 'channel':
          args[opt.name] = interaction.options.getChannel(opt.name)?.id || null;
          break;
        case 'role':
          args[opt.name] = interaction.options.getRole(opt.name)?.id || null;
          break;
        case 'int':
        case 'integer':
          args[opt.name] = interaction.options.getInteger(opt.name);
          break;
        case 'bool':
        case 'boolean':
          args[opt.name] = interaction.options.getBoolean(opt.name);
          break;
        case 'attachment':
        case 'file':
          args[opt.name] = interaction.options.getAttachment(opt.name);
          break;
        case 'duration':
        case 'id':
        case 'choice':
        case 'string':
        default:
          args[opt.name] = interaction.options.getString(opt.name);
          break;
      }
    }

    const ctx = new CommandContext({
      client: interaction.client,
      interaction,
      args
    });

    // Run middleware pipeline
    const passed = await runMiddlewareChain(ctx, command);
    if (!passed) return;

    // Execute command
    await command.execute(ctx);

  } catch (err) {
    logger.error({ err, command: interaction.commandName }, 'Error during slash interaction');
    await logError({
      scope: `slash:${interaction.commandName}`,
      message: err.message,
      stack: err.stack
    });

    const errPayload = errorCard({
      title: 'Execution Error',
      subtitle: `Failed to process /${interaction.commandName}.`,
      reason: 'An unexpected internal error occurred.',
      fix: 'Please try again in a few moments or report to Argoni support.',
      ephemeral: true
    });

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(errPayload).catch(() => {});
    } else {
      await interaction.reply(errPayload).catch(() => {});
    }
  }
}

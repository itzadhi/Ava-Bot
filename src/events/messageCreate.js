import { CommandContext } from '../structures/CommandContext.js';
import { registry } from '../structures/CommandRegistry.js';
import { runMiddlewareChain } from '../middleware/index.js';
import { getGuildSettings } from '../db/guilds.js';
import { parsePrefixArgs, tokenize } from '../utils/parser.js';
import { logError } from '../db/errors.js';
import { errorCard } from '../ui/cards.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export async function onMessageCreate(message) {
  // Ignore bots and webhooks
  if (message.author.bot || message.webhookId) return;

  const content = message.content?.trim();
  if (!content) return;

  const isOwner = config.OWNER_IDS.includes(message.author.id);
  const ownerPrefix = config.OWNER_PREFIX || 'ao!';

  let usedPrefix = null;
  let isOwnerPrefix = false;

  // 1. Check Owner Prefix (works anywhere, including DMs, only for owners)
  if (isOwner && content.startsWith(ownerPrefix)) {
    usedPrefix = ownerPrefix;
    isOwnerPrefix = true;
  }

  // 2. Ignore non-owner DMs
  if (!message.guild && !isOwnerPrefix) {
    return;
  }

  // 3. Resolve Guild Prefix & Mention Prefix
  let guildSettings = null;
  if (message.guild) {
    guildSettings = await getGuildSettings(message.guild.id);

    // If prefix commands are disabled for this guild and it's not the owner prefix, exit
    if (guildSettings && guildSettings.prefix_commands_enabled === false && !isOwnerPrefix) {
      return;
    }

    const guildPrefix = guildSettings?.prefix || config.DEFAULT_PREFIX || 'a!';
    const mentionPrefixRegex = new RegExp(`^<@!?${message.client.user.id}>\\s*`);

    if (!usedPrefix) {
      if (content.startsWith('&')) {
        usedPrefix = '&';
      } else if (content.startsWith(guildPrefix)) {
        usedPrefix = guildPrefix;
      } else if (mentionPrefixRegex.test(content)) {
        const match = content.match(mentionPrefixRegex);
        usedPrefix = match[0];
      }
    }
  }

  if (!usedPrefix) return;

  // Extract raw command line without prefix
  const rawCommandText = content.slice(usedPrefix.length).trim();
  if (!rawCommandText) return;

  // Get command name
  const firstSpace = rawCommandText.search(/\s/);
  const commandWord = firstSpace === -1 ? rawCommandText : rawCommandText.slice(0, firstSpace);
  const remainder = firstSpace === -1 ? '' : rawCommandText.slice(firstSpace).trim();

  const command = registry.resolve(commandWord);
  // Unknown commands are ignored silently as per spec
  if (!command) return;

  try {
    let args = {};
    let schemaArgs = command.args || [];

    // Check if command uses subcommands (e.g. backup create, template load)
    if (Array.isArray(command.subcommands) && command.subcommands.length > 0) {
      const { positional } = tokenize(remainder);
      const subName = positional[0]?.toLowerCase();
      const subDef = command.subcommands.find(s => s.name === subName);

      if (subDef) {
        args.subcommand = subDef.name;
        schemaArgs = subDef.args || [];
        // Remove subcommand token from remainder for arg parsing
        const subIndex = remainder.indexOf(positional[0]);
        const subRemainder = remainder.slice(subIndex + positional[0].length).trim();
        const parsed = parsePrefixArgs(subRemainder, schemaArgs);
        if (parsed.errors.length > 0) {
          const usage = command.usage || `${usedPrefix}${command.name} ${subDef.name} ${schemaArgs.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')}`;
          return message.reply({
            ...errorCard({
              title: 'Invalid Arguments',
              subtitle: `Usage: ${usage}`,
              reason: parsed.errors[0],
              fix: 'Check the required arguments and try again.'
            }),
            allowedMentions: { repliedUser: false }
          });
        }
        args = { ...args, ...parsed.args };
      } else {
        // Subcommand missing or not matched
        const validSubs = command.subcommands.map(s => `\`${s.name}\``).join(', ');
        return message.reply({
          ...errorCard({
            title: 'Subcommand Required',
            subtitle: `Available subcommands for ${command.name}`,
            reason: `Missing valid subcommand. Available: ${validSubs}`,
            fix: `Use ${usedPrefix}${command.name} <subcommand>`
          }),
          allowedMentions: { repliedUser: false }
        });
      }
    } else {
      const parsed = parsePrefixArgs(remainder, schemaArgs);
      if (parsed.errors.length > 0) {
        const usage = command.usage || `${usedPrefix}${command.name} ${schemaArgs.map(a => a.required ? `<${a.name}>` : `[${a.name}]`).join(' ')}`;
        return message.reply({
          ...errorCard({
            title: 'Invalid Arguments',
            subtitle: `Usage: ${usage}`,
            reason: parsed.errors[0],
            fix: 'Check the required arguments and try again.'
          }),
          allowedMentions: { repliedUser: false }
        });
      }
      args = parsed.args;
    }

    const ctx = new CommandContext({
      client: message.client,
      message,
      args,
      prefix: usedPrefix
    });

    // Run middleware
    const passed = await runMiddlewareChain(ctx, command);
    if (!passed) return;

    // Execute command
    await command.execute(ctx);

  } catch (err) {
    logger.error({ err, command: command.name }, 'Error during prefix command execution');
    await logError({
      scope: `prefix:${command.name}`,
      message: err.message,
      stack: err.stack
    });

    const errPayload = errorCard({
      title: 'Execution Error',
      subtitle: `Failed to execute ${usedPrefix}${command.name}.`,
      reason: 'An unexpected internal error occurred.',
      fix: 'Please try again in a few moments or report to Argoni support.'
    });

    await message.reply({
      ...errPayload,
      allowedMentions: { repliedUser: false }
    }).catch(() => {});
  }
}

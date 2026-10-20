import {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  MessageFlags
} from 'discord.js';
import { theme } from '../../config/theme.js';
import * as format from '../../utils/ui/format.js';
import { registry } from '../../structures/CommandRegistry.js';
import { getBrandLogo } from '../../ui/theme.js';

export const CATEGORY_DEFINITIONS = {
  main: [
    {
      id: 'automod',
      name: 'AutoMod & Protection',
      emoji: '🛡️',
      description: 'Filters, anti-spam, invites, words & moderation'
    },
    {
      id: 'backup',
      name: 'Server Snapshots',
      emoji: '📦',
      description: 'Cross-server structural backups, restore & intervals'
    },
    {
      id: 'settings',
      name: 'Server Settings',
      emoji: '⚙️',
      description: 'Prefix, bot profile, staff hub & dashboard'
    },
    {
      id: 'voice',
      name: 'Voice & Speech',
      emoji: '🔊',
      description: 'Join-to-Create voice channels & TTS speech reader'
    },
    {
      id: 'logs',
      name: 'Server Logs',
      emoji: '📢',
      description: 'Audit logging events & log channel routing'
    }
  ],
  extra: [
    {
      id: 'autorole',
      name: 'Auto-Role',
      emoji: '👤',
      description: 'Welcome roles for joining members & bots'
    },
    {
      id: 'boosts',
      name: 'Boost Tracking',
      emoji: '🚀',
      description: 'Boost detection, announcements & booster roles'
    },
    {
      id: 'sticky',
      name: 'Sticky Notes',
      emoji: '📌',
      description: 'Pinned messages kept at bottom of channels'
    },
    {
      id: 'stickyroles',
      name: 'Sticky Roles',
      emoji: '🧲',
      description: 'Re-assign member roles when rejoining'
    },
    {
      id: 'suggestions',
      name: 'Suggestions',
      emoji: '💡',
      description: 'Community suggestions, upvotes & staff review'
    },
    {
      id: 'feedback',
      name: 'Feedback',
      emoji: '📝',
      description: 'Member feedback, ratings, reviews & staff replies'
    },
    {
      id: 'chatlog',
      name: 'Chatlog Vault',
      emoji: '💬',
      description: 'Encrypted message backups & webhook replay'
    }
  ]
};

/**
 * Builds the initial Main Help Menu Container
 * @param {object} options
 * @param {import('discord.js').User} options.user
 * @param {import('discord.js').Client} options.client
 * @param {string} options.prefix
 * @param {string} options.sessionId
 */
export function buildHelpMenuPayload({ user, client, prefix = 'a!', sessionId }) {
  const container = new ContainerBuilder();
  container.setAccentColor(theme.accent);

  const totalCommands = registry.getAll().length;
  const botName = client?.user?.username || 'Argoni';
  const botAvatar = getBrandLogo(client);

  // 1. Heading
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${theme.emojis.sparkle} Help Menu`)
  );

  // 2. Lines + Link Buttons
  const infoLines = [
    `Type ${format.code(`${prefix}help`)} to get more info`,
    `Total Commands available: ${format.code(totalCommands)}`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoLines));

  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Invite Bot')
      .setStyle(ButtonStyle.Link)
      .setURL(theme.links.invite)
      .setEmoji(theme.emojis.link),
    new ButtonBuilder()
      .setLabel('Website')
      .setStyle(ButtonStyle.Link)
      .setURL(theme.links.website)
      .setEmoji('🌐'),
    new ButtonBuilder()
      .setLabel('Support Server')
      .setStyle(ButtonStyle.Link)
      .setURL(theme.links.support)
      .setEmoji('💬')
  );
  container.addActionRowComponents(linkRow);

  // 3. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 4. Greeting Section with Bot Avatar Thumbnail
  const greetingText = `Hey **${user?.username || 'there'}**!\nI'm **${botName}**, your friendly companion.`;
  const greetingSection = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(greetingText))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar));
  container.addSectionComponents(greetingSection);

  // 5. Prefix & instructions
  const promptLines = [
    `Prefix for this server: ${format.code(prefix)}`,
    'Pick from the menu to continue!'
  ].join('\n');
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(promptLines));

  // 6. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 7. Two Select Menus
  const mainSelect = new StringSelectMenuBuilder()
    .setCustomId(`help:sel_main:${sessionId}`)
    .setPlaceholder('📂 Main Categories...')
    .addOptions(
      CATEGORY_DEFINITIONS.main.map(cat => ({
        label: cat.name,
        value: cat.id,
        description: cat.description,
        emoji: cat.emoji
      }))
    );

  const extraSelect = new StringSelectMenuBuilder()
    .setCustomId(`help:sel_extra:${sessionId}`)
    .setPlaceholder('✨ Extra Categories...')
    .addOptions(
      CATEGORY_DEFINITIONS.extra.map(cat => ({
        label: cat.name,
        value: cat.id,
        description: cat.description,
        emoji: cat.emoji
      }))
    );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(mainSelect));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(extraSelect));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Builds the Category Command Browser Container
 * @param {object} options
 */
export function buildCategoryHelpPayload({
  categoryId,
  prefix = 'a!',
  sessionId,
  page = 1
}) {
  const allCats = [...CATEGORY_DEFINITIONS.main, ...CATEGORY_DEFINITIONS.extra];
  const catDef = allCats.find(c => c.id === categoryId) || {
    id: categoryId,
    name: categoryId.toUpperCase(),
    emoji: '📁',
    description: 'Commands in this category'
  };

  // Find commands mapped to this category (match category or alias)
  const allCommands = registry.getAll();
  const matchedCommands = allCommands.filter(cmd => {
    const c = (cmd.category || '').toLowerCase();
    const n = (cmd.name || '').toLowerCase();
    return c === categoryId || c.includes(categoryId) || n.includes(categoryId);
  });

  const commandsList = matchedCommands.length > 0 ? matchedCommands : allCommands.slice(0, 8);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(commandsList.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const startIdx = (safePage - 1) * pageSize;
  const pageCommands = commandsList.slice(startIdx, startIdx + pageSize);

  const container = new ContainerBuilder();
  container.setAccentColor(theme.accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${catDef.emoji} ${catDef.name} Commands`)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const formattedLines = pageCommands.map(cmd => {
    const usage = cmd.usage || `${prefix}${cmd.name}`;
    return `${format.code(`/${cmd.name}`)} — ${cmd.description || 'No description provided.'}\n${format.subtext(`Usage: ${usage}`)}`;
  });

  const fullText = formattedLines.length > 0
    ? formattedLines.join('\n\n')
    : '_No commands currently active in this category._';

  const footerText = `Page ${safePage}/${totalPages} • Type ${prefix}help to return • Argoni`;
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`${fullText}\n\n${format.subtext(footerText)}`)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  const controlButtons = [
    new ButtonBuilder()
      .setCustomId(`help:back:${sessionId}`)
      .setLabel('Back to Menu')
      .setEmoji('◀')
      .setStyle(ButtonStyle.Secondary)
  ];

  if (totalPages > 1) {
    controlButtons.push(
      new ButtonBuilder()
        .setCustomId(`help:page:${categoryId}:${safePage - 1}:${sessionId}`)
        .setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 1),
      new ButtonBuilder()
        .setCustomId(`help:page:${categoryId}:${safePage + 1}:${sessionId}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage >= totalPages)
    );
  }

  controlButtons.push(
    new ButtonBuilder()
      .setCustomId(`help:close:${sessionId}`)
      .setLabel('Close')
      .setEmoji('✕')
      .setStyle(ButtonStyle.Danger)
  );

  container.addActionRowComponents(new ActionRowBuilder().addComponents(controlButtons.slice(0, 5)));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

/**
 * Interactive Help Session Manager
 * Listens for category selection, back button, pagination, and handles timeout after 120s.
 * Only the invoker can interact.
 * @param {import('../../structures/CommandContext.js').CommandContext} ctx
 */
export async function startHelpSession(ctx) {
  const sessionId = `${ctx.user.id}_${Date.now()}`;
  const prefix = ctx.prefix || 'a!';

  const initialPayload = buildHelpMenuPayload({
    user: ctx.user,
    client: ctx.client,
    prefix,
    sessionId
  });

  const message = await ctx.reply(initialPayload);

  // Collect interactions for 120 seconds
  const collector = message?.createMessageComponentCollector
    ? message.createMessageComponentCollector({
        time: 120000,
        filter: async (i) => {
          if (i.user.id !== ctx.user.id) {
            await i.reply({
              flags: MessageFlags.Ephemeral,
              content: '⚠️ This help menu is bound to another user. Run `&help` to open your own!'
            }).catch(() => {});
            return false;
          }
          return i.customId.endsWith(sessionId);
        }
      })
    : null;

  if (!collector) return;

  collector.on('collect', async (interaction) => {
    try {
      const customId = interaction.customId;

      if (customId.startsWith('help:close:')) {
        collector.stop('closed');
        return interaction.update({
          components: []
        }).catch(() => {});
      }

      if (customId.startsWith('help:back:')) {
        const menuPayload = buildHelpMenuPayload({
          user: ctx.user,
          client: ctx.client,
          prefix,
          sessionId
        });
        return interaction.update(menuPayload);
      }

      if (customId.startsWith('help:sel_main:') || customId.startsWith('help:sel_extra:')) {
        const categoryId = interaction.values[0];
        const categoryPayload = buildCategoryHelpPayload({
          categoryId,
          prefix,
          sessionId,
          page: 1
        });
        return interaction.update(categoryPayload);
      }

      if (customId.startsWith('help:page:')) {
        const parts = customId.split(':');
        const categoryId = parts[2];
        const targetPage = parseInt(parts[3], 10) || 1;
        const pagePayload = buildCategoryHelpPayload({
          categoryId,
          prefix,
          sessionId,
          page: targetPage
        });
        return interaction.update(pagePayload);
      }
    } catch (err) {
      // Ignore errors on collector updates
    }
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'closed') return;
    try {
      // Auto-disable components on timeout without errors
      if (ctx.isSlash) {
        await ctx.interaction?.editReply({ components: [] }).catch(() => {});
      } else if (ctx.replyMessage) {
        await ctx.replyMessage.edit({ components: [] }).catch(() => {});
      }
    } catch (_) {}
  });
}

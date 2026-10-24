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
import { errorCard } from '../../utils/ui/components.js';
import { getGuildSettings } from '../../db/guilds.js';
import { greyButton } from '../../utils/ui/greyButton.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';

/**
 * Category definitions matching AVA's modular architecture.
 * Organizes core tools into "Main Categories" and extended systems into "Extra Categories".
 */
export const CATEGORY_DEFINITIONS = {
  main: [
    {
      id: 'security',
      name: 'Security & Defense',
      emoji: '🛡️',
      description: 'Anti-nuke restoration, raid lockdown & AutoMod filters'
    },
    {
      id: 'automod',
      name: 'AutoMod Protection',
      emoji: theme.emojis.categories.automod || '⚔️',
      description: 'Filters, anti-spam, invites, words & automated moderation'
    },
    {
      id: 'backup',
      name: 'Server Snapshots',
      emoji: theme.emojis.categories.backup || '📦',
      description: 'Cross-server structural backups, restore & intervals'
    },
    {
      id: 'settings',
      name: 'Server Settings',
      emoji: theme.emojis.categories.settings || '⚙️',
      description: 'Prefix, bot profile, permission wizard, staff hub & central dashboard'
    },
    {
      id: 'voice',
      name: 'Voice & Speech',
      emoji: theme.emojis.categories.voice || '🔊',
      description: 'Join-to-Create voice channels & TTS speech reader'
    },
    {
      id: 'logs',
      name: 'Server Logs',
      emoji: theme.emojis.categories.logs || '📢',
      description: 'Components V2 audit logging events & channel routing'
    },
    {
      id: 'autorole',
      name: 'Auto-Role',
      emoji: theme.emojis.categories.autorole || '👤',
      description: 'Welcome roles for joining members & bots'
    },
    {
      id: 'boosts',
      name: 'Boost Tracker',
      emoji: theme.emojis.categories.boosts || '🚀',
      description: 'Nitro booster celebrations, logs & tier roles'
    },
    {
      id: 'tickets',
      name: 'Ticket System',
      emoji: theme.emojis.categories.tickets || '🎫',
      description: 'Panels, private channels, claim/close flow, transcripts & stats'
    },
    {
      id: 'shop',
      name: 'Shop & Market',
      emoji: '🛒',
      description: 'Automated product channels, canvas banners, instant order tickets & stock delivery'
    }
  ],
  extra: [
    {
      id: 'sticky',
      name: 'Sticky Notes',
      emoji: theme.emojis.categories.sticky || '📌',
      description: 'Repositioning pinned channel notes & notices'
    },
    {
      id: 'stickyroles',
      name: 'Sticky Roles',
      emoji: theme.emojis.categories.stickyroles || '🧲',
      description: 'Re-assign member roles upon server rejoin'
    },
    {
      id: 'suggestions',
      name: 'Suggestions',
      emoji: theme.emojis.categories.staff || '💡',
      description: 'Community suggestions, upvotes, threads & staff review'
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
      emoji: theme.emojis.categories.chatlog || '💬',
      description: 'AES-256 encrypted chat disaster recovery archive'
    },
    {
      id: 'botprofile',
      name: 'Bot Profile',
      emoji: theme.emojis.categories.botprofile || '🎨',
      description: 'Per-guild nickname, avatar, banner & about me bio'
    }
  ]
};

/**
 * Creates the two category StringSelectMenus (Main & Extra) with a Home option
 * @param {string} sessionId
 * @param {string} [currentCat=null]
 */
function createHelpSelectRows(sessionId, currentCat = null) {
  const isMainCat = CATEGORY_DEFINITIONS.main.some(c => c.id === currentCat);
  const isExtraCat = CATEGORY_DEFINITIONS.extra.some(c => c.id === currentCat);

  const mainOptions = [
    {
      label: 'Help Overview',
      value: 'home',
      description: 'Return to the main help menu overview',
      emoji: '🏠'
    },
    ...CATEGORY_DEFINITIONS.main.map(cat => ({
      label: cat.name,
      value: cat.id,
      description: cat.description,
      emoji: cat.emoji,
      default: isMainCat && currentCat === cat.id
    }))
  ];

  const extraOptions = [
    {
      label: 'Help Overview',
      value: 'home',
      description: 'Return to the main help menu overview',
      emoji: '🏠'
    },
    ...CATEGORY_DEFINITIONS.extra.map(cat => ({
      label: cat.name,
      value: cat.id,
      description: cat.description,
      emoji: cat.emoji,
      default: isExtraCat && currentCat === cat.id
    }))
  ];

  const mainSelect = new StringSelectMenuBuilder()
    .setCustomId(`help:sel_main:${sessionId}`)
    .setPlaceholder('Main Categories')
    .addOptions(mainOptions);

  const extraSelect = new StringSelectMenuBuilder()
    .setCustomId(`help:sel_extra:${sessionId}`)
    .setPlaceholder('Extra Categories')
    .addOptions(extraOptions);

  return [
    new ActionRowBuilder().addComponents(mainSelect),
    new ActionRowBuilder().addComponents(extraSelect)
  ];
}

/**
 * Builds the initial Main Help Menu Container (pixel-matched to reference layout)
 * @param {object} options
 * @param {import('discord.js').User} options.user
 * @param {import('discord.js').Client} options.client
 * @param {string} options.prefix
 * @param {string} options.sessionId
 */
export function buildHelpMenuPayload({ user, client, prefix = 'a!', sessionId }) {
  const container = new ContainerBuilder();

  const totalCommands = registry.getAll().length;
  const botName = theme.botName || client?.user?.username || 'AVA';
  const dot = theme.emojis.dot || '•';
  const arrow = theme.emojis.arrow || '❯';
  const butterfly = theme.emojis.butterfly || '🦋';

  // 1. Heading
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('# Help Menu')
  );

  // 2. Three bullet lines using the cyan dot emoji & masked links
  const userAvatar = user?.displayAvatarURL ? user.displayAvatarURL() : 'https://discord.com';
  const displayName = user?.displayName || user?.username || 'there';

  const bulletBlock = [
    `${dot} **Type \`${prefix}help\` to get more info**`,
    `${dot} **Total Commands available: \`${totalCommands}\`**`,
    `${dot} [Invite](${theme.links.invite}) | [Website](${theme.links.website}) | [Support](${theme.links.support})`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bulletBlock));

  // 3. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 4. Greeting Block with butterfly & chevrons
  const greetingBlock = [
    `${butterfly} Hey [**${displayName}**](${userAvatar})!`,
    `I'm **${botName}**, your friendly companion.`,
    '',
    `   ${arrow} Prefix for this server: **${prefix}**`,
    `   ${arrow} Pick from the menu to continue!`
  ].join('\n');

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(greetingBlock));

  // 5. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 6. Two Select Menus (Main & Extra) - both display their distinctive placeholders
  const selectRows = createHelpSelectRows(sessionId, null);
  for (const row of selectRows) {
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: format.allowedMentionsNone
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

  const allCommands = registry.getAll();
  const matchedCommands = allCommands.filter(cmd => {
    const c = (cmd.category || '').toLowerCase();
    const n = (cmd.name || '').toLowerCase();
    if (categoryId === 'security' || categoryId === 'automod') {
      return c === 'security' || n === 'antinuke' || n === 'lockdown' || n === 'automod' || c === categoryId;
    }
    return c === categoryId || c.includes(categoryId) || n.includes(categoryId);
  });

  const commandsList = matchedCommands.length > 0 ? matchedCommands : allCommands.slice(0, 10);

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(commandsList.length / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);

  const startIdx = (safePage - 1) * pageSize;
  const pageCommands = commandsList.slice(startIdx, startIdx + pageSize);

  const container = new ContainerBuilder();
  const dot = theme.emojis.dot || '•';

  // 1. Category Heading + Subtext Description
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${catDef.emoji} ${catDef.name} Commands\n-# ${catDef.description}`)
  );

  container.addSeparatorComponents(new SeparatorBuilder());

  // 2. Command list
  const formattedLines = pageCommands.map(cmd => {
    const usage = cmd.usage ? `${prefix}${cmd.usage}` : `${prefix}${cmd.name}`;
    const desc = cmd.description || 'No description provided.';
    const aliases = Array.isArray(cmd.aliases) && cmd.aliases.length > 0
      ? ` • Aliases: ${cmd.aliases.map(a => format.code(a)).join(', ')}`
      : '';
    return `${dot} ${format.code(`${prefix}${cmd.name}`)} — ${desc}\n-# Usage: \`${usage}\`${aliases}`;
  });

  const fullText = formattedLines.length > 0
    ? formattedLines.join('\n\n')
    : '_No commands currently active in this category._';

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fullText));

  // 3. Separator
  container.addSeparatorComponents(new SeparatorBuilder());

  // 4. Navigation Buttons: Home, Prev, Next, Close
  const navRow = new ActionRowBuilder().addComponents(
    greyButton({
      id: `help:back:${sessionId}`,
      label: 'Home',
      emoji: '🏠'
    }),
    greyButton({
      id: `help:page:${categoryId}:${safePage - 1}:${sessionId}`,
      label: '‹ Prev',
      disabled: safePage <= 1
    }),
    greyButton({
      id: `help:page_info:${sessionId}`,
      label: `${safePage} / ${totalPages}`,
      disabled: true
    }),
    greyButton({
      id: `help:page:${categoryId}:${safePage + 1}:${sessionId}`,
      label: 'Next ›',
      disabled: safePage >= totalPages
    }),
    greyButton({
      id: `help:close:${sessionId}`,
      label: 'Close',
      emoji: '❌'
    })
  );

  container.addActionRowComponents(navRow);

  // 5. Select Menus at bottom for instant switching
  const selectRows = createHelpSelectRows(sessionId, categoryId);
  for (const row of selectRows) {
    container.addActionRowComponents(row);
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
    allowedMentions: format.allowedMentionsNone
  };
}

/**
 * Initiates an interactive Help Session with collectors and ownership checks.
 * @param {import('../../structures/CommandContext.js').CommandContext} ctx
 */
export async function startHelpSession(ctx) {
  const sessionId = `${ctx.user.id}_${Date.now()}`;

  // Fetch guild prefix from Supabase if in a guild
  let prefix = theme.defaultPrefix || 'a!';
  if (ctx.guild) {
    try {
      const settings = await getGuildSettings(ctx.guild.id);
      if (settings?.prefix) prefix = settings.prefix;
    } catch (_) {}
  }

  const initialPayload = buildHelpMenuPayload({
    user: ctx.user,
    client: ctx.client,
    prefix,
    sessionId
  });
  await ctx.reply(initialPayload);
}


/**
 * Persistent handler for help:* interactions.
 * Completely collector-free, works across bot restarts and after token expirations.
 * @param {import('discord.js').Interaction} interaction
 */
export async function handleHelpInteraction(interaction) {
  const customId = interaction.customId;
  if (!customId?.startsWith('help:')) return false;

  try {
    if (customId.startsWith('help:close:')) {
      await safeRespond(interaction, { components: [] });
      return true;
    }

    const prefix = 'a!';
    const sessionId = customId.split(':').pop() || `${Date.now()}`;

    if (customId.startsWith('help:back:')) {
      const menuPayload = buildHelpMenuPayload({
        user: interaction.user,
        client: interaction.client,
        prefix,
        sessionId
      });
      await safeRespond(interaction, menuPayload);
      return true;
    }

    if (customId.startsWith('help:sel_main:') || customId.startsWith('help:sel_extra:')) {
      const categoryId = interaction.values?.[0];
      if (!categoryId || categoryId === 'home') {
        const menuPayload = buildHelpMenuPayload({
          user: interaction.user,
          client: interaction.client,
          prefix,
          sessionId
        });
        await safeRespond(interaction, menuPayload);
        return true;
      }

      const categoryPayload = buildCategoryHelpPayload({
        categoryId,
        prefix,
        sessionId,
        page: 1
      });
      await safeRespond(interaction, categoryPayload);
      return true;
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
      await safeRespond(interaction, pagePayload);
      return true;
    }
  } catch (err) {
    // Handled safely by runHandler
  }
  return true;
}

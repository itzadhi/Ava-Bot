import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { getGuildRoles } from '../../db/permify.js';
import { getGuildSettings } from '../../db/guilds.js';
import {
  getTicketSettings,
  getTicketCategories,
  getTicketPanels,
  getOpenTickets,
  createTicket
} from '../../db/tickets.js';
import { logger } from '../../utils/logger.js';

// Core Bot Permissions
const BOT_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.Connect,
  PermissionFlagsBits.Speak
];

/**
 * Automatically repairs channel permissions and ticket privacy across all guilds.
 * 1. Restores normal community channels to be viewable by @everyone.
 * 2. Secures ticket panel channels to be viewable by @everyone but read-only (buttons interactive).
 * 3. Hides ticket categories from @everyone and member roles.
 * 4. Restores private overwrites for active ticket channels (owner allowed, everyone/members denied).
 *
 * @param {import('discord.js').Client} client
 * @returns {Promise<object>} Summary of repairs executed
 */
export async function autoRepairPermissionsAndTickets(client) {
  const summary = {
    guildsProcessed: 0,
    normalChannelsRepaired: 0,
    ticketPanelsRepaired: 0,
    ticketCategoriesRepaired: 0,
    ticketsRepaired: 0,
    errors: []
  };

  if (!client || !client.guilds) {
    return summary;
  }

  for (const guild of client.guilds.cache.values()) {
    try {
      const guildId = guild.id;

      // 1. Fetch current settings, role groups, and ticket configurations
      const [guildRoles, guildSettings, ticketSettings, ticketCategories, ticketPanels, openTickets] = await Promise.all([
        getGuildRoles(guildId).catch(() => ({ staff: [], member: [], owner: [] })),
        getGuildSettings(guildId).catch(() => ({})),
        getTicketSettings(guildId).catch(() => null),
        getTicketCategories(guildId).catch(() => []),
        getTicketPanels(guildId).catch(() => []),
        getOpenTickets(guildId).catch(() => [])
      ]);

      const staffRoleIds = Array.from(new Set(guildRoles.staff || []));
      const memberRoleIds = Array.from(new Set(guildRoles.member || []));
      const ownerRoleIds = Array.from(new Set(guildRoles.owner || []));

      const logChannelIds = new Set([
        guildSettings?.log_channel_id,
        guildSettings?.automod_log_channel_id,
        ticketSettings?.log_channel_id,
        ticketSettings?.transcript_channel_id
      ].filter(Boolean));

      const ticketCategoryIds = new Set([
        ticketSettings?.channel_category_id,
        ...ticketCategories.map(tc => tc.channel_category_id)
      ].filter(Boolean));

      const ticketPanelChannelIds = new Set(ticketPanels.map(p => p.channel_id).filter(Boolean));
      const openTicketChannelIds = new Set(openTickets.map(t => t.channel_id).filter(Boolean));

      const channels = await guild.channels.fetch().catch(() => new Map());
      const botMember = guild.members.me;
      const botTargetId = botMember?.roles?.botRole?.id || botMember?.id;

      for (const chan of channels.values()) {
        if (!chan) continue;

        const isTktChan = chan.type === ChannelType.GuildText && (
          chan.name.startsWith('ticket-') ||
          chan.name.startsWith('tkt-') ||
          openTicketChannelIds.has(chan.id) ||
          (chan.parentId && ticketCategoryIds.has(chan.parentId))
        );

        // A. REPAIR ACTIVE TICKET CHANNELS
        if (isTktChan) {
          let ownerId = null;
          const dbTicket = openTickets.find(t => t.channel_id === chan.id);
          if (dbTicket?.owner_id) {
            ownerId = dbTicket.owner_id;
          }

          if (!ownerId && chan.topic) {
            const match = chan.topic.match(/Owner:.*?\((\d+)\)/i);
            if (match && match[1]) {
              ownerId = match[1];
            }
          }

          if (!ownerId) {
            const msgs = await chan.messages.fetch({ limit: 10 }).catch(() => []);
            for (const m of msgs.values()) {
              if (m.mentions?.users?.size > 0) {
                const mentionedUser = m.mentions.users.find(u => !u.bot);
                if (mentionedUser) {
                  ownerId = mentionedUser.id;
                  break;
                }
              }
            }
          }

          // Build clean, private ticket overwrites
          const tktOverwrites = [
            {
              id: guild.id, // @everyone denied
              type: 0,
              deny: [PermissionFlagsBits.ViewChannel]
            }
          ];

          // Explicitly deny member community roles so they can't spy on tickets
          for (const roleId of memberRoleIds) {
            tktOverwrites.push({
              id: roleId,
              type: 0,
              deny: [PermissionFlagsBits.ViewChannel]
            });
          }

          // Bot overwrite
          if (botTargetId) {
            tktOverwrites.push({
              id: botTargetId,
              type: botMember?.roles?.botRole?.id ? 0 : 1,
              allow: BOT_PERMISSIONS
            });
          }

          // Ticket Creator Overwrite
          if (ownerId) {
            tktOverwrites.push({
              id: ownerId,
              type: 1, // member
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AddReactions
              ]
            });

            // Ensure ticket record in database
            if (!dbTicket) {
              const numMatch = chan.name.match(/\d+/);
              const ticketNum = numMatch ? parseInt(numMatch[0], 10) : 1;
              await createTicket({
                guild_id: guildId,
                channel_id: chan.id,
                owner_id: ownerId,
                ticket_number: ticketNum,
                status: 'open',
                category_id: ticketCategories[0]?.id || null
              }).catch(() => {});
            }
          }

          // Staff roles
          for (const roleId of staffRoleIds) {
            tktOverwrites.push({
              id: roleId,
              type: 0,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
              ]
            });
          }

          // Owner roles
          for (const roleId of ownerRoleIds) {
            tktOverwrites.push({
              id: roleId,
              type: 0,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ManageMessages
              ]
            });
          }

          await chan.permissionOverwrites.set(tktOverwrites).catch(err => {
            logger.warn({ err, channelId: chan.id }, 'Failed to set private overwrites on ticket channel');
          });
          summary.ticketsRepaired++;
          continue;
        }

        // B. REPAIR TICKET CATEGORIES
        if (chan.type === ChannelType.GuildCategory && ticketCategoryIds.has(chan.id)) {
          await chan.permissionOverwrites.edit(guild.id, {
            ViewChannel: false
          }).catch(() => {});

          for (const roleId of memberRoleIds) {
            await chan.permissionOverwrites.edit(roleId, {
              ViewChannel: false
            }).catch(() => {});
          }

          for (const roleId of staffRoleIds) {
            await chan.permissionOverwrites.edit(roleId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              ManageChannels: true,
              ManageMessages: true
            }).catch(() => {});
          }

          for (const roleId of ownerRoleIds) {
            await chan.permissionOverwrites.edit(roleId, {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true,
              ManageChannels: true,
              ManageMessages: true
            }).catch(() => {});
          }

          summary.ticketCategoriesRepaired++;
          continue;
        }

        // C. REPAIR TICKET PANELS (Must be viewable by everyone, buttons interactive, but no chatting)
        const isPanel = ticketPanelChannelIds.has(chan.id) ||
          (chan.name.includes('ticket') && !ticketCategoryIds.has(chan.id) && !logChannelIds.has(chan.id));

        if (isPanel) {
          await chan.permissionOverwrites.edit(guild.id, {
            ViewChannel: true,
            ReadMessageHistory: true,
            SendMessages: false
          }).catch(() => {});

          for (const roleId of memberRoleIds) {
            await chan.permissionOverwrites.edit(roleId, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false
            }).catch(() => {});
          }

          summary.ticketPanelsRepaired++;
          continue;
        }

        // D. REPAIR NORMAL COMMUNITY CHANNELS
        // If a normal channel has @everyone denied ViewChannel, remove deny and ensure allow ViewChannel!
        if (
          !logChannelIds.has(chan.id) &&
          !ticketCategoryIds.has(chan.id) &&
          !isTktChan &&
          !isPanel
        ) {
          const owEveryone = chan.permissionOverwrites.cache.get(guild.id);
          if (owEveryone?.deny?.has(PermissionFlagsBits.ViewChannel)) {
            await chan.permissionOverwrites.edit(guild.id, {
              ViewChannel: true
            }).catch(() => {});
            summary.normalChannelsRepaired++;
          }
        }
      }

      summary.guildsProcessed++;
    } catch (err) {
      logger.error({ err, guildId: guild.id }, 'Error during guild auto-repair');
      summary.errors.push({ guildId: guild.id, error: err.message });
    }
  }

  logger.info(
    {
      guilds: summary.guildsProcessed,
      normalRepaired: summary.normalChannelsRepaired,
      panelsRepaired: summary.ticketPanelsRepaired,
      categoriesRepaired: summary.ticketCategoriesRepaired,
      ticketsRepaired: summary.ticketsRepaired
    },
    '✓ Completed automatic permission repair & ticket protection across all guilds'
  );

  return summary;
}

export default {
  autoRepairPermissionsAndTickets
};

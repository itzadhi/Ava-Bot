import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { logger } from '../../utils/logger.js';

/**
 * Builds the celebration announcement card strictly using Discord Components V2
 * @param {object} params
 * @param {import('discord.js').GuildMember} params.member
 * @param {import('discord.js').Guild} params.guild
 * @param {number} [params.boostCount]
 * @param {number} [params.tier]
 * @param {string} [params.customMessage]
 * @returns {{ components: [ContainerBuilder], flags: number }}
 */
export function buildBoostCelebrationCard({
  member,
  guild,
  boostCount = guild.premiumSubscriptionCount || 1,
  tier = guild.premiumTier || 0,
  customMessage = null
}) {
  const container = new ContainerBuilder();
  const section = new SectionBuilder();

  const username = member.user?.username || member.displayName || 'Server Booster';
  const avatarUrl = typeof member.displayAvatarURL === 'function'
    ? member.displayAvatarURL({ size: 256 })
    : (member.displayAvatarURL || guild.iconURL?.() || 'https://cdn.discordapp.com/embed/avatars/0.png');

  const tierNames = ['Level 0', 'Level 1', 'Level 2', 'Level 3'];
  const currentTier = tierNames[tier] || `Level ${tier}`;

  const messageText = customMessage || 'Thank you for boosting and supporting our server! Your exclusive booster perks and role have been unlocked.';

  // Components V2 layout with clean typography: #, ###, -, **bold**
  const content =
    `# 🚀 Server Boosted!\n` +
    `### Huge appreciation to ${username}!\n` +
    `<@${member.id}> just upgraded the server with a Discord Boost.\n\n` +
    `### Server Boost Progress\n` +
    `- **Current Status:** **${currentTier}**\n` +
    `- **Total Server Boosts:** **${boostCount}** active boost(s)\n` +
    `- **Booster:** <@${member.id}> (\`${member.user?.tag || username}\`)\n\n` +
    `> ${messageText}`;

  section.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

  if (avatarUrl) {
    section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
  }

  container.addSectionComponents(section);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2
  };
}

/**
 * Handles guildMemberUpdate event to detect boosts and auto-assign / remove roles
 * @param {import('discord.js').GuildMember} oldMember
 * @param {import('discord.js').GuildMember} newMember
 */
export async function handleBoostMemberUpdate(oldMember, newMember) {
  if (!newMember.guild) return;

  const guild = newMember.guild;
  const settings = await getGuildSettings(guild.id);
  if (!settings || settings.boost_tracking_enabled === false) return;

  const wasBoosting = Boolean(oldMember?.premiumSince);
  const isBoosting = Boolean(newMember?.premiumSince);

  // 1. Member started boosting
  if (!wasBoosting && isBoosting) {
    logger.info({ guildId: guild.id, userId: newMember.id }, 'Detected new server boost event');

    // Auto-Assign booster role if configured
    if (settings.boost_auto_role_enabled !== false && settings.boost_role_id) {
      const roleId = settings.boost_role_id;
      const me = guild.members.me || guild.client?.user;
      const canManageRoles = guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles);

      if (canManageRoles && !newMember.roles.cache.has(roleId)) {
        try {
          await newMember.roles.add(roleId, 'AVA Auto-Booster Role: Member boosted the server');
          logger.info({ guildId: guild.id, userId: newMember.id, roleId }, 'Auto-assigned booster role');
        } catch (err) {
          logger.warn({ err, roleId }, 'Failed to auto-assign booster role');
        }
      }
    }

    // Send boost celebration announcement
    const channelId = settings.boost_channel_id || guild.systemChannelId;
    if (channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel && channel.isTextBased?.()) {
        try {
          const cardPayload = buildBoostCelebrationCard({
            member: newMember,
            guild,
            boostCount: guild.premiumSubscriptionCount,
            tier: guild.premiumTier,
            customMessage: settings.boost_message
          });

          await channel.send(cardPayload);
        } catch (err) {
          logger.warn({ err, channelId }, 'Failed to send boost celebration card');
        }
      }
    }
  }

  // 2. Member stopped boosting
  if (wasBoosting && !isBoosting) {
    logger.info({ guildId: guild.id, userId: newMember.id }, 'Member stopped boosting server');

    if (settings.boost_auto_role_enabled !== false && settings.boost_role_id) {
      const roleId = settings.boost_role_id;
      const canManageRoles = guild.members.me?.permissions?.has(PermissionFlagsBits.ManageRoles);

      if (canManageRoles && newMember.roles.cache.has(roleId)) {
        try {
          await newMember.roles.remove(roleId, 'AVA Auto-Booster Role: Server boost expired');
          logger.info({ guildId: guild.id, userId: newMember.id, roleId }, 'Removed booster role');
        } catch (err) {
          logger.warn({ err, roleId }, 'Failed to remove booster role');
        }
      }
    }
  }
}

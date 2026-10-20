import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import { buildBotProfilePanel } from '../../modules/settings/botprofile.js';
import { errorCard } from '../../ui/cards.js';
import { logger } from '../../utils/logger.js';

export default {
  name: 'botprofile',
  aliases: ['botidentity', 'setbot', 'serverprofile', 'guildprofile'],
  description: "Customize the bot's nickname, avatar icon, banner, and About Me bio for this server",
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 3,
  args: [
    {
      name: 'name',
      description: "New nickname/display name for the bot in this server",
      type: 'string',
      required: false
    },
    {
      name: 'icon',
      description: "New avatar icon attachment for the bot in this server",
      type: 'attachment',
      required: false
    },
    {
      name: 'icon_url',
      description: "Image URL for the bot's server avatar icon",
      type: 'string',
      required: false
    },
    {
      name: 'banner',
      description: "New banner image attachment for the bot in this server",
      type: 'attachment',
      required: false
    },
    {
      name: 'banner_url',
      description: "Image URL for the bot's server banner",
      type: 'string',
      required: false
    },
    {
      name: 'about_me',
      description: "New About Me bio text for the bot in this server",
      type: 'string',
      required: false
    },
    {
      name: 'reset',
      description: "Reset the bot's server profile customizations back to default",
      type: 'boolean',
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be used inside a Discord server.',
        ephemeral: true
      }));
    }

    // Permission check
    const isOwner = ctx.guild.ownerId === ctx.user.id;
    const canManage = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
    if (!isOwner && !canManage) {
      return ctx.reply(errorCard({
        title: 'Missing Permissions',
        reason: 'You need the **Manage Server** permission to customize the bot profile.',
        ephemeral: true
      }));
    }

    const reset = Boolean(ctx.args?.reset);
    const name = ctx.args?.name;
    const iconUrl = ctx.args?.icon?.url || ctx.args?.icon_url || null;
    const bannerUrl = ctx.args?.banner?.url || ctx.args?.banner_url || null;
    const aboutMe = ctx.args?.about_me || ctx.args?.bio;

    const me = ctx.guild.members.me;
    const currentSettings = await getGuildSettings(ctx.guild.id);

    // ── CASE 1: RESET PROFILE TO DEFAULT ──
    if (reset) {
      try {
        if (me && typeof ctx.guild.members.editMe === 'function') {
          await ctx.guild.members.editMe({
            nick: null,
            avatar: null,
            banner: null,
            bio: null,
            reason: `Reset bot server profile by ${ctx.user.tag}`
          }).catch(err => {
            logger.warn({ err, guildId: ctx.guild.id }, 'Could not reset some guild member profile fields via editMe');
          });
        } else if (me?.setNickname) {
          await me.setNickname(null, `Reset bot server profile by ${ctx.user.tag}`).catch(() => {});
        }

        const clearedSettings = {
          bot_nickname: null,
          bot_avatar_url: null,
          bot_banner_url: null,
          bot_bio: null
        };
        await updateGuildSettings(ctx.guild.id, clearedSettings);

        const panel = buildBotProfilePanel({
          guild: ctx.guild,
          client: ctx.client,
          currentSettings: clearedSettings,
          note: 'Default profile restored.'
        });
        return ctx.reply(panel);
      } catch (err) {
        return ctx.reply(errorCard({
          title: 'Reset Failed',
          reason: err.message,
          ephemeral: true
        }));
      }
    }

    // ── CASE 2: DIRECT PARAMETER CUSTOMIZATION ──
    const hasChanges = (name !== undefined) || iconUrl || bannerUrl || (aboutMe !== undefined);
    if (hasChanges) {
      const updatePayload = {
        reason: `Bot profile updated by ${ctx.user.tag} (${ctx.user.id})`
      };
      const dbUpdates = {};

      if (name !== undefined) {
        const cleanName = name.trim().slice(0, 32);
        updatePayload.nick = cleanName || null;
        dbUpdates.bot_nickname = cleanName || null;
      }

      if (iconUrl) {
        updatePayload.avatar = iconUrl;
        dbUpdates.bot_avatar_url = iconUrl;
      }

      if (bannerUrl) {
        updatePayload.banner = bannerUrl;
        dbUpdates.bot_banner_url = bannerUrl;
      }

      if (aboutMe !== undefined) {
        const cleanBio = aboutMe.trim().slice(0, 190);
        updatePayload.bio = cleanBio || null;
        dbUpdates.bot_bio = cleanBio || null;
      }

      try {
        if (me && typeof ctx.guild.members.editMe === 'function') {
          await ctx.guild.members.editMe(updatePayload);
        } else if (me?.setNickname && updatePayload.nick !== undefined) {
          await me.setNickname(updatePayload.nick, updatePayload.reason);
        }

        const updatedSettings = await updateGuildSettings(ctx.guild.id, dbUpdates);

        const panel = buildBotProfilePanel({
          guild: ctx.guild,
          client: ctx.client,
          currentSettings: updatedSettings || { ...currentSettings, ...dbUpdates },
          note: 'Profile attributes updated successfully.'
        });
        return ctx.reply(panel);
      } catch (err) {
        logger.error({ err, guildId: ctx.guild.id }, 'Failed to update bot server profile');
        let fix = 'Check bot permissions (ensure "Change Nickname" is enabled).';
        if (err.message?.includes('avatar') || err.message?.includes('banner')) {
          fix = 'Discord per-server avatars or banners may require server boosting or valid image formats (PNG, JPG, WebP).';
        }
        return ctx.reply(errorCard({
          title: 'Profile Update Failed',
          reason: err.message || 'Discord rejected the profile update request.',
          fix,
          ephemeral: true
        }));
      }
    }

    // ── CASE 3: RENDER FULL INTERACTIVE PANEL ──
    const panel = buildBotProfilePanel({
      guild: ctx.guild,
      client: ctx.client,
      currentSettings
    });

    return ctx.reply(panel);
  }
};

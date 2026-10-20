import { PermissionFlagsBits } from 'discord.js';
import { buildTTSPanel } from '../../modules/voice/tts/panel.js';
import { errorCard, successCard } from '../../ui/cards.js';

export default {
  name: 'ttspanel',
  aliases: ['ttscontrol', 'speechpanel', 'readerpanel'],
  description: 'Open or deploy the interactive Text-to-Speech reader and voice control panel',
  category: 'voice',
  cooldown: 3,
  args: [
    {
      name: 'channel',
      description: 'The text channel where the persistent TTS control panel should be sent',
      type: 'channel',
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

    // ── CASE 1: DEPLOY TO SPECIFIC CHANNEL ──
    if (ctx.args?.channel) {
      const isOwner = ctx.guild.ownerId === ctx.user.id;
      const canManage = ctx.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
      if (!isOwner && !canManage) {
        return ctx.reply(errorCard({
          title: 'Missing Permissions',
          reason: 'You need the **Manage Server** permission to deploy the panel into a specific channel.',
          ephemeral: true
        }));
      }

      let targetChannel = ctx.channel;
      const targetChannelId = typeof ctx.args.channel === 'object' ? ctx.args.channel.id : ctx.args.channel;
      const resolved = ctx.guild.channels.cache.get(targetChannelId);
      if (resolved && resolved.isTextBased()) {
        targetChannel = resolved;
      }

      if (!targetChannel || !targetChannel.isTextBased()) {
        return ctx.reply(errorCard({
          title: 'Invalid Channel',
          reason: 'The target channel must be a text-based channel.',
          ephemeral: true
        }));
      }

      const panel = await buildTTSPanel({
        guild: ctx.guild,
        client: ctx.client,
        user: ctx.user,
        note: `Deployed to <#${targetChannel.id}>.`
      });

      try {
        await targetChannel.send(panel);

        return ctx.reply(successCard({
          title: 'TTS Control Panel Deployed',
          subtitle: `Interactive speech interface is live in <#${targetChannel.id}>.`,
          details: [
            { label: 'Channel', value: `<#${targetChannel.id}>` },
            { label: 'Usage', value: 'Members can manage their voice, connect, and control playback directly from this panel' }
          ],
          ephemeral: true
        }));
      } catch (err) {
        return ctx.reply(errorCard({
          title: 'Deployment Failed',
          reason: err.message,
          ephemeral: true
        }));
      }
    }

    // ── CASE 2: DIRECT EXECUTION IN CURRENT CHANNEL ──
    const panel = await buildTTSPanel({
      guild: ctx.guild,
      client: ctx.client,
      user: ctx.user
    });

    return ctx.reply(panel);
  }
};

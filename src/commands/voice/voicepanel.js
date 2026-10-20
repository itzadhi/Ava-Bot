import { PermissionFlagsBits } from 'discord.js';
import { buildCommonControlCard } from '../../modules/voice/control.js';
import { errorCard, successCard } from '../../ui/cards.js';

export default {
  name: 'voicepanel',
  aliases: ['jtcpanel', 'voicecontrol', 'vpanel'],
  description: 'Deploy the persistent common voice control panel for temporary voice rooms',
  category: 'voice',
  permissions: [PermissionFlagsBits.ManageGuild],
  cooldown: 5,
  args: [
    {
      name: 'channel',
      description: 'The text channel where the voice control panel should be sent',
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

    let targetChannel = ctx.channel;
    if (ctx.args.channel) {
      const resolved = ctx.guild.channels.cache.get(ctx.args.channel);
      if (resolved && resolved.isTextBased()) {
        targetChannel = resolved;
      }
    }

    if (!targetChannel || !targetChannel.isTextBased()) {
      return ctx.reply(errorCard({
        title: 'Invalid Channel',
        reason: 'The target channel must be a text-based channel.',
        ephemeral: true
      }));
    }

    const payload = buildCommonControlCard({ guild: ctx.guild, client: ctx.client });

    try {
      await targetChannel.send(payload);

      return ctx.reply(successCard({
        title: 'Voice Control Panel Deployed',
        subtitle: `Common voice control interface is live in <#${targetChannel.id}>.`,
        details: [
          { label: 'Channel', value: `<#${targetChannel.id}>` },
          { label: 'Access', value: 'Temporary voice room creators can now manage their channels directly from this panel' }
        ],
        ephemeral: true
      }));
    } catch (err) {
      return ctx.reply(errorCard({
        title: 'Deployment Failed',
        reason: `Could not send panel to <#${targetChannel.id}>: ${err.message}`,
        fix: 'Ensure the bot has permission to View Channel and Send Messages there.',
        ephemeral: true
      }));
    }
  }
};

import { MessageFlags } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import {
  postSuggestionMessage,
  checkSuggestionCooldown,
  checkStaffPermission
} from '../../modules/suggestions/index.js';
import { errorCard, successCard } from '../../ui/cards.js';

// Cooldown map: `${guildId}:${userId}` -> timestamp
const cooldowns = new Map();

export default {
  name: 'suggest',
  aliases: ['suggestion'],
  description: 'Submit a suggestion for server or community improvement',
  category: 'suggestions',
  cooldown: 0, // Handled dynamically via guild settings
  args: [
    {
      name: 'text',
      description: 'Your suggestion content (up to 2000 characters)',
      type: 'string',
      required: true
    },
    {
      name: 'image',
      description: 'Optional image attachment for your suggestion',
      type: 'attachment',
      required: false
    },
    {
      name: 'image_url',
      description: 'Optional image URL for your suggestion',
      type: 'string',
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'This command can only be run inside a Discord server.',
        ephemeral: true
      }));
    }

    const text = (ctx.args.text || '').trim();
    if (text.length < 3 || text.length > 2000) {
      return ctx.reply(errorCard({
        title: 'Invalid Length',
        reason: 'Suggestion text must be between 3 and 2000 characters.',
        fix: 'Please provide a valid suggestion.',
        ephemeral: true
      }));
    }

    const imageUrl = ctx.args.image?.url || ctx.args.image_url || null;

    const guildSettings = await getGuildSettings(ctx.guild.id);

    // Check if suggestions module is enabled
    if (guildSettings?.suggestions_enabled === false) {
      return ctx.reply(errorCard({
        title: 'Suggestions Disabled',
        reason: 'The suggestions system is currently disabled by server administration.',
        ephemeral: true
      }));
    }

    // Check configured suggestions channel or auto-discover
    let channelId = guildSettings?.suggestion_channel_id;
    let targetChannel = channelId ? ctx.guild.channels.cache.get(channelId) : null;

    if (!targetChannel) {
      const autoChan = ctx.guild.channels.cache.find(c => c.isTextBased?.() && /suggest/i.test(c.name));
      if (autoChan) {
        targetChannel = autoChan;
        channelId = autoChan.id;
        await updateGuildSettings(ctx.guild.id, { suggestion_channel_id: autoChan.id }).catch(() => {});
      }
    }

    if (!targetChannel) {
      return ctx.reply(errorCard({
        title: 'Channel Not Configured',
        reason: 'The suggestions channel has not been set up yet.',
        fix: 'A server manager can configure it via `/setting` or create a channel named `#suggestions`.',
        ephemeral: true
      }));
    }

    // Cooldown check (default 0s, configurable)
    const cooldownSec = guildSettings?.suggestion_cooldown ?? 0;
    const isStaff = await checkStaffPermission({ member: ctx.member, guildId: ctx.guild.id }).catch(() => false);
    if (!isStaff && cooldownSec > 0) {
      const { onCooldown, remaining } = checkSuggestionCooldown(ctx.guild.id, ctx.user.id, cooldownSec);
      if (onCooldown) {
        return ctx.reply(errorCard({
          title: 'Cooldown Active',
          reason: `You can only submit one suggestion every ${cooldownSec} seconds.`,
          fix: `Please wait ${remaining} second(s) before submitting another suggestion.`,
          ephemeral: true
        }));
      }
    }

    try {
      const { suggestion, thread } = await postSuggestionMessage({
        guild: ctx.guild,
        channel: targetChannel,
        author: ctx.user,
        text,
        imageUrl
      });

      const details = [
        { label: 'Suggestion ID', value: `\`${suggestion.id}\`` },
        { label: 'Votes', value: 'Community members can now cast their votes' }
      ];
      if (thread) {
        details.push({ label: 'Discussion Thread', value: `<#${thread.id}>` });
      }

      // Reply to invoking user ephemerally
      return ctx.reply(successCard({
        title: 'Suggestion Submitted',
        subtitle: `Your suggestion has been posted to <#${targetChannel.id}>.`,
        details,
        ephemeral: true
      }));
    } catch (err) {
      return ctx.reply(errorCard({
        title: 'Submission Failed',
        reason: err.message,
        ephemeral: true
      }));
    }
  }
};

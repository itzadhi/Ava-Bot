import { MessageFlags } from 'discord.js';
import { getGuildSettings, updateGuildSettings } from '../../db/guilds.js';
import {
  buildFeedbackPanel,
  postFeedbackMessage,
  buildStars,
  getRatingSentiment
} from '../../modules/feedback/index.js';
import { errorCard, successCard } from '../../ui/cards.js';

export default {
  name: 'feedback',
  aliases: ['review', 'fbk'],
  description: 'Submit server feedback, share reviews, or suggest improvements',
  category: 'feedback',
  cooldown: 3,
  args: [
    {
      name: 'rating',
      description: 'Your rating from 1 to 5 stars',
      type: 'choice',
      choices: ['5', '4', '3', '2', '1'],
      required: false
    },
    {
      name: 'review',
      description: 'Your feedback or experience details',
      type: 'string',
      required: false
    }
  ],
  async execute(ctx) {
    if (!ctx.guild) {
      return ctx.reply(errorCard({
        title: 'Server Only',
        reason: 'Feedback can only be submitted from inside a Discord server.',
        ephemeral: true
      }));
    }

    const guildSettings = await getGuildSettings(ctx.guild.id);

    // Check if feedback is enabled
    if (guildSettings?.feedback_enabled === false) {
      return ctx.reply(errorCard({
        title: 'Feedback Disabled',
        reason: 'The feedback system is currently disabled by server administration.',
        ephemeral: true
      }));
    }

    // Direct submission if both rating and review are passed as command arguments
    const ratingStr = ctx.args.rating;
    const reviewText = (ctx.args.review || '').trim();

    if (ratingStr && reviewText) {
      const ratingNum = parseInt(ratingStr, 10);
      let targetChannel = guildSettings?.feedback_channel_id ? ctx.guild.channels.cache.get(guildSettings.feedback_channel_id) : null;
      if (!targetChannel) {
        targetChannel = ctx.guild.channels.cache.find(c => c.isTextBased?.() && /(feedback|review)/i.test(c.name));
        if (targetChannel) {
          await updateGuildSettings(ctx.guild.id, { feedback_channel_id: targetChannel.id }).catch(() => {});
        }
      }

      if (!targetChannel) {
        return ctx.reply(errorCard({
          title: 'Feedback Channel Missing',
          reason: 'No feedback channel is configured yet on this server.',
          fix: 'An administrator can configure it via `/setting` or create `#feedback`.',
          ephemeral: true
        }));
      }

      await postFeedbackMessage({
        guild: ctx.guild,
        channel: targetChannel,
        author: ctx.user,
        message: reviewText,
        rating: ratingNum
      });

      const stars = buildStars(ratingNum);
      const sentiment = getRatingSentiment(ratingNum);
      return ctx.reply(successCard({
        title: 'Feedback Submitted!',
        subtitle: `Your review has been published in <#${targetChannel.id}>.`,
        details: [
          { label: 'Rating', value: `${stars} (${ratingNum}/5 · ${sentiment})` },
          { label: 'Review', value: reviewText.length > 100 ? `${reviewText.slice(0, 97)}...` : reviewText }
        ],
        ephemeral: true
      }));
    }

    // Default to interactive feedback & suggestion panel
    const botAvatar = ctx.client.user.displayAvatarURL({ size: 128, extension: 'png' });
    const panel = buildFeedbackPanel(botAvatar);
    return ctx.reply({ ...panel, ephemeral: true });
  }
};


// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

import { getEmoji } from '../handlers/emoji.js';
import { pendingImageMap } from './interactionCreate.js';
import { buildFeedbackCard, pendingGuildMap } from '../commands/feedback.js';
import { getGuildConfig } from '../handlers/feedback.js';
import {
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
} from 'discord.js';
import { PREFIX } from '../utils/config.js';

export default {
  name: 'messageCreate',
  once: false,
  async execute(message, client) {
    if (message.author.bot) return;

    const pending = pendingImageMap.get(message.author.id);
    if (pending) {
      const attachment = message.attachments.find(a =>
        a.contentType?.startsWith('image/'),
      );

      if (attachment) {
        clearTimeout(pending.timeout);
        pendingImageMap.delete(message.author.id);

        await message.react(getEmoji('success') || '✅').catch(() => {});

        const guildCfg = getGuildConfig(pending.guildId);
        const guild = client.guilds.cache.get(pending.guildId);
        const channel = guild?.channels.cache.get(guildCfg?.feedbackChannel);

        if (!channel) {
          const err = new ContainerBuilder();
          err.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `${getEmoji('error')} Feedback channel not found — ask an admin to re-run \`/setup\``,
            ),
          );
          await pending.editFn({ components: [err], flags: MessageFlags.IsComponentsV2 });
          return;
        }

        const card = buildFeedbackCard({
          rating: pending.ratingNum,
          review: pending.review,
          imageUrl: attachment.url,
          user: message.author,
        });

        await channel.send(card);
        pendingGuildMap.delete(message.author.id);

        const c = new ContainerBuilder();
        c.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('success')} **Posted.** Your review is live in <#${channel.id}>\n-# ${getEmoji('heart')} Thanks for taking the time — it genuinely helps`,
          ),
        );
        await pending.editFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
        return;
      }
    }

    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
    const commandName = args.shift().toLowerCase();

    const command = client.prefixCommands.get(commandName);
    if (!command) return;

    try {
      await command.prefixExecute(message, args, client);
    } catch (err) {
      console.error(err);
      await message.reply(`${getEmoji('error')} Something went wrong.`).catch(() => {});
    }
  },
};

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

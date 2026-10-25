// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig } from '../handlers/feedback.js';
import { getEmoji } from '../handlers/emoji.js';
import { buildFeedbackCard, pendingGuildMap } from '../commands/feedback.js';
import { PREFIX } from '../utils/config.js';

export const pendingImageMap = new Map();

function buildImagePrompt(channelId) {
  const c = new ContainerBuilder();
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${getEmoji('info')} **Got it!** Want to attach a screenshot to your review?\n\n**Drop an image** in this DM (or the current channel) right now, or hit **Skip** to post without one.\n-# You have 60 seconds`,
    ),
  );
  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('skip_image')
        .setLabel('Skip — post without image')
        .setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

async function postFeedback({ client, guildId, ratingNum, review, imageUrl, user, replyFn, editFn }) {
  const guildCfg = getGuildConfig(guildId);
  if (!guildCfg?.feedbackChannel) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${getEmoji('warning')} Feedback channel not set up yet — ask an admin to run \`/setup\``,
      ),
    );
    await editFn({ components: [err], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${getEmoji('error')} Couldn't find the server — make sure the bot is still in it`,
      ),
    );
    await editFn({ components: [err], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const channel = guild.channels.cache.get(guildCfg.feedbackChannel);
  if (!channel) {
    const err = new ContainerBuilder();
    err.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${getEmoji('error')} Feedback channel not found — ask an admin to re-run \`/setup\``,
      ),
    );
    await editFn({ components: [err], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const card = buildFeedbackCard({ rating: ratingNum, review, imageUrl: imageUrl || null, user });
  await channel.send(card);
  pendingGuildMap.delete(user.id);
  pendingImageMap.delete(user.id);

  const c = new ContainerBuilder();
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${getEmoji('success')} **Posted.** Your review is live in <#${channel.id}>\n-# ${getEmoji('heart')} Thanks for taking the time — it genuinely helps`,
    ),
  );
  await editFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

export default {
  name: 'interactionCreate',
  once: false,
  async execute(interaction, client) {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction, client);
      } catch (err) {
        console.error(err);
        const msg = { content: `${getEmoji('error')} something went wrong`, flags: 64 };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(msg).catch(() => { });
        } else {
          await interaction.reply(msg).catch(() => { });
        }
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === 'open_feedback_modal') {
      const modal = new ModalBuilder()
        .setCustomId('feedback_modal')
        .setTitle('Adhi Development — Service Review');

      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('rating')
            .setLabel('Rate our service (1–5) *')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1 to 5')
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(1),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('review')
            .setLabel('Your feedback *')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Tell us about your experience...')
            .setRequired(true)
            .setMaxLength(2000),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('image_url')
            .setLabel('Screenshot URL (optional)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('https://... — or leave blank to upload a file after')
            .setRequired(false),
        ),
      );

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'skip_image') {
      const pending = pendingImageMap.get(interaction.user.id);
      if (!pending) {
        await interaction.reply({ content: `${getEmoji('error')} No pending review found. Please start over.`, flags: 64 });
        return;
      }

      await interaction.deferUpdate();
      clearTimeout(pending.timeout);

      await postFeedback({
        client,
        guildId: pending.guildId,
        ratingNum: pending.ratingNum,
        review: pending.review,
        imageUrl: null,
        user: interaction.user,
        editFn: (data) => interaction.editReply(data),
      });
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'feedback_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const rating = interaction.fields.getTextInputValue('rating');
      const review = interaction.fields.getTextInputValue('review');
      const imageUrl = interaction.fields.getTextInputValue('image_url').trim();

      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        const err = new ContainerBuilder();
        err.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('error')} Rating must be a number between **1** and **5**`,
          ),
        );
        await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      const guildId = interaction.guildId || pendingGuildMap.get(interaction.user.id);
      if (!guildId) {
        const err = new ContainerBuilder();
        err.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('error')} Couldn't find which server to post your review to — run \`${PREFIX}feedback\` inside the server`,
          ),
        );
        await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      if (imageUrl && imageUrl.startsWith('http')) {
        await postFeedback({
          client,
          guildId,
          ratingNum,
          review,
          imageUrl,
          user: interaction.user,
          editFn: (data) => interaction.editReply(data),
        });
        return;
      }

      const timeoutId = setTimeout(async () => {
        const p = pendingImageMap.get(interaction.user.id);
        if (!p) return;
        pendingImageMap.delete(interaction.user.id);
        const expired = new ContainerBuilder();
        expired.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('warning')} Image upload timed out — your review was **not** posted. Run \`/feedback\` or \`${PREFIX}feedback\` to try again.`,
          ),
        );
        await interaction.editReply({ components: [expired], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
      }, 60_000);

      pendingImageMap.set(interaction.user.id, {
        guildId,
        ratingNum,
        review,
        interactionChannelId: interaction.channelId,
        timeout: timeoutId,
        editFn: (data) => interaction.editReply(data),
      });

      await interaction.editReply(buildImagePrompt(interaction.channelId));
      return;
    }
  },
};

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

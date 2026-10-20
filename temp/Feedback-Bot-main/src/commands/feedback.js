// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

import {
  SlashCommandBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { buildStars } from '../handlers/feedback.js';
import { getEmoji } from '../handlers/emoji.js';
import { PREFIX } from '../utils/config.js';

export function buildFeedbackCard({ rating, review, imageUrl, user }) {
  const stars = buildStars(rating);
  const avatarURL = user.displayAvatarURL({ size: 256, extension: 'png' });
  const time = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const c = new ContainerBuilder();

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${getEmoji('feedback')} New Feedback Is Here`),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `> *"${review}"*\n\n${stars}  **${rating} / 5**`,
        ),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarURL)),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${getEmoji('user')} **${user.username}**\n-# ${getEmoji('date')} User ID: \`${user.id}\`  ·  ${time}`,
    ),
  );

  if (imageUrl && imageUrl.startsWith('http')) {
    try {
      c.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(false),
      );
      const g = new MediaGalleryBuilder();
      g.addItems(new MediaGalleryItemBuilder().setURL(imageUrl));
      c.addMediaGalleryComponents(g);
    } catch {}
  }

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_feedback_modal')
        .setLabel('Leave a Review Too')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function buildPanel(botAvatarURL) {
  const c = new ContainerBuilder();

  c.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${getEmoji('review')} AeroX Feedback\nYour honest opinion actually matters here.\nNo fake reviews, no filters — just real experiences from real users.`,
        ),
      )
      .setThumbnailAccessory(
        new ThumbnailBuilder().setURL(botAvatarURL),
      ),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Hit the button below to open the review form.\nIt only takes a minute — and the team reads every single one.`,
    ),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_feedback_modal')
        .setLabel('Write Your Review')
        .setStyle(ButtonStyle.Primary),
    ),
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

export const pendingGuildMap = new Map();

export default {
  data: new SlashCommandBuilder()
    .setName('feedback')
    .setDescription('Drop a review for AeroX services'),
  prefix: 'feedback',

  async execute(interaction) {
    const panel = buildPanel(interaction.client.user.displayAvatarURL({ size: 128, extension: 'png' }));
    panel.flags = (panel.flags || 0) | MessageFlags.Ephemeral;
    await interaction.reply(panel);
  },

  async prefixExecute(message) {
    await message.delete().catch(() => {});

    try {
      const panel = buildPanel(message.client.user.displayAvatarURL({ size: 128, extension: 'png' }));
      await message.author.send(panel);
      pendingGuildMap.set(message.author.id, message.guildId);
      setTimeout(() => pendingGuildMap.delete(message.author.id), 3_600_000);
    } catch {
      const c = new ContainerBuilder();
      c.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${getEmoji('error')} **Couldn't DM you** — open your Privacy Settings and enable *"Allow direct messages from server members"*\n-# Then try \`${PREFIX}feedback\` again`,
        ),
      );
      const notice = await message.channel.send({ components: [c], flags: MessageFlags.IsComponentsV2 });
      setTimeout(() => notice.delete().catch(() => {}), 7000);
    }
  },
};

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/aerox (AeroX Development )
// + for any queries reach out Community or DM me.

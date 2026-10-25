// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

import {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MessageFlags,
} from 'discord.js';
import { getEmoji } from '../handlers/emoji.js';
import { PREFIX } from '../utils/config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('See what Adhi Feedback can do'),
  prefix: 'help',

  async execute(interaction) {
    await interaction.reply(buildHelp(interaction.user, interaction.client));
  },

  async prefixExecute(message, _a, client) {
    await message.reply(buildHelp(message.author, client));
  },
};

function buildHelp(user, client) {
  const avatar = user.displayAvatarURL({ size: 128, extension: 'png' });
  const c = new ContainerBuilder();

  c.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `# ${getEmoji('bot')} Adhi Feedback\n-# Hey **${user.username}**, here's everything you need to know`,
        ),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${getEmoji('feedback')} **Feedback**\n\`/feedback\`  \`${PREFIX}feedback\` — Submit a review for Adhi\n${getEmoji('setup')} \`/setup\`  \`${PREFIX}setup\` — Set the feedback channel  *· Manage Server*`,
    ),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${getEmoji('info')} **Utility**\n\`/ping\`  \`${PREFIX}ping\` — Check bot latency\n\`/help\`  \`${PREFIX}help\` — You're already here`,
    ),
  );

  c.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true),
  );

  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${getEmoji('sparkle')} Serving **${client.guilds.cache.size}** servers  ·  Prefix: \`${PREFIX}\`  ·  Adhi Development`,
    ),
  );

  return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

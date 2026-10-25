// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  MessageFlags,
  ChannelType,
} from 'discord.js';
import { setGuildConfig, getGuildConfig } from '../handlers/feedback.js';
import { getEmoji } from '../handlers/emoji.js';
import { PREFIX } from '../utils/config.js';

function feedbackPanel() {
  const c = new ContainerBuilder();
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${getEmoji('review')} Adhi Feedback`));
  c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Been using Adhi? Tell us what you think.\nEvery single review gets read by the team — nothing goes ignored.`,
    ),
  );
  c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  c.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('open_feedback_modal')
        .setLabel('Write Your Review')
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return c;
}

async function lockChannel(channel, guild) {
  try {
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: false,
      AddReactions: false,
    });
    const me = guild.members.me;
    if (me) {
      await channel.permissionOverwrites.edit(me, {
        SendMessages: true,
        ViewChannel: true,
        EmbedLinks: true,
        AttachFiles: true,
        AddReactions: true,
      });
    }
  } catch { }
}

async function finishSetup(guildId, guild, channel, botAvatar, replyFn) {
  setGuildConfig(guildId, { feedbackChannel: channel.id });
  await lockChannel(channel, guild);
  await channel.send({ components: [feedbackPanel()], flags: MessageFlags.IsComponentsV2 });

  const ok = new ContainerBuilder();
  ok.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${getEmoji('success')} **Setup Complete**\n<#${channel.id}> is now live as the feedback channel.\nThe channel has been locked — only the bot can post there.`,
        ),
      )
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar)),
  );
  ok.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
  ok.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `-# ${getEmoji('info')} Users can submit reviews with \`/feedback\` or \`${PREFIX}feedback\` from anywhere in the server`,
    ),
  );

  await replyFn({ components: [ok], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
}

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure the feedback channel for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel to use (creates one if not provided)')
        .setRequired(false),
    ),
  prefix: 'setup',

  async execute(interaction) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: `${getEmoji('error')} You need **Manage Server** permission to do that.`, flags: 64 });
      return;
    }
    await interaction.deferReply({ flags: 64 });

    let channel = interaction.options.getChannel('channel');
    const botAvatar = interaction.client.user.displayAvatarURL({ size: 128, extension: 'png' });

    if (!channel) {
      const existing = getGuildConfig(interaction.guildId);
      if (existing?.feedbackChannel) channel = interaction.guild.channels.cache.get(existing.feedbackChannel);
    }

    if (!channel) {
      try {
        channel = await interaction.guild.channels.create({
          name: 'Adhi-reviews',
          type: ChannelType.GuildText,
          topic: `Submit your Adhi reviews here. Use /feedback or ${PREFIX}feedback.`,
        });
      } catch {
        const err = new ContainerBuilder();
        err.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('error')} **Couldn't create a channel** — I may be missing permissions.\nTry \`/setup #channel\` and mention an existing one.`,
          ),
        );
        await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        return;
      }
    }

    await finishSetup(interaction.guildId, interaction.guild, channel, botAvatar, m => interaction.editReply(m));
  },

  async prefixExecute(message) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await message.reply(`${getEmoji('error')} You need **Manage Server** permission to do that.`);
      return;
    }

    const botAvatar = message.client.user.displayAvatarURL({ size: 128, extension: 'png' });
    let channel = message.mentions.channels.first() || null;

    if (!channel) {
      const ask = new ContainerBuilder();
      ask.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `# ${getEmoji('setup')} Channel Setup\nWhich channel should receive feedback submissions?\n-# Mention it with **#channel-name** below — you have 30 seconds`,
            ),
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatar)),
      );

      const prompt = await message.reply({
        components: [ask],
        flags: MessageFlags.IsComponentsV2,
      });

      const filter = m => m.author.id === message.author.id;
      let collected;
      try {
        collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
      } catch {
        const timeout = new ContainerBuilder();
        timeout.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('warning')} **Timed out.** Run \`${PREFIX}setup #channel\` to try again.`,
          ),
        );
        await prompt.edit({ components: [timeout], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      const reply = collected.first();
      channel = reply.mentions.channels.first();
      await reply.delete().catch(() => { });
      await prompt.delete().catch(() => { });

      if (!channel) {
        const notfound = new ContainerBuilder();
        notfound.addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `${getEmoji('error')} **Couldn't find that channel** — make sure you mention it with \`#\`\n-# Example: \`${PREFIX}setup #reviews\``,
          ),
        );
        await message.reply({ components: [notfound], flags: MessageFlags.IsComponentsV2 });
        return;
      }
    }

    await finishSetup(message.guildId, message.guild, channel, botAvatar, m => message.reply(m));
  },
};

// : ! Warrior !
// + Discord: warriorog.exe_
// + Community: https://discord.gg/Adhi (Adhi Development )
// + for any queries reach out Community or DM me.

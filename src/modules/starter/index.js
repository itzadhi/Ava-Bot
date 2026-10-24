import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { defineModule } from '../../structures/Module.js';
import { card, successCard } from '../../ui/cards.js';
import { THEME } from '../../ui/theme.js';
import { getModuleData, setModuleData } from '../../db/moduleData.js';

/**
 * Starter Reference Module
 * Demonstrates how easily any developer can build an interactive feature
 * with Discord Components V2, Buttons, Modals, and Supabase persistence.
 */
export const starterModule = defineModule({
  name: 'starter',
  description: 'Reference starter module demonstrating Components V2 & Supabase persistence',
  version: '1.0.0',

  commands: [],

  components: [
    // 1. Button handler: Click counter
    {
      customId: 'starter:click:*',
      type: 'button',
      async execute(interaction, [guildId]) {
        const targetGuild = guildId || interaction.guildId || 'global';
        const currentCount = ((await getModuleData('starter', 'clicks', targetGuild)) || 0) + 1;
        await setModuleData('starter', 'clicks', currentCount, targetGuild);

        const note = (await getModuleData('starter', 'note', targetGuild)) || 'No custom note set yet.';

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`starter:click:${targetGuild}`)
            .setLabel(`Increment Counter (${currentCount})`)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⚡'),
          new ButtonBuilder()
            .setCustomId(`starter:modal:${targetGuild}`)
            .setLabel('Set Note')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📝')
        );

        return interaction.update(card({
          title: 'Starter Module',
          glyph: THEME.glyphs.sparkle,
          subtitle: 'Interactive test module',
          body: `**Counter**: \`${currentCount}\` clicks recorded\n**Stored Note**: ${note}\n\n*Click the buttons below to interactively test stateful components.*`,
          subtext: 'Updated just now',
          color: THEME.colors.success,
          rows: [row]
        }));
      }
    },

    // 2. Button handler: Launch Modal
    {
      customId: 'starter:modal:*',
      type: 'button',
      async execute(interaction, [guildId]) {
        const targetGuild = guildId || interaction.guildId || 'global';

        const modal = new ModalBuilder()
          .setCustomId(`starter:submit:${targetGuild}`)
          .setTitle('Set Module Note')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('note_input')
                .setLabel('Enter your custom note')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(200)
                .setPlaceholder('Write something to persist to Supabase...')
            )
          );

        return interaction.showModal(modal);
      }
    },

    // 3. Modal submit handler: Save note to Supabase
    {
      customId: 'starter:submit:*',
      type: 'modal',
      async execute(interaction, [guildId]) {
        const targetGuild = guildId || interaction.guildId || 'global';
        const note = interaction.fields.getTextInputValue('note_input');
        await setModuleData('starter', 'note', note, targetGuild);

        return interaction.reply(successCard({
          title: 'Note Saved',
          subtitle: 'Persisted successfully',
          body: `**Stored Note**: "${note}"`,
          subtext: null,
          ephemeral: true
        }));
      }
    }
  ]
});

export default starterModule;

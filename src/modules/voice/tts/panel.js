import {
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder
} from 'discord.js';
import { ComponentBuilder } from '../../../ui/builder.js';
import { getVoice, TTS_VOICES } from './voices.js';
import { ttsEngine } from './engine.js';
import { getUserTTSPrefs } from '../../../db/voice.js';

/**
 * Builds the interactive Text-to-Speech Control Panel.
 * Uses clean typography, headings, subheadings, - bullets, bold formatting,
 * and minimal emoji.
 *
 * @param {object} params
 * @param {import('discord.js').Guild} params.guild
 * @param {import('discord.js').Client} params.client
 * @param {import('discord.js').User} [params.user]
 * @param {object} [params.session]
 * @param {object} [params.userPrefs]
 * @param {string} [params.note]
 * @returns {Promise<{ flags: number, components: any[] }>}
 */
export async function buildTTSPanel({ guild, client, user = null, session = null, userPrefs = null, note = null }) {
  const currentSession = session !== undefined ? session : ttsEngine.getSession(guild.id);
  const prefs = userPrefs !== undefined ? userPrefs : (user ? await getUserTTSPrefs(user.id, guild.id) : null);
  const currentVoice = getVoice(prefs?.language || 'en-us');

  // Count active non-bot listeners if connected
  let listenerCount = 0;
  if (currentSession?.voiceChannelId) {
    const vc = guild.channels?.cache?.get(currentSession.voiceChannelId);
    if (vc?.members) {
      listenerCount = Array.from(vc.members.values()).filter(m => !m.user?.bot).length;
    }
  }

  const builder = new ComponentBuilder();

  // Headings & Subheadings
  builder.addText(`# Speech Synthesizer\n### Text-to-Speech Engine & Voice Reader`);
  builder.addSeparator();

  // Detail attributes using - and bold formatting
  const lines = [
    `- **Guild:** ${guild.name} (\`${guild.id}\`)`,
    `- **Reader Status:** ${currentSession ? 'Active (Connected)' : 'Disconnected (Idle)'}`,
    `- **Voice Channel:** ${currentSession?.voiceChannelId ? `<#${currentSession.voiceChannelId}>` : 'Not in voice'}`,
    `- **Bound Text Chat:** ${currentSession?.textChannelId ? `<#${currentSession.textChannelId}>` : 'None bound'}`,
    `- **Connected Listeners:** ${currentSession ? `${listenerCount} member(s)` : '0 member(s)'}`,
    `- **Your Active Voice:** ${currentVoice.emoji} ${currentVoice.name} (\`${currentVoice.id}\`)`,
    `- **Voice Category:** ${currentVoice.category}`,
    `- **Your TTS Status:** ${prefs?.opt_out ? 'Opted Out (Messages skipped)' : 'Opted In (Messages spoken)'}`,
    `- **Speech Format:** \`<Display Name> says, <Message>\``
  ];

  if (note) {
    lines.push(`\n- **Status:** ${note}`);
  }

  builder.addText(lines.join('\n'));
  builder.addSeparator();

  // Controls description
  builder.addText(
    `### Controls\n` +
    `Select a voice below to set your personal profile or use the buttons to manage reader playback.\n` +
    `-# Text-to-Speech processes messages locally with zero external API keys.`
  );

  // Top voice options for the select menu
  const featuredVoiceIds = [
    'robot', 'chipmunk', 'deep', 'giant', 'radio', 'echo',
    'fast', 'slow', 'helium', 'whisper', 'en-us', 'en-uk',
    'en-au', 'en-in', 'ja', 'es', 'fr', 'de'
  ];

  const selectOptions = featuredVoiceIds.map(id => {
    const v = TTS_VOICES[id] || getVoice(id);
    return {
      label: v.name,
      value: v.id,
      description: v.description.slice(0, 50),
      emoji: v.emoji,
      default: v.id === currentVoice.id
    };
  });

  builder.addStringSelect({
    id: 'fb:tts:voice_sel:0',
    placeholder: `Choose your TTS Voice (Current: ${currentVoice.name})`,
    options: selectOptions
  });

  // Action Row 1: Core playback buttons
  builder.addButton({
    id: 'fb:tts:join:0',
    label: 'Join & Bind',
    style: ButtonStyle.Success
  });

  builder.addButton({
    id: 'fb:tts:leave:0',
    label: 'Disconnect',
    style: ButtonStyle.Danger,
    disabled: !currentSession
  });

  builder.addButton({
    id: 'fb:tts:test_btn:0',
    label: 'Speak Test',
    style: ButtonStyle.Primary,
    disabled: !currentSession
  });

  builder.addButton({
    id: 'fb:tts:opt_toggle:0',
    label: prefs?.opt_out ? 'Opt In (Read My Chat)' : 'Opt Out (Skip My Chat)',
    style: ButtonStyle.Secondary
  });

  // Action Row 2: Secondary buttons
  builder.addButton({
    id: 'fb:tts:speak_mod_btn:0',
    label: 'Custom Text Test',
    style: ButtonStyle.Secondary,
    disabled: !currentSession
  });

  builder.addButton({
    id: 'fb:tts:catalog_btn:0',
    label: 'Voice Catalog',
    style: ButtonStyle.Secondary
  });

  builder.addButton({
    id: 'fb:tts:refresh:0',
    label: 'Refresh',
    style: ButtonStyle.Secondary
  });

  return builder.build();
}

/**
 * Builds modal for speaking custom test text
 */
export function buildCustomSpeechModal() {
  const modal = new ModalBuilder()
    .setCustomId('fb:tts:speak_mod:0')
    .setTitle('Speak Custom Text in Voice');

  const textInput = new TextInputBuilder()
    .setCustomId('tts_text')
    .setLabel('Speech Text')
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder('Type text here to be spoken aloud in your active voice...')
    .setRequired(true)
    .setMaxLength(200);

  modal.addComponents(new ActionRowBuilder().addComponents(textInput));
  return modal;
}

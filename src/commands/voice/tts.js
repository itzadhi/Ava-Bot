import { PermissionFlagsBits } from 'discord.js';
import { ttsEngine } from '../../modules/voice/tts/engine.js';
import { getGuildSettings } from '../../db/guilds.js';
import { getUserTTSPrefs, saveUserTTSPrefs } from '../../db/voice.js';
import { listVoicesByCategory, getVoice, TTS_VOICES } from '../../modules/voice/tts/voices.js';
import { buildTTSPanel } from '../../modules/voice/tts/panel.js';
import { errorCard, successCard, infoCard } from '../../ui/cards.js';

export default {
  name: 'tts',
  aliases: ['speak', 'say', 'ttsreader'],
  description: 'Connect TTS reader to your voice channel and read upcoming chat messages with display names',
  category: 'voice',
  cooldown: 3,
  args: [
    {
      name: 'action',
      description: 'Action to perform: join, stop, status, voice, list, panel (default: join)',
      type: 'string',
      required: false,
      choices: [
        { name: 'join', value: 'join' },
        { name: 'stop', value: 'stop' },
        { name: 'status', value: 'status' },
        { name: 'voice', value: 'voice' },
        { name: 'list', value: 'list' },
        { name: 'panel', value: 'panel' }
      ]
    },
    {
      name: 'voice',
      description: 'TTS Voice (e.g. robot, chipmunk, deep, giant, radio, echo, fast, slow, en-uk, ja)',
      type: 'string',
      required: false,
      choices: [
        { name: '🤖 Cyber Robot', value: 'robot' },
        { name: '🐿️ Chipmunk', value: 'chipmunk' },
        { name: '👹 Deep Demon', value: 'deep' },
        { name: '🗿 Titan Giant', value: 'giant' },
        { name: '📻 Walkie-Talkie', value: 'radio' },
        { name: '🌌 Grand Echo', value: 'echo' },
        { name: '⚡ Turbo Announcer', value: 'fast' },
        { name: '🦥 Sloth Calm', value: 'slow' },
        { name: '🎈 Helium Balloon', value: 'helium' },
        { name: '🤫 Whisper Soft', value: 'whisper' },
        { name: '🇺🇸 American English', value: 'en-us' },
        { name: '🇬🇧 British English', value: 'en-uk' },
        { name: '🇦🇺 Australian English', value: 'en-au' },
        { name: '🇮🇳 Indian English', value: 'en-in' },
        { name: '🇯🇵 Japanese', value: 'ja' },
        { name: '🇪🇸 Spanish', value: 'es' },
        { name: '🇫🇷 French', value: 'fr' },
        { name: '🇩🇪 German', value: 'de' }
      ]
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

    const action = (ctx.args?.action || 'join').toLowerCase().trim();
    const voiceArg = ctx.args?.voice;

    // ── ACTION: PANEL / DASHBOARD ──
    if (action === 'panel' || action === 'control' || action === 'dashboard') {
      const panel = await buildTTSPanel({
        guild: ctx.guild,
        client: ctx.client,
        user: ctx.user
      });
      return ctx.reply(panel);
    }

    // ── ACTION: SET VOICE ──
    if (voiceArg || action === 'voice' || action === 'setvoice') {
      const targetVoiceStr = voiceArg || ctx.args?._rest || 'en-us';
      const resolvedVoice = getVoice(targetVoiceStr);

      await saveUserTTSPrefs(ctx.user.id, ctx.guild.id, {
        language: resolvedVoice.id,
        voice: resolvedVoice.id
      });

      return ctx.reply(successCard({
        title: `${resolvedVoice.emoji} TTS Voice Updated`,
        subtitle: `Selected voice: **${resolvedVoice.name}** (\`${resolvedVoice.id}\`)`,
        details: [
          { label: 'Category', value: resolvedVoice.category },
          { label: 'Description', value: resolvedVoice.description },
          { label: 'Behavior', value: 'Upcoming chat messages you send will be spoken in this voice.' },
          { label: 'Browse More Voices', value: 'Use `/tts action:list` to view all available character and regional voices.' }
        ]
      }));
    }

    // ── ACTION: LIST VOICES ──
    if (action === 'list' || action === 'voices' || action === 'catalog') {
      const categories = listVoicesByCategory();
      const userPrefs = await getUserTTSPrefs(ctx.user.id, ctx.guild.id);
      const currentVoice = getVoice(userPrefs?.language || 'en-us');

      const fxList = categories['Character & FX']
        .map(v => `• ${v.emoji} **${v.name}** (\`${v.id}\`): ${v.description}`)
        .join('\n');

      const regionalList = categories['Accents & Languages']
        .map(v => `• ${v.emoji} **${v.name}** (\`${v.id}\`)`)
        .join('\n');

      return ctx.reply(infoCard({
        title: '🎙️ Available TTS Voices (0 API Keys Required)',
        subtitle: `Your Current Voice: ${currentVoice.emoji} **${currentVoice.name}** (\`${currentVoice.id}\`)`,
        body: [
          '### 🎭 Character & FX Voices *(Local FFmpeg DSP)*',
          fxList,
          '',
          '### 🌐 Regional Accents & Languages *(Free Web TTS)*',
          regionalList,
          '',
          '-# Use `/tts voice:<name>` or `!tts voice <name>` to switch your voice instantly.'
        ].join('\n')
      }));
    }

    // ── ACTION: STOP / LEAVE ──
    if (['stop', 'leave', 'off', 'disconnect'].includes(action)) {
      const stopped = ttsEngine.stop(ctx.guild.id);
      if (stopped) {
        return ctx.reply(successCard({
          title: '🔇 TTS Reader Disconnected',
          subtitle: 'Stopped reading chat messages',
          details: [
            { label: 'Status', value: 'Disconnected from voice channel and stopped reading chat.' }
          ]
        }));
      }
      return ctx.reply(errorCard({
        title: 'TTS Not Active',
        reason: 'The TTS reader is not currently active in any voice channel on this server.',
        ephemeral: true
      }));
    }

    // ── ACTION: STATUS ──
    if (action === 'status') {
      const session = ttsEngine.getSession(ctx.guild.id);
      if (session) {
        const userPrefs = await getUserTTSPrefs(ctx.user.id, ctx.guild.id);
        const currentVoice = getVoice(userPrefs?.language || 'en-us');
        return ctx.reply(successCard({
          title: '🎙️ TTS Reader Status',
          subtitle: 'Active session running',
          details: [
            { label: 'Voice Channel', value: `<#${session.voiceChannelId}>` },
            { label: 'Listening In Chat', value: `<#${session.textChannelId}>` },
            { label: 'Activated By', value: `<@${session.boundByUserId}>` },
            { label: 'Your Active Voice', value: `${currentVoice.emoji} ${currentVoice.name} (\`${currentVoice.id}\`)` }
          ]
        }));
      }
      return ctx.reply(errorCard({
        title: 'TTS Inactive',
        reason: 'The TTS reader is not currently active in this server. Use `/tts` to start.',
        ephemeral: true
      }));
    }

    // ── ACTION: JOIN & BIND ──
    // 1. Check user voice state
    const voiceChannel = ctx.member?.voice?.channel;
    if (!voiceChannel) {
      return ctx.reply(errorCard({
        title: 'Not Connected to Voice',
        reason: 'You must be connected to a voice channel to use TTS.',
        fix: 'Join a voice channel and try again.',
        ephemeral: true
      }));
    }

    // 2. Check bot permissions in voice channel
    const me = ctx.guild.members.me || ctx.client.user;
    const perms = voiceChannel.permissionsFor?.(me);
    if (perms && (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak))) {
      return ctx.reply(errorCard({
        title: 'Missing Permissions',
        reason: 'The bot lacks permission to Connect or Speak in your voice channel.',
        fix: 'Check the voice channel permissions and ensure Argoni can speak.',
        ephemeral: true
      }));
    }

    // 3. Check guild TTS toggle
    const guildSettings = await getGuildSettings(ctx.guild.id);
    if (guildSettings?.tts_enabled === false) {
      return ctx.reply(errorCard({
        title: 'TTS Disabled',
        reason: 'Text-to-Speech is currently disabled on this server.',
        ephemeral: true
      }));
    }

    try {
      await ttsEngine.joinAndBind({
        guild: ctx.guild,
        voiceChannel,
        textChannel: ctx.channel,
        userId: ctx.user.id
      });

      const userPrefs = await getUserTTSPrefs(ctx.user.id, ctx.guild.id);
      const currentVoice = getVoice(userPrefs?.language || 'en-us');

      return ctx.reply(successCard({
        title: '🎙️ TTS Reader Connected',
        subtitle: `Joined voice channel **${voiceChannel.name}**`,
        details: [
          { label: 'Voice Channel', value: `<#${voiceChannel.id}>` },
          { label: 'Reading Chat From', value: `<#${ctx.channel.id}>` },
          { label: 'Your Voice', value: `${currentVoice.emoji} **${currentVoice.name}** (\`${currentVoice.id}\`)` },
          { label: 'Speech Format', value: '`<Display Name> says, <Message>`' },
          { label: 'Controls', value: 'Any upcoming message in this chat will be read aloud.\n• `/tts voice:<name>` to change your voice\n• `/tts action:list` to view all voices\n• `/tts action:stop` to disconnect' }
        ]
      }));
    } catch (err) {
      return ctx.reply(errorCard({
        title: 'Failed to Join Voice',
        reason: err.message,
        ephemeral: true
      }));
    }
  }
};

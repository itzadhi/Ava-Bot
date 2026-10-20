# Argoni — Discord Components V2 Engine & Bot Framework

**Argoni** is a production-grade, verification-ready **Discord Bot Framework & Modular Engine** powered by Discord's newest **Components V2** (`ContainerBuilder`, `TextDisplayBuilder`, `SeparatorBuilder`, `SectionBuilder`, `ThumbnailBuilder`, `MediaGalleryBuilder`), Supabase (PostgreSQL with RLS), and an extensible module architecture.

![Argoni Logo](assets/logo.jpg)

---

## 🌟 Highlights of the Components V2 Upgrade

- **Pure Components V2 Layouts**: Strict compliance with `MessageFlags.IsComponentsV2` (Flag `32768`). No deprecated embed arrays or naked plain-text messages.
- **Single Source of Truth Design System**: Global tokens in `/config/theme.js` defining colors, emojis (with custom Discord emoji token support + Unicode fallbacks), footer, and links.
- **Comprehensive Discord Markdown Suite (`/utils/ui/format.js`)**: Helper functions for bold, italics, code blocks (`js`, `json`, `diff`), colored ANSI blocks, headings (`#`, `##`, `###`), subtext (`-#`), masked links, mentions, timestamps (`<t:unix:F> (<t:unix:R>)`), and safety input escaping.
- **Interactive Control Dashboard (`/panel` & `&panel`)**: Unified management console listing all 10+ server modules with one-click navigation and live in-place refreshing.
- **Interactive Help Menu (`/help` & `&help`)**: Greeting section with bot avatar thumbnail, dynamic command counter, link buttons (Invite, Website, Support), and dual dropdown category menus (Main & Extra) with pagination.
- **Color-Coded Server Audit Logging (`/logs` & `&logs`)**: Event-driven logging for 15+ Discord events (member joins/leaves, bans/kicks/timeouts, nickname & role changes, channel/role lifecycle, message deletes, and before/after diff edits).
- **Zero-Crash Resilience**: Built-in try/catch error boundaries, rate-limit safety queues (`p-queue`), author-only permission checks, and automatic 120s interaction timeout collectors.

---

## 📁 Project Directory Structure

```
Argoni/
├── assets/                  # Brand assets (logo.jpg)
├── config/
│   └── theme.js             # Root proxy for theme tokens
├── src/
│   ├── index.js             # ArgoniClient entry point & event lifecycle
│   ├── config.js            # Environment validation with Zod
│   ├── config/
│   │   ├── theme.js         # Single source of truth (colors, emojis, links, footer)
│   │   └── tiers.js         # Premium tier quotas
│   ├── commands/            # Slash & prefix command definitions
│   │   ├── backup/          # /backup snapshots & restores
│   │   ├── chatlog/         # /chatlog vault
│   │   ├── feedback/        # /feedback submissions
│   │   ├── help/            # /help interactive command catalog
│   │   ├── panel/           # /panel central dashboard
│   │   ├── settings/        # /automod, /autorole, /boosts, /botprofile, /logs, /sticky, /stickyroles
│   │   ├── suggestions/     # /suggest community ideas
│   │   └── voice/           # /tts, /ttspanel, /voicepanel
│   ├── db/                  # Supabase PostgreSQL client & repositories
│   │   ├── client.js        # Supabase client + in-memory fallback
│   │   ├── guilds.js        # Guild settings & 60s cache
│   │   ├── moduleData.js    # Generic module_data key-value store
│   │   ├── backups.js       # Backup records & scheduled intervals
│   │   └── ...              # chatlogs, feedback, suggestions, sticky, voice
│   ├── events/              # Core Gateway listeners (interactionCreate, messageCreate, voiceStateUpdate)
│   ├── modules/             # Self-contained feature modules
│   │   ├── automod/         # Rule engine & interactive panel
│   │   ├── autorole/        # Member & bot auto-role on join
│   │   ├── backup/          # Structural snapshots & restoration pipeline
│   │   ├── boosts/          # Boost detection, celebrations & booster roles
│   │   ├── chatlog/         # AES-256-GCM encrypted message vault
│   │   ├── feedback/        # Member reviews & staff reply modals
│   │   ├── help/            # Help menu & category command browser
│   │   ├── logs/            # Audit logging engine, card builder & 15+ event listeners
│   │   ├── owner/           # 10-tab administrative developer panel
│   │   ├── panel/           # Main Control Dashboard module
│   │   ├── settings/        # Guild configuration & bot profile
│   │   ├── sticky/          # Pinned bottom-of-channel messages
│   │   ├── stickyroles/     # Leave & rejoin role restoration
│   │   ├── suggestions/     # Community suggestions & voting
│   │   ├── sync/            # Cross-server live sync pipelines
│   │   └── voice/           # Dynamic Join-to-Create voice channels & TTS reader
│   ├── structures/          # CommandRegistry, ComponentRegistry, CommandContext, Module
│   └── utils/
│       ├── ui/
│       │   ├── format.js    # Markdown helpers, ANSI blocks & input sanitization
│       │   ├── builders.js  # buildContainer, successCard, errorCard, panelCard, etc.
│       │   └── index.js     # Unified UI exports
│       ├── logger.js        # Pino structured logger
│       └── parser.js        # Prefix command argument tokenizer
├── supabase/
│   └── migrations/          # SQL database schemas & migrations (001 to 008)
└── tests/                   # 18 test suites covering 88 comprehensive unit tests
```

---

## 🚀 Setup & Getting Started

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher
- **Discord Bot**: Application created on the [Discord Developer Portal](https://discord.com/developers/applications)
  - Required Privileged Intents: `Server Members Intent`, `Message Content Intent`
- **Supabase**: PostgreSQL project (URL and Service Role Key)

### 2. Environment Configuration
Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Environment Variable | Description | Default / Example |
|---|---|---|
| `DISCORD_TOKEN` | Discord Bot Token | *Required* |
| `CLIENT_ID` | Discord Application Client ID | *Required* |
| `OWNER_IDS` | Comma-separated Discord User IDs for owners | `123456789012345678` |
| `DEFAULT_PREFIX` | Default prefix for guild commands | `a!` |
| `OWNER_PREFIX` | Prefix for developer owner commands | `ao!` |
| `SUPABASE_URL` | Supabase Project URL | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Secret Service Role Key | *Required* |
| `DATA_ENCRYPTION_KEY` | 32-byte secret key for AES-256-GCM message encryption | 32+ character string |
| `SUPPORT_SERVER_URL` | Discord Support Server invite link | `https://discord.gg/argoni` |
| `INVITE_URL` | Bot OAuth2 Invite Link | `https://discord.com/oauth2/...` |
| `WEBSITE_URL` | Official Website Link | `https://argoni.app` |
| `LOG_LEVEL` | Pino logger level (`info`, `debug`, `error`) | `info` |

#### Custom Emoji Tokens (Optional)
Configure custom server emojis in `.env` or leave unset to use automatic Unicode fallbacks:
```env
EMOJI_DOT=•
EMOJI_ARROW=➔
EMOJI_SUCCESS=✅
EMOJI_ERROR=❌
EMOJI_WARN=⚠️
EMOJI_LOADING=⏳
EMOJI_ON=🟢
EMOJI_OFF=🔴
EMOJI_INFO=ℹ️
EMOJI_GEAR=⚙️
```

### 3. Install Dependencies & Run Tests
```bash
npm install
npm test
```

### 4. Start the Bot
```bash
# Development (with auto-reload on file changes)
npm run dev

# Production
npm start
```

---

## 🎨 Design System & Formatting Guide

### Components V2 Rule
In Discord Components V2, **every response must be sent with `MessageFlags.IsComponentsV2` (`32768`)**. Messages must **never send `content` or `embeds` together with components**.

### Importing the Design System
```javascript
import {
  theme,
  buildContainer,
  successCard,
  errorCard,
  warnCard,
  infoCard,
  confirmCard,
  paginatedCard,
  panelCard,
  createButton,
  createStringSelect,
  createChannelSelect,
  createRoleSelect,
  createModal,
  bold,
  italic,
  code,
  codeBlock,
  ansiBlock,
  ansi,
  quote,
  heading,
  subtext,
  link,
  userMention,
  roleMention,
  channelMention,
  timeLongAndRelative,
  kvLine,
  escapeMarkdown
} from './utils/ui/index.js';
```

---

## 🛠️ How to Add a New Module Panel

Creating a new interactive module panel following the standardized pattern takes under 5 minutes:

### Step 1: Define the Panel Function (`src/modules/mymodule/panel.js`)
```javascript
import {
  panelCard,
  createButton,
  createChannelSelect,
  kvLine,
  code,
  channelMention,
  theme
} from '../../utils/ui/index.js';
import { ButtonStyle } from 'discord.js';

export function buildMyModulePanel(settings, guild) {
  const isEnabled = settings.mymodule_enabled !== false;
  const channelId = settings.mymodule_channel_id;

  return panelCard({
    title: 'My Custom Module',
    isEnabled,
    description: 'Automate custom guild workflows with Components V2 cards.',
    statusLines: [
      kvLine('System Status', isEnabled ? '🟢 Active' : '🔴 Disabled'),
      kvLine('Target Channel', channelId ? channelMention(channelId) : '_None (Set below)_'),
      kvLine('Mode', code('Automatic'))
    ],
    selects: [
      createChannelSelect({
        id: `mymodule:set_chan:${guild.id}`,
        placeholder: 'Select Target Channel...'
      })
    ],
    buttons: [
      createButton({
        customId: `mymodule:toggle:${guild.id}`,
        label: isEnabled ? 'Disable Module' : 'Enable Module',
        style: isEnabled ? ButtonStyle.Danger : ButtonStyle.Success,
        emoji: isEnabled ? theme.emojis.off : theme.emojis.on
      }),
      createButton({
        customId: `mymodule:edit_modal:${guild.id}`,
        label: 'Edit Settings',
        style: ButtonStyle.Secondary,
        emoji: '📝'
      }),
      createButton({
        customId: 'dash:return',
        label: 'Dashboard',
        style: ButtonStyle.Secondary,
        emoji: '◀'
      })
    ]
  });
}
```

### Step 2: Handle Interactions (`src/modules/router.js`)
```javascript
if (action === 'toggle') {
  const settings = await getGuildSettings(guildId);
  await updateGuildSettings(guildId, { mymodule_enabled: !settings.mymodule_enabled });
  const updated = await getGuildSettings(guildId);
  await interaction.deferUpdate().catch(() => {});
  return safeUpdatePanel(interaction, buildMyModulePanel(updated, interaction.guild));
}
```

### Step 3: Register Command & Dashboard Shortcut
Create `src/commands/settings/mymodule.js`:
```javascript
import { PermissionFlagsBits } from 'discord.js';
import { getGuildSettings } from '../../db/guilds.js';
import { buildMyModulePanel } from '../../modules/mymodule/panel.js';

export default {
  name: 'mymodule',
  description: 'Manage My Custom Module settings and channel',
  category: 'settings',
  permissions: [PermissionFlagsBits.ManageGuild],
  async execute(ctx) {
    const settings = await getGuildSettings(ctx.guild.id);
    return ctx.reply(buildMyModulePanel(settings, ctx.guild));
  }
};
```

---

## 📢 Server Audit Logging (`/logs`)

Server logging categorizes all Discord events into dedicated visual cards:

| Category | Accent Color | Events Covered |
|---|---|---|
| **Moderation** | Crimson Red (`#ED4245`) | Member Bans, Unbans, Kicks, Timeouts, Warning actions |
| **Messages** | Vibrant Orange (`#E67E22`) | Message Deletions, Edits (with `diff` before/after blocks), Bulk Purges |
| **Members** | Emerald Green (`#57F287`) | Member Joins, Leaves, Nickname changes |
| **Roles** | Royal Purple (`#9B59B6`) | Member role additions/removals, Role creation, Role deletion, Role updates |
| **Channels** | Blurple Blue (`#5865F2`) | Channel creation, Channel deletion, Topic/Name updates |
| **Voice** | Royal Purple (`#9B59B6`) | Voice joins, Voice leaves, Switching voice channels, Server mutes/deafens |
| **Server** | Blurple Blue (`#5865F2`) | Invite creations/deletions, Emoji additions/deletions, Guild setting modifications |

---

## 🗄️ Supabase Migrations

The project includes SQL migrations in `supabase/migrations/`:
- `001_initial_schema.sql`: Initial guild settings, backups, chatlogs, templates, syncs, bot state
- `002_module_data.sql`: Generic key-value store for module persistence
- `003_voice_suggestions_feedback.sql`: Join-to-Create voice channels, suggestions, and feedback
- `004_bot_profile_suggestion_image.sql`: Per-guild bot profile customizations
- `005_automod_boost_tracking.sql`: AutoMod rule flags and boost tracking
- `006_sticky_and_autorole.sql`: Sticky notes, sticky roles, and welcome auto-role
- `007_automod_exception_role.sql`: AutoMod bypass and whitelist roles
- `008_server_logging.sql`: Dedicated server logging columns and indexes

> Run `008_server_logging.sql` in your Supabase SQL Editor to ensure full persistence for category log channels.

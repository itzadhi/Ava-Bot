# Argoni — Premium Discord Components V2 Engine & Bot Framework

**Argoni** is a production-grade Discord bot framework built on **Node.js 20+**, **discord.js v14.27+**, and **Supabase (PostgreSQL with RLS)**. It features an exclusive, pure **Components V2** interface inspired by the reference standard of "Yuna CV2 AIO" — featuring clean dark borderless container cards, rich typography, and ZERO legacy embeds or colored sidebar strips.

---

## 🌟 Visual Standards & Components V2 Features

- **Components V2 ONLY**: Every message is dispatched with `flags: MessageFlags.IsComponentsV2` (Flag `32768`). No legacy `EmbedBuilder`, no `embeds: []`, and no naked plain-text messages.
- **NO SIDEBAR / ZERO ACCENT STRIP**: Containers are rendered as borderless, modern dark cards without any vertical colored sidebar line (`ContainerBuilder` without `accent_color`).
- **Help Menu**:
  - Heading: `# Help Menu`
  - Three bullet lines with cyan dot styling:
    - `• Type {prefix}help to get more info`
    - `• Total Commands available: {N}` (counted dynamically from loaded commands)
    - `• [Invite](url) | [Website](url) | [Support](url)` (masked blue links separated by `|`)
  - Divider (`SeparatorBuilder`)
  - Greeting block: Butterfly icon + `Hey [DisplayName](avatarUrl)!` + `I'm Argoni, your friendly companion.`
  - Chevrons: Server prefix + instructions to choose from menu
  - Divider (`SeparatorBuilder`)
  - Dual StringSelectMenus: `Main Categories` and `Extra Categories`
  - Category pages with command lists, usage subtext, pagination, and persistent select menus
- **Modular Design System (`/config/theme.js` & `/utils/ui/`)**: Single source of truth for emojis, tokens, URLs, and reusable component builders.
- **Resilient Error Boundaries**: Ephemeral error, permission, and cooldown cards with relative Discord timestamps (`<t:unix:R>`).

---

## 📁 Directory Structure

```
Argoni/
├── src/
│   ├── index.js             # ArgoniClient initialization & Gateway event handling
│   ├── config.js            # Environment validation & live credential checks
│   ├── config/
│   │   ├── theme.js         # Single source of truth (bot name, emojis, links, footer)
│   │   └── tiers.js         # Quotas and premium tier configurations
│   ├── commands/            # Slash & prefix command definitions
│   │   ├── backup/          # /backup snapshots & restores
│   │   ├── chatlog/         # /chatlog encrypted vault
│   │   ├── feedback/        # /feedback submissions & reviews
│   │   ├── help/            # /help interactive command catalog
│   │   ├── panel/           # /panel central dashboard
│   │   ├── settings/        # /automod, /autorole, /boosts, /botprofile, /logs, etc.
│   │   ├── suggestions/     # /suggest community ideas
│   │   └── voice/           # /tts, /ttspanel, /voicepanel
│   ├── db/                  # Supabase PostgreSQL client & data repositories
│   │   ├── client.js        # Supabase client with in-memory SQLite fallback
│   │   ├── guilds.js        # Per-guild settings cache (prefix, logs, etc.)
│   │   └── ...              # backups, chatlogs, suggestions, sticky, voice
│   ├── events/              # Gateway event listeners (interactionCreate, messageCreate)
│   ├── middleware/          # Cooldown and permission pipelines
│   ├── modules/             # Self-contained feature systems & interactive panels
│   │   ├── help/            # Interactive Help Menu & Category browser
│   │   ├── panel/           # Main server control dashboard
│   │   ├── logs/            # Audit logging engine & interactive manager
│   │   └── ...              # automod, autorole, voice, backup, sticky, feedback
│   ├── structures/          # CommandRegistry, ComponentRegistry, CommandContext
│   └── utils/ui/            # Components V2 Design System
│       ├── components.js    # Reusable V2 builders (header, bulletLines, infoCard, etc.)
│       ├── format.js        # Discord markdown, ANSI, and text escaping helpers
│       └── index.js         # Clean centralized exports
├── tests/                   # Automated node:test test suite (92 tests)
├── .env.example             # Complete environment configuration template
└── package.json
```

---

## 🚀 Setup & Installation

### 1. Prerequisites
- **Node.js**: `v20.0.0` or higher (`v24` supported)
- **Git**: Installed and available in terminal
- **Supabase**: Free or Pro tier project (or in-memory mock for local testing)

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in the following essential variables:
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_application_id_here
OWNER_IDS=your_discord_user_id
BOT_NAME=Argoni
DEFAULT_PREFIX=a!
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
DATA_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

### 4. Deploy Slash Commands
```bash
npm run deploy
```

### 5. Start the Bot
```bash
# Production
npm start

# Development (with file watcher)
npm run dev
```

### 6. Run Test Suite
```bash
npm test
```

---

## 🛠️ How to Add a New Command Using UI Helpers

All commands in Argoni must strictly return **Components V2 Container Cards**. Never use `EmbedBuilder` or send plain text strings.

Create a new file in `src/commands/<category>/<command_name>.js`:

```javascript
import { PermissionFlagsBits } from 'discord.js';
import {
  container,
  header,
  divider,
  bulletLines,
  infoCard,
  successCard,
  errorCard
} from '../../utils/ui/index.js';
import * as format from '../../utils/ui/format.js';

export default {
  name: 'ping',
  description: 'Displays current bot websocket and database latency',
  category: 'general',
  cooldown: 5,
  args: [],
  async execute(ctx) {
    const wsPing = ctx.client.ws.ping;
    const startDb = Date.now();
    await ctx.client.db.from('guild_settings').select('guild_id').limit(1);
    const dbPing = Date.now() - startDb;

    // Build a clean, borderless Components V2 card
    return ctx.reply(infoCard('System Latency', null, {
      fields: [
        { name: 'Gateway Latency', value: `${format.code(`${wsPing}ms`)}` },
        { name: 'Database Latency', value: `${format.code(`${dbPing}ms`)}` }
      ],
      footer: `Requested by ${ctx.user.username} • ${format.time(new Date(), 'R')}`
    }));
  }
};
```

### Available UI Helpers (`src/utils/ui/`):
- `container({ blocks, ephemeral, files })`: Root borderless card wrapper.
- `header(title, level)`: Heading `# Title` (1), `## Title` (2), or `### Title` (3).
- `bulletLines(['Line 1', 'Line 2'])`: Cyan dot styled bullet list.
- `arrowLines(['Step 1', 'Step 2'])`: Chevron styled list.
- `linkRow([{ label, url }])`: Pipe-separated blue markdown links (`[Invite](url) | [Support](url)`).
- `divider()`: Discord horizontal separator.
- `greetingSection({ text, thumbnailUrl })`: Section layout with thumbnail accessory.
- `successCard(title, description, { actions })`: Action completed confirmation card.
- `errorCard(title, reason, { hint })`: Error response card.
- `warnCard(title, warning, { hint })`: Warning notification card.
- `cooldownCard(command, resetTime)`: Slow down rate-limit warning.
- `permissionCard({ missing, isBot })`: Missing permissions notice.
- `moderationResultCard({ action, target, moderator, reason, caseId })`: Audit result card.
- `logCard({ eventName, emoji, category, user, channel, reason, beforeText, afterText })`: Audit logging card.

---

## 🔒 Security & Best Practices
- **Mentions Shield**: All cards automatically set `allowedMentions: { parse: [] }` to prevent user ping injection.
- **Markdown Sanitization**: `format.escapeMarkdown(text)` escapes user input so custom names or reasons cannot break card formatting.
- **Safety Truncation**: `format.truncate(text, max)` avoids splitting code blocks or Discord mention tags.

---

## 🎫 Ticket Support System

Argoni includes an enterprise-grade ticket system built with 100% Components V2 container cards, rich Discord markdown, atomic sequential numbering, and complete in-ticket controls.

### 🚀 Quick Setup & Database Migration
1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and navigate to the **SQL Editor**.
2. Run the SQL migration located at:
   ```
   supabase/migrations/009_ticket_system.sql
   ```
3. This creates all necessary tables with Row-Level Security (`ticket_settings`, `ticket_panels`, `ticket_categories`, `ticket_questions`, `tickets`, `ticket_notes`, `ticket_ratings`, `ticket_blacklist`, `ticket_macros`, `ticket_transcripts`, `ticket_counters`) and the atomic counter RPC `next_ticket_number(p_guild_id)`.

### 🛡️ Required Bot Permissions
Ensure the bot has the following permissions in your server:
- **Manage Channels** — To create private ticket channels, set category channel permissions, and delete closed channels.
- **Manage Roles** — To apply private permission overwrites for ticket owners and support roles.
- **View Channel & Send Messages** — To communicate in tickets and log channels.
- **Attach Files** — To deliver standalone dark-mode HTML transcripts.
- **Read Message History** — To generate complete transcripts of closed tickets.

### 📌 How to Create & Publish a Ticket Panel
1. Use `/ticket panel` or `a!ticket panel` (requires `Manage Server`).
2. Click **Create Panel** and enter your desired title and description.
3. Configure the panel style:
   - **Buttons** — Direct category buttons per department.
   - **Dropdown Select** — Interactive string select menu supporting unlimited categories.
4. Select the destination channel from the dropdown to publish the persistent Components V2 card.

### ⚙️ How to Configure Settings
- Run `/ticket settings` or `/panel` and select **Ticket System**.
- **General**: Enable/disable system, select ticket type (channels or threads), naming format, and user open limits.
- **Staff Roles**: Select global support and admin roles.
- **Channels**: Configure dedicated channels for audit event logs and closed ticket transcripts.
- **Auto-Close**: Configure inactivity timeout hours (e.g. 24h, 48h) with automated advance warnings.
- **Ratings**: Enable 1–5 star customer satisfaction ratings and feedback prompts upon ticket closure.
- **Blacklist**: Restrict disruptive users or roles from opening new tickets.

### 📋 Ticket Commands Reference

| Command | Usage | Description | Permission |
| :--- | :--- | :--- | :--- |
| `/ticket panel` | `a!ticket panel` | Open panel creator and deployment dashboard | Manage Server |
| `/ticket settings` | `a!ticket settings` | Open multi-tab interactive settings dashboard | Manage Server |
| `/ticket stats` | `a!ticket stats` | Display server ticket volume, resolution rates & stats | Staff / Everyone |
| `/ticket list` | `a!ticket list [status]` | View active server tickets filtered by status | Staff |
| `/ticket info` | `a!ticket info` | Show metadata and internal notes for current ticket | Inside Ticket |
| `/claim` | `a!claim` or `/ticket claim` | Claim or release claim on the current ticket channel | Support Staff |
| `/close` | `a!close [reason]` | Close current ticket channel with optional reason | Owner / Staff |
| `/reopen` | `a!reopen` | Reopen a closed ticket prior to automatic deletion | Support Staff |
| `/ticket add` | `/ticket add [user] [role]` | Grant member or role access to the current ticket | Inside Ticket |
| `/ticket remove` | `/ticket remove [user] [role]` | Revoke member or role access from the ticket | Support Staff |
| `/ticket rename` | `/ticket rename <name>` | Rename the ticket channel | Support Staff |
| `/ticket priority` | `/ticket priority <level>` | Set priority: `low`, `normal`, `high`, `urgent` | Support Staff |
| `/ticket note` | `/ticket note <content>` | Add internal staff note saved in database record | Support Staff |
| `/ticket blacklist`| `/ticket blacklist <add\|remove\|list>` | Restrict users/roles from creating tickets | Manage Server |
| `/ticket macro` | `/ticket macro <use\|list\|add\|delete>`| Manage and trigger canned response templates | Staff |
| `/ticket reviews`| `a!ticket reviews` | Display staff customer satisfaction leaderboard | Everyone |

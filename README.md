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

---

## 🔒 Permify Server Permission Wizard

Argoni includes an automated, first-time server permission architect and wizard accessible via `/permify` (or prefix `&permify` and `a!permify`). It presents an interactive, single-panel wizard that collects role groupings and channel configurations step-by-step, displays a full permission matrix preview, automatically rebuilds the entire server permission architecture, and connects the roles directly to the Autorole and Ticket support systems.

### 🚀 Database Migration Setup
Before running `/permify` in a production environment with remote database persistence, execute the following SQL migration in your [Supabase SQL Editor](https://supabase.com/dashboard):
```sql
supabase/migrations/20261021_permify.sql
```
*Note: The bot also contains full in-memory fallback support so the wizard can run immediately without data loss.*

### 🛡️ Permissions & Authorization
- **Who can run it**: Only the **Server Owner** or members with the **Administrator** permission.
- **Bot Pre-Check**: The bot requires **Administrator**, or at minimum: `ManageChannels`, `ManageRoles`, `ViewChannel`, `SendMessages`, and `ManageMessages`.
- **Session Concurrency**: Strict 1 active wizard per guild with a 30-second guild cooldown.
- **Inactivity Timeout**: Sessions automatically expire and clean up after 15 minutes of inactivity.

### 🎨 Visual & UI Design Rules
1. **Components V2 ONLY**: Every card is rendered with `flags: MessageFlags.IsComponentsV2` without embeds or naked content.
2. **NO SIDEBAR / NO COLOR STRIP**: Completely borderless cards (`setAccentColor`/`setColor` are never invoked).
3. **100% GREY BUTTONS**: Every interactive button strictly uses `ButtonStyle.Secondary` (grey) or `ButtonStyle.Link` (link). Tell buttons apart by emoji and descriptive label.
4. **Rich Typography**: `##` headings, `**bold**`, `-#` subtext, block quotes, mentions, ANSI code blocks, and live text progress bars (`▰▰▰▱▱▱▱ 3/7`).

### 📋 The 7-Step Wizard Flow

1. **Step 1 — Reset Scope**: Live channel counts (categories, text, voice, stage, forum) and existing overwrite totals. Includes a grey toggle to include/skip channels with custom overwrites.
2. **Step 2 — Staff-Only-Speak Categories**: Paginated multi-select menu (25 per page) with page navigation, `Select Page`, `Clear Page`, and `Clear All` controls. In selected categories, Staff can speak and chat while Members can only view/read.
3. **Step 3 — Staff-Only-Speak Channels**: Paginated multi-select for individual channels with type emojis (💬, 🔊, 📢, 🎭, 📋). Channels already covered under Step 2 categories are automatically marked and skipped.
4. **Step 4 — Staff Roles**: Native multi-select `RoleSelectMenu` (1–25 roles) with hierarchy validation and a single-role drop menu.
5. **Step 5 — Member Roles**: Native multi-select `RoleSelectMenu` with a grey toggle to automatically sync with the **Autorole** system.
6. **Step 6 — Owner & Admin Roles**: Native multi-select `RoleSelectMenu` for executive leadership.
7. **Step 7 — Preview & Confirm**: Full summary, ANSI permission matrix table, hide `@everyone` toggle, unroled member backfill toggle, and an "Apply Everything" modal requiring typing `CONFIRM`.

### 🛡️ Permission Architecture Matrix

| Role Group | Normal Community Channels | Staff-Only-Speak Channels | Server Log & Vault Channels | Ticket Support Category |
| :--- | :--- | :--- | :--- | :--- |
| **@everyone** | `DENIED View` (if hidden) | `DENIED View` | `DENIED View` | `DENIED View` |
| **Member Roles** | `View + Send + Speak + React` | `View + Read History ONLY` | `DENIED View` | Open Ticket Panel view |
| **Staff Roles** | `View + Send + Manage Messages` | `View + Send (No Manage)` | `View ONLY (No Send)` | `View + Manage Channels` |
| **Owner Roles** | `Full Administrative Access` | `Full Access + Manage Msgs` | `Full Access` | `Full Administrative Access` |
| **Argoni Bot** | `Full Lockout Protection` | `Full Lockout Protection` | `Full Lockout Protection` | `Full Lockout Protection` |

### 🔄 Automatic Pre-Run Snapshots & Undo
- **Pre-Execution Snapshot**: Prior to changing any overwrite, a full JSON snapshot of all channels, categories, and previous settings is saved into `permify_snapshots` (retaining the last 3 per guild).
- **Rate-Limited Rebuild**: Sequential processing with rate-limit pacing and a live V2 progress card updated every ~5 channels.
- **1-Click Undo**: If needed, click `Undo Last Run` on the final report card (or when reopening `/permify`) and type `UNDO` to restore the exact previous channel overwrites and settings.

---

## 🛡️ Anti-Nuke Server Protection System

Argoni includes an enterprise-grade Anti-Nuke defence mechanism accessible via `/antinuke` (or prefix `&antinuke` and `a!antinuke`). Built strictly with **Components V2**, pure grey buttons, and zero embed sidebars, it provides autonomous real-time protection against rogue staff, compromised bots, and coordinated server raids.

### 🚀 Key Capabilities
1. **Mass Channel Deletion Guard & Auto-Restore**:
   - Detects channel deletions using per-executor sliding windows.
   - Non-trusted users exceeding the threshold are immediately punished (banned, kicked, or stripped of roles).
   - Sequentially restores channels from snapshot data preserving category parents, order, permission overwrites, topic, nsfw, bitrate, and user limits.
   - **Database ID Remapping**: Automatically updates remapped channel IDs across `guild_settings`, `ticket_settings`, `automod_settings`, `antinuke_settings`, and `module_data`.
   - **Ticket Exemption**: Ticket channels (`ticket-*`, `tkt-*`) and configured ticket categories are strictly excluded from snapshot, restoration, and lockdown overwrites.
2. **Server Raid Detection & Emergency Lockdown**:
   - Analyzes rapid message flooding from multiple users, repeated identical content waves, and burst account joins.
   - Automatically executes server lockdown: denies `@everyone` `SendMessages`, `SendMessagesInThreads`, `CreatePublicThreads`, `AddReactions`, and `Connect`.
   - Backs up existing overwrites to `lockdown_state` in Supabase for exact restoration upon unlock.
   - Automatically purges recent raid messages and bans raid spammers.
   - **Auto-Unlock**: Monitors a calm timer (e.g. 60s without raid spam) and maximum safety duration (e.g. 15m), restoring all channels cleanly.
   - **Restart Recovery**: Active lockdowns and monitor timers seamlessly resume after bot restarts.
3. **Extra Protections**:
   - **Mass Role Deletion**: Prevents and restores bulk role deletions.
   - **Unauthorized Bot Add**: Immediately kicks unauthorized bots added by non-trusted users and punishes the adder.
   - **Dangerous Permissions**: Detects unauthorized grants of `Administrator`, `ManageGuild`, `ManageRoles`, `ManageChannels`, `BanMembers`, or `MentionEveryone` and reverts permissions.
   - **Webhook Spam**: Mitigates and deletes spam webhooks.
4. **Dry-Run Simulation**:
   - Run `/antinuke test` to simulate mass channel deletions, verify restoration logic, and inspect audit logs without deleting real server channels.

### 📋 Anti-Nuke 7-Page Wizard Overview

| Page | Title | Description | Controls |
| :---: | :--- | :--- | :--- |
| **1** | **Status & Health** | System state, permission pre-checks, role hierarchy check | Toggle Enable/Disable, Dry-Run Mode, Run Test Simulation |
| **2** | **Trusted Roles & Owners** | Manage extra owners and immune roles that bypass Anti-Nuke | Multi-select role menu, Add Extra Owner modal |
| **3** | **Channel Restoration** | Sliding window limits and punishment action (ban, kick, strip) | Threshold modal (limit, window), Single deletion toggle |
| **4** | **Protected Exceptions** | Exempt specific channels or categories from Anti-Nuke | Category select, Channel select, Ticket status |
| **5** | **Auto Lockdown** | Raid spam criteria, calm timer, and max safety duration | Raid thresholds modal, Punishment dropdown |
| **6** | **Extra Protections** | Toggle bot protection, role guards, dangerous perm reverts | Grey toggle buttons per protection vector |
| **7** | **Logs & Summary** | Incident log channel and complete protection overview | Channel select menu, Refresh diagnostics |

### 🛠️ Lockdown Command Reference

| Command | Usage | Description | Permission |
| :--- | :--- | :--- | :--- |
| `/antinuke` | `&antinuke` | Open the 7-page interactive Anti-Nuke control panel | Server Owner Only |
| `/antinuke test`| `&antinuke test` | Run dry-run simulation of channel delete and recovery | Server Owner Only |
| `/lockdown on` | `&lockdown on [reason]` | Manually trigger emergency server lockdown | Server Owner / Admin |
| `/lockdown off`| `&lockdown off [reason]`| Lift server lockdown and restore original overwrites | Server Owner / Admin |
| `/lockdown status`| `&lockdown status` | Check current server lockdown status and calm timer | Server Owner / Admin |

---

## 🛡️ AutoMod V2 Protection Engine

Argoni features a complete rewrite of the AutoMod engine, fixing previous persistence bugs by storing all configurations directly in Supabase (`automod_settings`, `automod_words`, `automod_allowlist`, `automod_regex`, `automod_exemptions`, `automod_strikes`) with full write-through caching.

### 🚀 Key Features
1. **Slur & Profanity Filtering with Advanced Normalization**:
   - High-performance Unicode NFKC normalization.
   - Homoglyph normalization (Cyrillic, Greek homoglyphs mapped to Latin).
   - Leetspeak substitution mapping (`b!tch` -> `bitch`, `1337` -> `leet`, `@ss` -> `ass`).
   - Invisible and zero-width character stripping (`\u200B`, `\u200C`, `\uFEFF`, `\u200E`, `\u200F`).
   - Collapsing repeated characters (`fuuuck` -> `fuck`) and spaced letters (`f u c k`, `f.u.c.k` -> `fuck`).
   - Slur masking in logs (`s******d`).
2. **ReDoS-Protected Custom Regex Rules**:
   - Supports up to 50 custom server regex rules.
   - Evaluated via `safe-regex2` with execution timeout guards to prevent Catastrophic Backtracking and bot freezes.
3. **Domain Allowlist & Phishing Shield**:
   - Discord server invite blocker (`discord.gg/*`).
   - External web link filter with domain allowlist and denylist.
   - Fake Nitro, Steam, and phishing scam detection.
4. **Strike Escalation & Punishments**:
   - Configurable strike thresholds for automated 5-minute timeout, kick, and ban escalations.
   - Rolling strike expiration (default 24h).
5. **Real-Time Interactive Tester**:
   - Run `/automod test <text>` to inspect how text is normalized, test rules, and preview matches without punishing members.

### 📋 AutoMod 8-Page Wizard Overview

| Page | Title | Description |
| :---: | :--- | :--- |
| **1** | **Status Overview** | Master toggle, default enforcement action (delete, warn, timeout), filter toggles |
| **2** | **Word Filter** | Slurs (severe tier), Profanity (mild tier), Custom server terms, Whitelisted false-positives |
| **3** | **Regex Rules** | Add, remove, and toggle custom regular expressions (max 50, ReDoS verified) |
| **4** | **Link & Invite Rules**| Block invite links, external links, allowed domains, scam nitro protection |
| **5** | **Spam Rules** | Rapid flood sliding window, duplicate flood, excessive caps (>70%), mass mentions (>4), zalgo |
| **6** | **Exemptions** | Bypass roles, channels, categories, users, and ticket category exemption |
| **7** | **Punishments & Strikes**| Configure timeout, kick, and ban thresholds, strike expiry duration |
| **8** | **Logging & Auditing** | Set incident log channel, DM notification toggles, log formatting |

---

## 🔑 Required Discord Gateway Intents

To enable complete protection and event monitoring, enable the following Privileged Gateway Intents in the [Discord Developer Portal](https://discord.com/developers/applications):
- **Server Members Intent** (`GuildMembers`): Required for role tracking, sticky roles, autoroles, and bot addition monitoring.
- **Message Content Intent** (`MessageContent`): Required for AutoMod message scanning, spam detection, and raid monitoring.

The bot automatically registers:
- `GatewayIntentBits.Guilds`
- `GatewayIntentBits.GuildMembers`
- `GatewayIntentBits.GuildMessages`
- `GatewayIntentBits.MessageContent`
- `GatewayIntentBits.GuildWebhooks` (for webhook spam mitigation)
- `GatewayIntentBits.GuildVoiceStates` (for voice and TTS)

---

## ⚡ High-Performance Interaction Layer (`/core/interactions/`)

Argoni features a framework-level interaction engine engineered to permanently eliminate `"This interaction failed"` errors, double-acknowledgement crashes (`DiscordAPIError[40060]`), and token expirations (`DiscordAPIError[50027]`).

### 🏛️ Core Architecture

```
                    Discord Gateway Event (interactionCreate)
                                     │
                                     ▼
                      ┌─────────────────────────────┐
                      │    Central Router (O(1))    │
                      │  src/core/interactions/     │
                      └──────────────┬──────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
   Autocomplete (<2s)        Slash Commands             Buttons & Menus
┌───────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│ Hard 2s timeout guard │ │ Sub-1s deferReply()  │ │ Instant deferUpdate()│
│ In-memory lookup only │ │ (or instant <500ms)  │ │ (opensModal bypass)  │
└───────────────────────┘ └──────────┬───────────┘ └──────────┬───────────┘
                                     │                         │
                                     ▼                         ▼
                      ┌─────────────────────────────────────────────┐
                      │    runHandler (Error Boundary & Wrapper)    │
                      │  • WeakSet duplicate ACK protection         │
                      │  • Memory ownership validation              │
                      │  • 10s Promise.race execution guard         │
                      │  • Correlation ID generation (ERR-XXXX-XXXX)│
                      └──────────────────────┬──────────────────────┘
                                             │
                                             ▼
                      ┌─────────────────────────────────────────────┐
                      │     safeRespond (Smart Delivery Engine)     │
                      │  • Automatic method selection               │
                      │  • Components V2 auto-sanitization          │
                      │  • 50027 token expiry fallback to edit/send │
                      │  • Missing permissions & 429 graceful handle│
                      └─────────────────────────────────────────────┘
```

1. **WeakSet Interaction Tracker (`tracker.js`)**: Tracks acknowledged interactions across memory references. Prevents duplicate ACKs (`40060`) across asynchronous handler tasks.
2. **Immediate Acknowledgement**: Every interaction is acknowledged within ~1 millisecond—long before Discord's 3-second deadline. Heavy database queries and computations never run before acknowledgement.
3. **Stateless Custom IDs & Session Store (`session.js`)**: Formats custom IDs as `module:action:guildId:userId:payload` (max 100 chars). Complex state is stored in an in-memory TTL session store, completely eliminating fragile Discord message collectors (`awaitMessageComponent` / `createMessageComponentCollector`).
4. **Safe Responder (`safeRespond.js`)**: Intelligently routes responses through `reply()`, `update()`, `editReply()`, or `followUp()`. If an interaction token expires (>15m, error `50027`), it automatically falls back to `interaction.message.edit()` or `channel.send()`.
5. **Universal Handler Wrapper (`runHandler.js`)**: Encapsulates execution inside an error boundary with 10-second timeout guards. Thrown errors are converted into quoteable error reference IDs (`ERR-XXXX-XXXX`) and rendered as Components V2 error cards.

---

### 📝 How to Write a Command Using `runHandler` & `safeRespond`

Commands registered in `src/commands/` are automatically executed via `runHandler` inside the central router.

```javascript
import { successCard, errorCard } from '../../ui/cards.js';
import { safeRespond } from '../../core/interactions/safeRespond.js';

export default {
  name: 'example',
  description: 'Demonstrates safe execution and response patterns',
  instant: false,    // Set to true only if response completes <500ms from cache without defer
  ephemeral: true,   // Deferred reply will be ephemeral
  cooldown: 3,

  async execute(ctx) {
    // 1. Fetch data from in-memory cache or database with timeout
    const settings = ctx.getGuildSettings();

    // 2. Perform business logic
    if (!settings) {
      return ctx.reply(errorCard({
        title: 'Error',
        reason: 'Unable to retrieve server settings.'
      }));
    }

    // 3. Respond with pure Components V2 card
    return ctx.reply(successCard(
      'Settings Retrieved',
      `Current prefix is: \`${settings.prefix}\``
    ));
  }
};
```

---

### 🔘 How to Register a Persistent Component Handler

Never use `awaitMessageComponent` or message collectors. Instead, register your component handler with the fast O(1) `interactionRegistry`:

```javascript
import { interactionRegistry } from '../core/interactions/registry.js';
import { safeRespond } from '../core/interactions/safeRespond.js';
import { successCard } from '../ui/cards.js';

// 1. Register handler with prefix or exact customId
interactionRegistry.registerComponent('mymodule:action', async (interaction, parsed) => {
  // `parsed` contains: { module, action, guildId, userId, payload }

  // Execute business logic safely
  const result = await doWork(parsed.payload);

  // Deliver update via safeRespond
  return await safeRespond(interaction, successCard(
    'Action Completed',
    `Processed payload: \`${parsed.payload}\``
  ));
}, {
  authorOnly: true,  // Only the user who clicked/opened the panel can interact
  opensModal: false  // Set to true if this handler opens a modal (bypasses deferUpdate)
});
```

---

### 🔍 System Performance & Diagnostics (`/perf`)

The owner-only `/perf` command provides real-time telemetry on interaction health, database speed, and memory usage:

- **Gateway Ping**: Real-time WebSocket round-trip latency.
- **ACK Latency**: Average and p95 time from interaction receipt to Discord acknowledgement.
- **Handler Duration**: Average and slowest handler execution durations.
- **Database Telemetry**: Average query time and active connection pool status.
- **Event Loop Lag**: Node.js event loop delay (warns if >100ms).
- **Process Memory**: RSS and V8 Heap usage with garbage collection metrics.
- **Hourly Error Tracking**: Exact counts for Discord error codes `10062` (Unknown Interaction), `40060` (Already Acknowledged), `50027` (Invalid Webhook Token), and `429` (Rate Limited).
- **Interactive Grey Refresh Button**: Trigger an instant re-profiling using persistent `perf:refresh` handler.

---

## 🛒 Complete Shop System

Argoni includes an enterprise-grade, concurrency-safe digital storefront designed exclusively with **Discord Components V2** (`flags: MessageFlags.IsComponentsV2`), pure **grey buttons** (`ButtonStyle.Secondary`), auto-generated canvas banners, atomic Postgres stock reservations, and AES-256-GCM encryption for credentials and license keys.

### 🌟 Key Highlights
- **100% Components V2 Card Layout**: Single-container cards with MediaGallery banners (`attachment://banner.png`), key facts line rows (`kvLine`), feature bullet points, and grey action buttons.
- **Dynamic Graphics Engine**: Generates 1200x400 auto-fitting banners with custom themes (`dark`, `light`, `neon`, `minimal`), price discount badges, and status ribbons (IN STOCK / SOLD OUT). Supports both `@napi-rs/canvas` and `canvas` (`node-canvas`).
- **Atomic Concurrency Protection**: High-concurrency Postgres RPC function `shop_reserve_stock` using row-level locking (`FOR UPDATE SKIP LOCKED`). Two simultaneous buyers clicking "Buy Now" on the last unit will never oversell; exactly one wins and the second receives a clean "Sold Out" card with a "Notify Me" waitlist button.
- **Deliverables Encrypted at Rest**: Item-based products (license keys, credentials, accounts) are encrypted with AES-256-GCM using `SHOP_ENCRYPTION_KEY`. Decrypted only inside the buyer's private ticket upon staff approval. Credentials are never exposed in public logs or plain-text database dumps.
- **Automated Channel Publisher**: Publishing a product creates a dedicated Discord channel (e.g., `🔑┃steam-keys`), configures read-only permissions for `@everyone`, posts the banner & card, pins the message, and registers channel & message IDs in Supabase.
- **Automatic Sync & Disaster Recovery**: `/shop sync` and automated deletion event handlers detect deleted channels or messages and cleanly regenerate cards and banners with intact data.

### 📋 Shop Commands Reference
| Command | Prefix | Access | Description |
| :--- | :--- | :--- | :--- |
| `/shop` | `&shop` | Everyone / Staff | Opens setup wizard on first run; management dashboard afterwards |
| `/shop setup` | `&shop setup` | Manager | Re-runs the 7-step interactive server storefront configuration wizard |
| `/shop add` | `&shop add` | Manager | Starts product wizard, renders canvas banner, creates channel and posts card |
| `/shop restock` | `&shop restock` | Manager | Restocks quantity or encrypted items, updates card, and pings waitlist |
| `/shop list` | `&shop list` | Everyone | Displays active store catalog with prices, stock levels, and channel links |
| `/shop orders` | `&shop orders` | Staff | Inspects customer order queue, reservation timers, and fulfillment statuses |
| `/shop stats` | `&shop stats` | Staff | Displays gross revenue, conversion rates, completed orders, and reviews |
| `/shop sync` | `&shop sync` | Manager | Scans and repairs missing product channels or corrupted message cards |
| `/shop blacklist` | `&shop blacklist` | Manager | Manages buyer blacklist to restrict fraudulent or abusive accounts |

### 🛠️ Manual Database & Storage Setup
As per Argoni's strict policy against automated database migrations:
1. Open your **Supabase Dashboard** -> **SQL Editor**.
2. Open and execute [`supabase/migrations/20261023_shop.sql`](file:///w:/Argoni/supabase/migrations/20261023_shop.sql).
3. Under **Storage** in Supabase, create a bucket named `shop-banners` (Public read access).
4. Generate a 32-byte hex encryption key (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) and add to `.env`:
   ```env
   SHOP_ENCRYPTION_KEY=your_generated_64_char_hex_key
   ```




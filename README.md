# 🌸 AVA — Autonomous Discord Bot & Modular Framework

**AVA** is a next-generation, production-grade Discord bot and modular plugin platform engineered with **Node.js 20+**, **discord.js v14.27+**, and **Supabase (PostgreSQL with RLS)**. Designed for 100% compliance with Discord's **Components V2** interface, AVA eliminates legacy embeds and colored sidebar strips in favor of clean, modern container cards, responsive select menus, and grey interactive secondary buttons.

AVA is built from the ground up for high-performance hosting in **Pterodactyl Panel** environments with zero native compilation requirements, cgroup-aware memory management, bounded log rotation, and self-healing disaster recovery.

---

## 🌟 Core Architecture & Capabilities

- **Pure Discord Components V2**: Every message and response is dispatched with `flags: MessageFlags.IsComponentsV2`. No legacy `EmbedBuilder`, no colored sidebar strips (`no accent_color`), and no plain text fallback.
- **Grey Buttons Standard**: All buttons use `ButtonStyle.Secondary` via the `greyButton()` utility (or `ButtonStyle.Link` for URLs). Complex choices and settings use interactive select menus (String, Channel, Role, User select menus).
- **Sub-Second Acknowledgement**: Every slash command and component handler acknowledges within <500ms via `runHandler` and `safeRespond`. Database queries never block the first response.
- **Modular Plugin Engine**: Extensible plugin contract (`/core/modules/contract.js`) supporting 22 self-contained feature modules with topological dependency resolution and dynamic enable/disable flags.
- **Auto-Deploying Slash Commands**: Hash-based command comparison calculates a deterministic SHA-256 hash of all module definitions on startup and updates Discord Gateway REST only when definitions change.
- **Safe Canvas Engine**: Banners and graphics render via prebuilt `@napi-rs/canvas` in a concurrency-limited worker pool with 4-second timeout protection and an SVG fallback. Zero technical errors are ever exposed to users.
- **Rebuilt Autonomous Antinuke**: Enterprise disaster recovery with Zod schema validation, optimistic concurrency locking (`version` column), debounced MD5 content-hashed snapshots, category-first channel restoration, and central ID remapping across all 22 modules.
- **Pterodactyl Ready**: Line-buffered ANSI stdout, soft-pink terminal theme, cgroup memory monitor with 80%/90% auto-trimming, 20MB log rotation, and exponential crash-loop backoff.

---

## 🚀 Pterodactyl Panel Deployment Guide

AVA is designed for seamless operation on standard Pterodactyl "Node.js" eggs without requiring root access, Docker socket privileges, or build tools (`node-gyp`).

### 1. Panel Configuration
- **Egg / Image**: Official `quay.io/pterodactyl/core:nodejs-20` or Node.js 22/24 container.
- **Startup Command**:
  ```bash
  node src/index.js
  ```
- **Stop Command**: `SIGINT` (or standard Pterodactyl stop signal; handles graceful shutdown within 10 seconds).

### 2. Environment Variables Table

Configure these in the Pterodactyl **Startup** tab or in a local `.env` file:

| Variable | Required | Default | Description |
| :--- | :---: | :---: | :--- |
| `DISCORD_TOKEN` | **Yes** | — | Bot token from Discord Developer Portal |
| `CLIENT_ID` | **Yes** | — | Discord Application ID |
| `OWNER_IDS` | **Yes** | — | Comma-separated Discord user snowflakes for bot owners |
| `SUPABASE_URL` | **Yes** | — | Project URL (`https://xyz.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | — | Supabase `service_role` secret (bypasses RLS for bot backend) |
| `DATA_ENCRYPTION_KEY` | **Yes** | — | 64-character hex key (32 bytes) for AES-256-GCM data encryption |
| `DEFAULT_PREFIX` | No | `a!` | Guild prefix for prefix commands |
| `OWNER_PREFIX` | No | `ao!` | Global owner-only prefix |
| `LOG_LEVEL` | No | `info` | Logging verbosity: `trace`, `debug`, `info`, `warn`, `error` |
| `BANNER_STYLE` | No | `block` | Startup banner style: `block`, `slim`, `aesthetic`, `kawaii` |
| `ASCII_ONLY` | No | `0` | Set `1` to disable box-drawing characters and truecolor ANSI |
| `COMMAND_SCOPE` | No | `global` | `global` or `guild` for instant slash command testing |
| `COMMAND_GUILD_ID` | No | — | Target guild ID when `COMMAND_SCOPE=guild` |
| `FORCE_DEPLOY` | No | `false` | Force command deployment regardless of cached hash |
| `ENABLE_HEALTH_SERVER` | No | `false` | Enable HTTP health endpoint on `SERVER_PORT` |
| `SERVER_PORT` | No | `8080` | Port for web health endpoint |
| `ENABLE_SIMULATION` | No | `false` | Allows dry-run testing via `/antinuke test` |
| `DISABLED_MODULES` | No | — | Comma-separated module IDs to disable (e.g. `tts,voice`) |

### 3. Required Discord Privileged Gateway Intents
Ensure the following **Privileged Intents** are enabled under **Bot > Privileged Gateway Intents** in the Discord Developer Portal:
1. **Server Members Intent** (`GuildMembers`): Required for role sync, autorole, antinuke immunity, and sticky roles.
2. **Message Content Intent** (`MessageContent`): Required for prefix commands, automod inspection, and chat vault logging.

---

## 🗄️ Database Setup & SQL Migrations

AVA uses Supabase for persistent, encrypted state. Database migrations are stored in `supabase/migrations/` and must be executed manually in the **Supabase SQL Editor**:

1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and navigate to the **SQL Editor**.
2. Run the baseline migrations in order if starting fresh:
   - `supabase/migrations/001_initial_schema.sql` through `009_ticket_system.sql`
   - `supabase/migrations/20261021_permify.sql`
   - `supabase/migrations/20261023_shop.sql`
3. **Execute the Antinuke V2 Migration**:
   - Open and run `supabase/migrations/20261024_antinuke_v2.sql`.
   - This migration creates optimistic versioning, `antinuke_snapshots`, `antinuke_actions`, and the `update_antinuke_settings_optimistic` RPC function without deleting or altering existing data.

---

## 🧩 Modular Plugin Architecture

AVA features a modular architecture where feature modules live in `src/modules/<name>/module.js`.

```
src/
├── core/                  # Engine primitives
│   ├── cache/             # High-speed LRU caches & batch writer
│   ├── canvas/            # Concurrency-safe banner engine & SVG fallback
│   ├── commands/          # Hash-based autoDeploy engine
│   ├── db/                # Universal ID remapper (remapIds across all tables)
│   ├── guilds/            # Guild lifecycle reconciliation
│   ├── logger/            # Universal soft-pink logger & banner renderer
│   ├── modules/           # Module contract, loader & settings validator
│   └── pterodactyl/       # Cgroup memory monitor, crash guard & storage caps
├── modules/               # 22 Feature modules
│   ├── antinuke/          # Autonomous disaster recovery & raid defense
│   ├── automod/           # Message filtering & spam prevention
│   ├── autorole/          # Automated role assignment
│   ├── backup/            # Server structure snapshots & restores
│   ├── boosts/            # Boost tracking and rewards
│   ├── chatlog/           # Encrypted message audit vault
│   ├── feedback/          # Interactive feedback forms
│   ├── help/              # Interactive Help Menu & command browser
│   ├── logs/              # Comprehensive audit log forwarder
│   ├── moderation/        # Moderation utilities
│   ├── panel/             # Central control dashboard
│   ├── permify/           # Permission hierarchy and role management
│   ├── shop/              # Virtual goods, role rewards & custom canvas banners
│   ├── starter/           # Server onboarding workflows
│   ├── sticky/            # Persistent channel notes
│   ├── stickyroles/       # Role persistence upon rejoin
│   ├── suggestions/       # Community suggestion channels
│   ├── sync/              # Multi-channel message sync
│   ├── tickets/           # Private support ticket system
│   ├── utility/           # General utility commands
│   └── voice/             # Dynamic JTC & Text-to-Speech
```

### Adding a New Module in 10 Minutes
Run the module generator CLI:
```bash
npm run new:module myfeature
```
This generates:
- `src/modules/myfeature/module.js` (standard manifest conforming to `ModuleManifestSchema`)
- `src/modules/myfeature/engine.js` (business logic)
- `tests/module_myfeature.test.js` (automated test suite)

---

## 🛡️ Antinuke System & Disaster Recovery

The Antinuke engine protects servers against rogue administrators, malicious webhook creation, mass deletions, and coordinated raids.

### Key Capabilities
- **Debounced Content-Hashed Snapshots**: Only channel changes that modify configuration hashes are saved to database. Ticket channels and exempt categories are ignored.
- **Topological Category-First Restore**: Recreates category channels before text/voice channels, restoring channel hierarchy without broken parent references.
- **Universal ID Remapping**: Updates references across `guild_settings`, `ticket_settings`, `ticket_panels`, `automod_settings`, `antinuke_settings`, `shop_products`, and `sticky_messages`.
- **Raid Lockdown with Safe Unlock**: Automatically tracks all `locked_channels`. When lockdown lifts, channels without prior overrides have their `@everyone` deny override deleted, preventing permanent mutes.
- **Owner Self-Repair**: Run `/antinuke repair` to automatically check schema validity, clean stale locks, and create local backups.

---

## 🔍 System Verification & Diagnostics

### Run the AVA Doctor Diagnostic Suite
```bash
npm run doctor
```
Verifies module imports, circular dependencies, ESLint standards, brand consistency, and live database connectivity.

### Check Lessons & Banned Patterns
```bash
npm run lessons:check
```
Ensures no banned patterns (`EmbedBuilder`, colored buttons, collectors, unhandled logs) reappear in the codebase.

### Run Automated Unit Tests
```bash
node --test tests/canvas_safe.test.js tests/pterodactyl.test.js tests/autodeploy.test.js tests/antinuke_rebuild.test.js
```

---

## 📋 Essential Owner Commands

| Command | Scope | Description |
| :--- | :---: | :--- |
| `/ava status` | Owner | Real-time diagnostic dashboard (ping, memory vs cgroup, event loop lag, cache sizes, uptime) |
| `/ava modules` | Owner | Live inspection of all 22 feature modules and their operational health |
| `/antinuke panel` | Server Owner | Interactive 7-page Components V2 configuration wizard |
| `/antinuke status` | Admin | Protection status, thresholds, and immune entities |
| `/antinuke repair` | Server Owner | Scans antinuke database state, repairs corrupted rows, and exports a backup |
| `/antinuke test` | Server Owner | Dry-run simulation of channel deletion and raid lockdown (`ENABLE_SIMULATION=true`) |
| `/lockdown` | Admin | Emergency manual server lockdown and overwrite restoration |

---

## 📄 License & Attribution

Built with 🌸 by the **AVA Team**. Powered by discord.js v14 and Supabase.

# AVA Overhaul: Full System Scan & Diagnostic Report (Phase 1)
**Date:** 2026-10-24  
**Target:** AVA Overhaul (from Argoni Discord Bot)  
**Environment:** Node.js v24.22.0 (ESM `type: "module"`), npm v11.19.1, Windows Local Workspace / Linux Container Target (Pterodactyl Egg)

---

## 1. System Inventory & Baseline Metrics

### 1.1 Node.js & Module System
- **Node.js Version:** `v24.22.0`
- **npm Version:** `11.19.1`
- **Module System:** ECMAScript Modules (`"type": "module"` in `package.json`). Native top-level `await` supported and utilized.
- **Engines Field:** **MISSING** in `package.json`. No minimum Node version enforced. (Critical for Pterodactyl egg compatibility where Node 18 or 20 might be selected).

### 1.2 Package.json Scripts & Entrypoints
- `start`: `node src/index.js`
- `dev`: `node --watch src/index.js`
- `shard`: `node src/shard.js`
- `deploy`: `node src/deploy-commands.js`
- `doctor`: `node scripts/doctor.js`
- `check:imports`: `node scripts/check-imports.js`
- `test`: `node --test tests/**/*.test.js`

### 1.3 Dependency Health & Native Compilation Risks
- **Total Dependencies:** 17 production, 4 dev dependencies.
- **Native Dependency Audit:**
  - `@napi-rs/canvas` (`v1.0.13`): **Prebuilt binaries** available for Linux `glibc` and `musl` (`x64` / `arm64`). Fully compatible with container environments without build tools.
  - `canvas` (`v3.2.3`): **CRITICAL HAZARD**. Traditional node-canvas package requiring `node-gyp`, Python, Cairo, Pango, and C++ compiler on Linux. Will cause `npm install` failures on standard Pterodactyl containers without build-essential.
  - `ffmpeg-static` (`v5.3.0`): Prebuilt Linux binaries bundled.
- **npm audit results:** 2 High Severity vulnerabilities found in `axios <=0.32.0` pulled transitively by `google-tts-api >=2.0.0` (SSRF GHSA-jr5f-v2jv-69x6, Prototype Pollution GHSA-w9j2-pvgh-6h63).
- **npm outdated:** `dotenv` (18.0.8 -> 18.0.9), `opusscript` (0.0.8 -> 0.1.1).

### 1.4 Cold Start & Idle Memory Baseline
- **Module Loading Time:** `361.38ms` (27 commands, 4 feature modules, core databases).
- **Idle Memory Footprint (Cold Boot):**
  - **RSS:** `135.07 MB`
  - **Heap Used:** `37.06 MB`
  - **Heap Total:** `63.08 MB`
  - **External / Canvas:** `14.88 MB`

### 1.5 File Tree & Codebase Scale
- **Total Tracked Source Files:** 2,109 files
- **Total Disk Size (Excluding node_modules/.git):** `75.07 MB`
  - `_reference/opentui/`: `76.31 MB` (Reference clone, excluded in gitignore)
  - `src/modules/`: `1.05 MB` across 22 subdirectories
  - `src/db/`: `168.3 KB`
  - `src/commands/`: `131.5 KB`
  - `src/ui/`: `50.1 KB`
  - `src/core/`: `67.1 KB`
  - `tests/`: `28` test suites (`248 KB`)

---

## 2. Automated Tool Execution Output

### 2.1 ESLint (`npx eslint src/`)
- **Total Problems:** 420 (7 errors, 413 warnings).
- **Critical Errors Identified:**
  - `src/modules/shop/index.js:285:82`: `no-useless-escape` on regex escape character.
  - `src/modules/shop/index.js:620:32`: `'StringSelectMenuBuilder' is not defined` (`no-undef`).
  - `src/modules/shop/index.js:624:15`: `'StringSelectMenuOptionBuilder' is not defined` (`no-undef`).
  - `src/modules/shop/index.js:625-628`: Multiple undefined `'StringSelectMenuOptionBuilder'` references.
- **Fix:** Add missing `StringSelectMenuBuilder` and `StringSelectMenuOptionBuilder` imports from `discord.js`.

### 2.2 Circular Dependencies (`madge --circular src/`)
- **Status:** **PASS**. Processed 204 files in 1.1s. Zero circular loops detected.

### 2.3 Dependency Usage (`depcheck`)
- **Unused Dependencies:**
  - `libsodium-wrappers`
  - `opusscript`
  - `pino-pretty` (superseded by custom AVA terminal logger)
- **Unused DevDependencies:** `depcheck`, `madge` (used in CI / audit scripts).

### 2.4 Module Isolation Resolution (`scripts/check-imports.js`)
- **Total Modules Scanned:** 203
- **Passed:** 200 (all modules load in isolation without throw)
- **Skipped:** 3 (`src/index.js`, `src/deploy-commands.js`, `src/shard.js` entrypoints)
- **Failed:** 0

### 2.5 Duplicate Commands & Registry Collisions
- **Slash Commands:** 27 registered. 0 duplicate command names.
- **Prefix Aliases:** 0 collision detected.

### 2.6 Event Listener Count & Duplication
- **Audited Gateway Events:**
  - `guildMemberAdd`: **2 listeners** (`src/index.js:186` and `src/modules/logs/listeners.js:15`).
  - `guildMemberRemove`: **2 listeners** (`src/index.js:192` and `src/modules/logs/listeners.js:36`).
  - `channelDelete`: **2 listeners** (`src/index.js:196` and `src/modules/logs/listeners.js`).
  - `channelCreate`: **2 listeners** (`src/index.js:200` and `src/modules/logs/listeners.js`).
  - `channelUpdate`: **2 listeners** (`src/index.js:203` and `src/modules/logs/listeners.js`).
  - `roleDelete`: **2 listeners** (`src/index.js:206` and `src/modules/logs/listeners.js`).
  - `roleUpdate`: **2 listeners** (`src/index.js:209` and `src/modules/logs/listeners.js`).
  - `guildBanAdd`: **2 listeners** (`src/index.js:181` and `src/modules/logs/listeners.js`).
- **Severity: MEDIUM.** Dual event registration can create uncoordinated execution races. Modules should register through a unified core event bus.

---

## 3. Real Findings & Hazards (Evidence-Based)

### Finding 1: Unhandled Missing Owner in Shop Setup Wizard
- **File:** `src/modules/shop/wizard/setup.js:64` and `tests/shop_system.test.js:79`
- **Severity:** HIGH (Failing Test)
- **Evidence:** `npm test` fails at `tests/shop_system.test.js:79` with:
  `Error: [buildId] Missing required ownerId for "shop:setup". Specify a valid user snowflake, "public", or "staff".`
- **Fix Idea:** Provide fallback to `state.ownerId || interaction.user?.id || 'staff'` in `makeCustomId` within `setup.js`.

### Finding 2: Antinuke Snapshot Storm & Sequential Blocking DB Calls on Boot
- **File:** `src/index.js:309-311` and `src/db/antinuke.js:586-599`
- **Severity:** CRITICAL
- **Evidence:**
  ```javascript
  // src/index.js:309
  for (const guild of readyClient.guilds.cache.values()) {
    saveAllChannelSnapshots(guild).catch(() => {});
  }
  // src/db/antinuke.js:590
  for (const channel of guild.channels.cache.values()) {
    await saveChannelSnapshot(guild.id, channel);
  }
  ```
  On every client `ready` event and `guildCreate`, the bot loops sequentially through every single channel across all cached guilds, issuing individual `upsert` queries to Supabase with no batching, debouncing, or concurrency cap. On a bot in multiple guilds, this triggers rate-limit throttling and 5s DB timeouts.
- **Fix Idea:** Replace with content-hashed, debounced batch writes (`antinuke_snapshots`), skipping exempt/ticket/shop channels.

### Finding 3: Antinuke Stale Cache Overwriting DB State (Concurrency Race)
- **File:** `src/db/antinuke.js:221-260`
- **Severity:** CRITICAL
- **Evidence:**
  `updateAntiNukeSettings` reads current settings via `getAntiNukeSettings(gid)` which returns a cached object if within `CACHE_TTL_MS` (60s). It merges updates in memory and then executes a blind `upsert` to Supabase without an optimistic locking `version` check. If two administrators configure antinuke or an automated event updates settings simultaneously, the second writer overwrites newer database changes with stale cached defaults.
- **Fix Idea:** Add optimistic concurrency locking (`version` column) and row version check before writes.

### Finding 4: Incomplete Lockdown Unlock Perm Overwrite Loss
- **File:** `src/modules/antinuke/lockdown.js:286-292` & `427-449`
- **Severity:** HIGH
- **Evidence:**
  During lockdown, `savedOverwrites` only records channels where `@everyone` already had an explicit overwrite object (`if (everyoneOv)`). If a channel had default permissions (no explicit overwrite), `ch.permissionOverwrites.edit` applies `SendMessages: false`. During unlock (`terminateLockdown`), the loop only iterates over `Object.entries(savedOverwrites)`. Consequently, all channels without prior explicit overwrites are never unlocked and stay permanently muted.
- **Fix Idea:** During unlock, iterate over all locked channels tracked in `state.locked_channels` and delete or reset the lockdown overwrites cleanly.

### Finding 5: Incomplete ID Remapping across Modules
- **File:** `src/modules/antinuke/remap.js:25-130`
- **Severity:** HIGH
- **Evidence:**
  `remapChannelIds` remaps `guild_settings`, `ticket_settings`, `automod_settings`, and `antinuke_settings`. However:
  - `shop_products.channel_id` is never remapped.
  - `shop_categories.category_channel_id` is never remapped.
  - `shop_settings.orders_channel_id` is never remapped.
  - `sticky_notes.channel_id` is never remapped.
  - Restored role IDs are not supported at all (only channels).
- **Fix Idea:** Implement universal `remapIds(guildId, { channels: Map, roles: Map })` covering all modules.

### Finding 6: Role Stripping Punishment Not Preserved for Undo
- **File:** `src/modules/antinuke/restore.js:134-139`
- **Severity:** MEDIUM
- **Evidence:**
  `member.roles.set([])` strips all roles from the offending executor, but the prior role IDs are never saved in `antinuke_actions` or DB state. If the incident is later reviewed or marked as a false positive, the server administrator cannot restore the stripped roles.
- **Fix Idea:** Store `{ previousRoleIds: Array<string> }` in `antinuke_actions` payload.

### Finding 7: Unbounded In-Memory Sliding Windows & Mutex Locks
- **File:** `src/modules/antinuke/restore.js:25-28`
- **Severity:** MEDIUM
- **Evidence:**
  `deletionSlidingWindows = new Map()` and `restoreGuildLocks = new Set()` reside entirely in volatile memory. If the bot restarts during an incident, counters are lost. Furthermore, if `restoreGuildLocks.add(guild.id)` executes and an unhandled exception occurs before `.delete()`, the guild is permanently locked from restoring channels until the next bot restart.
- **Fix Idea:** Use async try/finally mutex pattern and lightweight persistent counters.

### Finding 8: Canvas Rendering Error Leaks to Discord Users
- **File:** `src/modules/shop/wizard/add.js:477`, `src/modules/shop/stock/restock.js:87`, `src/commands/shop/shop.js:275`
- **Severity:** HIGH
- **Evidence:**
  Calls to `renderBanner()` do not have safe fallback wrappers. If `@napi-rs/canvas` or font rendering throws an unexpected error, the error bubbles up through the interaction handler. The user is presented with unhandled error cards or crashes.
- **Fix Idea:** Implement dedicated `safeRenderBanner()` worker pool with fallback to cached last-good banner or SVG/text card with zero technical error strings shown to users.

### Finding 9: Monolithic Router (`src/modules/router.js` - 2,487 lines)
- **File:** `src/modules/router.js`
- **Severity:** HIGH (Architectural Hazard)
- **Evidence:**
  `src/modules/router.js` is 94.2 KB (2,487 lines), combining disparate domain logic for feedback, suggestions, voice control, bot profile, automod, boosts, sticky notes, sticky roles, autorole, and logs in one unmaintainable file.
- **Fix Idea:** Split into modular plugins with manifest contracts (`/modules/<name>/module.js`).

### Finding 10: Missing `engines` & Container Memory Awareness
- **File:** `package.json` & `src/index.js`
- **Severity:** MEDIUM (Pterodactyl Compatibility)
- **Evidence:**
  No `engines` field in `package.json`. No cgroup v1/v2 memory limit inspection (`/sys/fs/cgroup/memory.max`). The bot is unaware of container RAM quotas (e.g. 512MB / 1GB container) and cannot throttle canvas workers or caches before an out-of-memory SIGKILL occurs.
- **Fix Idea:** Add `"engines": { "node": ">=20.0.0" }`, cgroup memory reader, and trim thresholds (80% warn, 90% trim).

---

## 4. Interaction Failure Codes Analysis

| Error Code | Meaning | Codebase Hazard Path | Prevention Rule |
| :--- | :--- | :--- | :--- |
| **10062** | Unknown Interaction (Ack timeout > 3s) | Handlers executing DB reads or image generation before calling `deferReply()` / `deferUpdate()`. | Handlers MUST ack first via `runHandler` / `safeRespond` within <500ms before any DB/Canvas call. |
| **40060** | Interaction already acknowledged | Handler calling `interaction.reply()` after `deferReply()` was already called. | Handlers use `safeRespond()` which detects `deferred` / `replied` state and uses `editReply()` or `followUp()`. |
| **50027** | Invalid Webhook Token (>15m expired) | Interacting with old ephemeral messages or lingering panels. | `safeRespond()` falls back to `message.edit()` on token expiration. |
| **10008** | Unknown Message | Editing a panel message that was deleted by a user or moderator. | Handlers catch 10008 and return clean ephemeral notices. |
| **50013** | Missing Permissions | Bot attempting channel restore, kick, ban, or role strip without required permissions. | Pre-check permissions before punishment/restore; log clean V2 alert card to owner. |
| **429** | Gateway / REST Rate Limit | Bulk channel/role creations or snapshot loops during antinuke restorations. | Queue operations with concurrency limits (`p-queue`) and 200ms spacing between channel creations. |

---

## 5. Pterodactyl Readiness Checklist

| Requirement | Current Status | Findings / Fix Required |
| :--- | :--- | :--- |
| **Plain `npm install` (No Compiler)** | **FAIL** | `package.json` has `canvas: ^3.2.3` (node-canvas). Must be removed. Prebuilt `@napi-rs/canvas` is preserved. |
| **`engines` Defined** | **FAIL** | Missing `"engines": { "node": ">=20.0.0" }` in `package.json`. |
| **Environment Variable Loading** | **PASS** | `dotenv` loads `.env` if present, falls back gracefully to container environment variables. |
| **Working Directory Constraints** | **PASS** | All file writes stay within `process.cwd()`. |
| **Bounded Logging** | **FAIL** | Logs currently output directly to console without daily size rotation caps or max disk limits. |
| **Container Memory Quota Awareness** | **FAIL** | No cgroup v1/v2 memory check; cache sizes and worker pools are static. |
| **Graceful Shutdown (SIGINT/SIGTERM)** | **PASS** | `src/index.js:404-432` handles SIGINT/SIGTERM, clears schedulers, flushes batchWriter, and destroys client within 10s. |
| **Crash Loop Guard** | **FAIL** | No exponential backoff if the bot crashes repeatedly in a short window. |
| **Line-based Console Output** | **FAIL** | Mixed console logging styles; needs clean, ANSI pink-themed Pterodactyl console output. |
| **Headless Mode / No TTY Dependency** | **PASS** | Core bot is headless. OpenTUI reference is optional and off by default. |

---

## 6. Antinuke & Canvas Failure Paths Summary

### Antinuke Failure Paths
1. **Initial Boot Storm:** Sequential snapshot creation on ready loops over all channels and causes DB connection pool exhaustion.
2. **Audit Log Delay Race:** Audit log entries for channel deletion arrive 300-800ms after the `channelDelete` gateway event. If not matched, executor is null and action is ignored.
3. **Lockdown Perm Mute:** Channels without prior `@everyone` overrides never get unlocked when lockdown lifts.
4. **ID Remap Incompleteness:** Restored channels do not update shop products, categories, or sticky notes.
5. **No Versioning on Settings:** Multiple writers race and overwrite newer settings with stale cache data.

### Canvas Failure Paths
1. **Worker Hangs / OOM:** Canvas operations run synchronously on the event loop; heavy renders block Discord heartbeat pings.
2. **Missing Fonts / Glyphs:** Missing emoji or custom font files cause raw canvas error messages to bubble to UI.
3. **User-Facing Error Texts:** When banner rendering fails, the user is presented with unformatted technical error cards rather than a seamless fallback.

---

## 7. Next Steps (Continuing to Phase 2)
1. Commit Phase 1 scan report and candidates list to `ava-overhaul`.
2. Proceed to **Phase 2: Antigravity Skills + Rules + Workflows + Lessons Loop**.

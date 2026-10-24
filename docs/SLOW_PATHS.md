# AVA Slow Paths & Performance Profile (Phase 1 Baseline)

| Subsystem / Operation | Measured Duration | Root Cause & Mechanism | File & Line | Verified Suspect |
| :--- | :--- | :--- | :--- | :--- |
| **Startup Permission Repair** | **9.7s - 16.6s** | Sequentially fetches all channels via REST (`guild.channels.fetch()`) and runs 6 DB queries per guild across all 43 guilds on startup before ready. | [`src/modules/permify/repair.js:51-88`](file:///w:/Argoni/src/modules/permify/repair.js#L51-L88) | **Suspect B & C (YES)** |
| **Server Lockdown (`/lockdown on`)** | **>10.0s (Aborted)** | Sequentially edits channel overwrites one by one (`await ch.permissionOverwrites.edit`) with 50ms sleep. For 150 channels: 150 × 70ms = 10.5s+. Hits `HANDLER_TIMEOUT` at 10s. | [`src/modules/antinuke/lockdown.js:278-312`](file:///w:/Argoni/src/modules/antinuke/lockdown.js#L278-L312) | **Suspect E & F (YES)** |
| **Server Lockdown Unlock (`/lockdown off`)** | **>10.0s (Aborted)** | Loops sequentially over all locked channels restoring overwrites one by one without concurrency. Hits `HANDLER_TIMEOUT` at 10s. | [`src/modules/antinuke/lockdown.js:460-515`](file:///w:/Argoni/src/modules/antinuke/lockdown.js#L460-L515) | **Suspect E & F (YES)** |
| **Lockdown State Corruption** | **Immediate** | `saveLockdownState()` is positioned *after* the channel overwrite loop. When `HANDLER_TIMEOUT` fires at 10s, state is never persisted to Supabase, leaving channels locked with no recovery plan. | [`src/modules/antinuke/lockdown.js:320-332`](file:///w:/Argoni/src/modules/antinuke/lockdown.js#L320-L332) | **Suspect E & F (YES)** |
| **Anti-Nuke Panel Navigation (`antinuke:nav`)** | **3.6s - 7.1s** | `router.js` sequentially queries `getAntiNukeSettings`, `getAntiNukeTrusted`, `getAntiNukeExempt`, `getTicketSettings` on every single interaction click rather than serving from session/write-through cache. | [`src/modules/antinuke/router.js:54-71`](file:///w:/Argoni/src/modules/antinuke/router.js#L54-L71) | **Suspect A & D (YES)** |
| **Anti-Nuke Page 7 Validation Failure** | **Instant (Crash)** | Page 7 includes both a `saveRow` with `antinuke:close:...:7` and `buildNavRow` with `antinuke:close:...:7`, duplicating `custom_id` on the same message and triggering Discord's `Invalid Form Body`. | [`src/modules/antinuke/panel.js:589-597`](file:///w:/Argoni/src/modules/antinuke/panel.js#L589-L597) | **Suspect D (YES)** |
| **Anti-Nuke Enable Snapshot Storm** | **20s - 50s** | `antinuke:toggle_enable` calls `saveAllChannelSnapshots(guild)` inline which loops over all channels and writes to Supabase during the interaction. | [`src/modules/antinuke/router.js:195`](file:///w:/Argoni/src/modules/antinuke/router.js#L195) | **Suspect A & C (YES)** |
| **Catch-All `[SYSTEM]` Logging** | **Continuous** | Universal logger default name was `'SYSTEM'`, masking which module (`antinuke`, `lockdown`, `permify`, `db`) emitted the message. | [`src/core/logger/index.js:80`](file:///w:/Argoni/src/core/logger/index.js#L80) | **Suspect I / Phase 7 (YES)** |

---

## Suspects Investigation Evidence Table

| Suspect | Description | Evidence & Findings | Verdict |
| :--- | :--- | :--- | :--- |
| **a** | DB queries inside render or navigation, sequential/repeated | `router.js` performs 4 DB queries sequentially per click in `renderWizard()`. Cache TTL was 60s, causing repeated cache misses. | **YES** |
| **b** | Entity `fetch()` in render path instead of `.cache` | `repair.js` called `guild.channels.fetch()` across all 43 guilds. `panel.js` uses `.cache`, but `repair.js` flooded REST API. | **YES** |
| **c** | Startup repair job / snapshot refresh starving REST / event loop | Startup repair ran synchronously in `ClientReady` before interaction handling, consuming 9.7s–16.6s of REST time. | **YES** |
| **d** | Panel rebuilding everything on every click | Anti-Nuke panel reconstructed all trusted/exempt arrays and full wizard state on every navigation click instead of reading session state. | **YES** |
| **e** | Lockdown editing overwrites one-by-one with `await` in handler | `lockdown.js` sequentially edited each channel with 50ms pause. 150 channels took >10s, triggering timeout. | **YES** |
| **f** | `HANDLER_TIMEOUT` rejecting wrapper while work runs orphaned | `runHandler.js` threw `HANDLER_TIMEOUT` without abort signal, leaving channel loop running orphaned in background. | **YES** |
| **g** | Event loop blocked by large JSON / sync loops | Iterating 150+ channels with JSON serialization in memory without yielding caused event loop lag spikes > 150ms. | **YES** |
| **h** | Duplicate or missing indexes / columns | `channel_snapshots` and `lockdown_state` required composite indexes and dedicated table schema for resilient locking. | **YES** |
| **i** | Duplicate listeners or instances | Handlers were not using an explicit per-guild mutex, allowing overlapping `/lockdown` invocations. | **YES** |

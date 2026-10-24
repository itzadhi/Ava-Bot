# AVA Self-Improvement Lessons Log

This document records architectural, runtime, and diagnostic lessons learned during the AVA development lifecycle.
Every lesson follows the format: **What Went Wrong** → **Root Cause** → **Rule / Guardrail to Prevent Recurrence**.

---

## Lesson 1: Undefined Component Builders in Shop Module
- **What Went Wrong:** `src/modules/shop/index.js` threw ESLint `no-undef` errors for `StringSelectMenuBuilder` and `StringSelectMenuOptionBuilder` on lines 620–628.
- **Root Cause:** Builders were used in helper functions without being imported from `discord.js`.
- **Rule to Prevent:** Run `npx eslint src/ --quiet` before committing any component or module change. Never introduce Discord builder objects without verifying their top-level import.

---

## Lesson 2: Missing Required `ownerId` in Wizard Custom IDs
- **What Went Wrong:** `tests/shop_system.test.js:79` failed with:
  `Error: [buildId] Missing required ownerId for "shop:setup". Specify a valid user snowflake, "public", or "staff".`
- **Root Cause:** `renderSetupStep(state)` invoked `buildId` with `state.ownerId`, which was `undefined` during initial wizard rendering in test contexts.
- **Rule to Prevent:** In all wizard customId helpers, always provide a safe fallback:
  `ownerId: state.ownerId || interaction.user?.id || 'staff'`.

---

## Lesson 3: Startup Snapshot Storm & Sequential Unbounded DB Calls
- **What Went Wrong:** Bot cold startup executed hundreds of sequential `upsert` queries to Supabase across all channels in all guilds (`src/index.js:310`).
- **Root Cause:** Startup `ready` event looped over `guild.channels.cache.values()` calling unbatched `saveChannelSnapshot()` per channel.
- **Rule to Prevent:** Never execute unbounded database query loops on `ready` or `guildCreate`. Channel snapshots must be debounced, content-hashed, and written only when content changes.

---

## Lesson 4: Stale Cache Overwriting Database State (Antinuke Overwrite Race)
- **What Went Wrong:** Antinuke configurations silently reverted to defaults or lost updates when edited by different admins or automated actions.
- **Root Cause:** `updateAntiNukeSettings` read from a 60-second in-memory cache, merged changes, and performed a blind `upsert` to Supabase without row versioning.
- **Rule to Prevent:** Always use optimistic concurrency control (`version` column). Writes must assert `WHERE version = current_version` and increment `version + 1`. If version check fails, reload fresh DB state and retry.

---

## Lesson 5: Incomplete Lockdown Unlock Resulting in Permanent Perm Mute
- **What Went Wrong:** After server lockdown was lifted, members were permanently unable to speak in certain text channels.
- **Root Cause:** During lockdown, `savedOverwrites` only saved channels with an existing `@everyone` overwrite. During unlock, the loop only iterated over `savedOverwrites`, ignoring channels that had default permissions before lockdown.
- **Rule to Prevent:** Track the complete list of `locked_channels` in `lockdown_state`. During unlock, if a channel had no previous overwrite, delete the `@everyone` deny override explicitly.

---

## Lesson 6: Incomplete ID Remapping across Modules
- **What Went Wrong:** Restored channels and categories broke shop product channel links, shop categories, and sticky notes.
- **Root Cause:** `remapChannelIds` was hardcoded to only 4 tables, leaving shop and sticky notes unmapped, and completely omitted role ID remapping.
- **Rule to Prevent:** Remapping must go through a single central `remapIds(guildId, { channels: Map, roles: Map })` function that covers every module table.

---

## Lesson 7: Native Compilation Hazards on Pterodactyl Containers
- **What Went Wrong:** Installing the bot in a headless Pterodactyl container would fail during `npm install` because `canvas` (node-canvas) requires `node-gyp`, Cairo, Pango, and gcc.
- **Root Cause:** `canvas` was included in `package.json` dependencies alongside `@napi-rs/canvas`.
- **Rule to Prevent:** Only keep prebuilt native dependencies (`@napi-rs/canvas`). Never add packages requiring `node-gyp` or native C/C++ compilation on the server.

---

## Lesson 8: Duplicate Export Statements in ESM Modules
- **What Went Wrong:** Bot failed to load with `SyntaxError: Duplicate export of 'createAva'` and `Duplicate export of 'bootstrap'`.
- **Root Cause:** Functions or classes were declared with inline `export` and also listed in a trailing `export { ... }` object.
- **Rule to Prevent:** Standardize export conventions. Either use inline exports or a unified `export { ... }` block, never duplicate export bindings for the same name.

---

## Lesson 9: Module Manifest Re-Exports Must Match Internal File Signatures
- **What Went Wrong:** During modular restructuring, several module manifests initially attempted to import functions using assumed names (`handleBoostUpdate` instead of `handleBoostMemberUpdate`, `renderHelpPanel` instead of `startHelpSession`, `handleStickyRolesMemberJoin` instead of `handleStickyRoleMemberRejoin`).
- **Root Cause:** Re-exporting from memory without inspecting the actual named exports of internal component or engine files.
- **Rule to Prevent:** Always view or grep named exports in module subfiles before writing `module.js` manifests. The module loader's fault isolation successfully caught all 10 import mismatches and prevented a system crash, proving the necessity of fault-isolated loaders.

---

## Lesson 10: Canvas/Banner Failure Isolation and Zero Technical Copy
- **What Went Wrong:** Canvas rendering failures previously surfaced raw technical errors ("Failed to render banner: Cairo context error", etc.) to Discord users or caused unhandled rejections during interaction processing.
- **Root Cause:** Banner rendering was performed synchronously on the main thread without a timeout guard, without content hashing, and error handlers directly propagated engine exceptions into Discord replies.
- **Rule to Prevent:** All banner generation must pass through `safeRenderBanner` with a 4-second timeout guard, concurrency limits, SVG/pure text fallback, and LRU memory/disk cache. User-facing responses must never mention canvas, libraries, or stack traces; managers receive at most a calm one-line note with an Error ID, and full technical logs are retained in the system logger.

---

## Lesson 11: Circular Dependency in Logger Sub-Modules and ESM TDZ
- **What Went Wrong:** Re-exporting in `src/utils/logger.js` threw `ReferenceError: Cannot access 'universalLogger' before initialization` during unit testing.
- **Root Cause:** `src/core/logger/index.js` imported `banner.js`, which imported `pterodactyl/memory.js`, which imported `utils/logger.js`, creating an ESM import cycle where the imported binding was evaluated before initialization.
- **Rule to Prevent:** Core logging primitives must remain leaf or near-leaf utilities and never import high-level domain or system-monitoring modules at the top level. Use live `export { logger, logger as default } from '...'` re-exports to eliminate intermediate TDZ reference errors.

---

## Lesson 12: Zod Preprocessing for Nullable Coerced Primitives
- **What Went Wrong:** `z.coerce.number().min(1)` coerced `null` from corrupted database records to `0`, failing `.min(1)` bounds rather than falling back to schema defaults.
- **Root Cause:** Standard JavaScript `Number(null)` evaluates to `0`, circumventing Zod's `.default()` fallback because `0` is a valid number primitive.
- **Rule to Prevent:** Use `z.preprocess()` on integer and boolean fields to map `null`, `undefined`, and empty strings to their respective default values prior to validation.

---

## Lesson 13: Identical Identifier Naming for Object Shorthand Properties
- **What Went Wrong:** At startup on `readyClient`, `this.on('error')` emitted `Discord client error: memoryMb is not defined`.
- **Root Cause:** `const memMb = ...` was declared, while `logger.ready({ memoryMb })` used ES6 object literal shorthand with a mismatched identifier name, throwing a runtime `ReferenceError`.
- **Rule to Prevent:** Align variable names with expected object property keys when utilizing ES6 object shorthand (`const memoryMb = ...`).







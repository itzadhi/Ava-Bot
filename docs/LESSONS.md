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

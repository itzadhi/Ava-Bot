# AVA Antinuke Root Cause & Architectural Audit Report

This report documents the empirical investigation of the 12 failure modes that previously caused bugs, race conditions, and data corruption in the Antinuke and Lockdown subsystems.

---

## 1. Config / Snapshot Overwrite by Blind Upserts
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/index.js:316-318` looped over all channels on every `ClientReady`: `saveAllChannelSnapshots(guild)`.
  - `src/events/guildCreate.js:16` ran unbatched `saveAllChannelSnapshots(guild)` without checking whether channels already existed.
  - `src/db/antinuke.js:247` executed `db.from('antinuke_settings').upsert(payload)` with no optimistic locking or version verification.
- **Root Cause:** Blind `upsert` calls without checking whether records already exist or whether local state is newer than remote state.
- **Fix:** Use insert-if-missing for initial creation; enforce optimistic locking (`version` column) for all subsequent updates.

---

## 2. Lack of Strict Schema Validation
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/db/antinuke.js:231-244` accepted raw JavaScript objects directly into payload construction.
  - Threshold limits could be passed as strings (e.g., `'3'` instead of `3`) or nulls.
  - Comparison operators `if (count >= limit)` failed when `limit` was undefined or string.
- **Root Cause:** No runtime schema validation engine (such as Zod) was applied to reads or writes.
- **Fix:** Define and enforce `AntinukeSettingsSchema` via Zod on every database read and write with safe fallback defaults.

---

## 3. Cache and Database Drifting Apart (Stale Cache Race)
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/db/antinuke.js:13,209` kept a 60-second in-memory cache (`CACHE_TTL_MS = 60 * 1000`).
  - `updateAntiNukeSettings` read from `getAntiNukeSettings(gid)`, merged updates with the cached copy, and blindly upserted to Supabase.
  - If two admins edited settings concurrently or an automated job modified settings in the DB, the older in-memory cache overwrote newer database records (last-write-wins data loss).
- **Root Cause:** Lack of optimistic concurrency control (`version` column assertion).
- **Fix:** Add `version INT NOT NULL DEFAULT 1` to `antinuke_settings`. Updates must assert `.eq('version', currentVersion)` and increment `version + 1`. If version check fails, invalidate cache, reload fresh DB record, and retry.

---

## 4. Snapshot Storms & Unbounded DB Load
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/modules/antinuke/restore.js:44-52` used a 1-second debounce per channel with no payload content hashing.
  - Any minor channel update (topic, bitrate, permission overwrite) triggered a full database write.
  - Startup `saveAllChannelSnapshots` executed dozens of sequential queries per guild.
- **Root Cause:** Snapshots were saved without change detection (content hashing) or batching.
- **Fix:** Compute MD5/SHA-256 `content_hash` of channel configuration; write snapshots ONLY when the hash changes. Completely eliminate startup snapshot loops.

---

## 5. Audit Log Lookups Racing Delete Events
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/modules/antinuke/restore.js:63-80` queried the last 5 audit logs with only 2 retries (600ms delay).
  - Discord Gateway audit log creation often lags by 800ms–2500ms under high load.
  - If the log was delayed, `entry` was undefined; if another user deleted a channel earlier, it matched the wrong executor.
- **Root Cause:** Insufficient retry window and absence of timestamp/target ID validation.
- **Fix:** Implement exponential backoff retry (up to 3 retries, 400ms/800ms/1200ms) and verify `entry.targetId === channelId` and `Date.now() - entry.createdTimestamp < 15000`.

---

## 6. Ephemeral In-Memory Sliding Windows Lost on Restart
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/modules/antinuke/restore.js:25`: `deletionSlidingWindows = new Map()`.
  - `src/modules/antinuke/lockdown.js:30`: `raidWindows = new Map()`.
  - When Pterodactyl restarted the container or Node.js reloaded, all deletion counts and raid metrics were reset to 0.
- **Root Cause:** Sliding-window counters resided purely in Node.js heap memory without persistence or recovery.
- **Fix:** Persist action records to `antinuke_actions` table, and rebuild active sliding-window counters from database records on reboot.

---

## 7. Concurrency Races, Restore Order & Incomplete ID Remapping
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `restoreGuildLocks = new Set()` in `restore.js:28` was in-memory only.
  - Channels were restored in arbitrary iteration order (`guild.channels.cache.values()`). Category channels were often restored AFTER child text channels, causing child channels to lose their category pairing.
  - `src/modules/antinuke/remap.js` only remapped 4 tables (`guild_settings`, `ticket_settings`, `automod_settings`, `ticket_panels`), ignoring shop product channel IDs, sticky notes, and completely omitting role remapping.
- **Root Cause:** Restore lacked category-first topological ordering and central multi-table remapping.
- **Fix:** Sort restore queue category-first (Type 4 `GuildCategory` first, then child channels). Centralize all remapping in a single `remapIds(guildId, { channels: Map, roles: Map })` covering all 22 modules.

---

## 8. Silent Punishment Failures
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - In `punishOffender` (`restore.js:98-115`), `guild.bans.create()` or `member.kick()` caught errors and logged a warning without retrying or notifying server owners.
  - Role hierarchy issues (bot role lower than offender's role) caused punishments to silently fail while channels were deleted.
- **Root Cause:** Missing punishment retry logic and absence of emergency owner notification card.
- **Fix:** Retry punishment once; if role hierarchy blocks a ban/kick, strip all roles beneath the bot's highest role, record failure state, and deliver an emergency Components V2 card to the alert/log channel.

---

## 9. Incomplete Lockdown Overwrites Resulting in Perm Mute
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `src/modules/antinuke/lockdown.js:286-292` only recorded `savedOverwrites[ch.id]` if `everyoneOv` was already present.
  - Channels with default permissions had no entry in `savedOverwrites`.
  - During unlock (`terminateLockdown`), the loop only iterated over keys in `savedOverwrites`. The lockdown deny override was never deleted from channels that originally had default permissions.
- **Root Cause:** Tracking only existing overwrites instead of tracking all `locked_channels`.
- **Fix:** Store both `locked_channels: string[]` and `saved_overwrites: Record<string, object>` in `lockdown_state`. On unlock, loop over every channel in `locked_channels`; if it had no prior overwrite, explicitly delete the `@everyone` overwrite.

---

## 10. Desynchronization of Trusted Users & Extra Owners
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - `antinuke_settings.extra_owners` stored array of snowflakes.
  - `antinuke_trusted` also stored `target_type: 'extra_owner'`.
  - Editing via panel updated one table but not the other, leading to inconsistent immunity evaluations.
- **Root Cause:** Denormalized duplicate storage of extra owners across two distinct tables.
- **Fix:** Unify trusted entity storage into `antinuke_trusted` with clear `target_type` ('user', 'role', 'extra_owner') and synchronize with `antinuke_settings`.

---

## 11. Listener Leaks and Second Bot Instance
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - In initial Phase 1 scan, `guildMemberAdd` had 3 independent listeners.
  - Lack of instance heartbeat detection allowed two instances to run concurrently on the same token.
- **Root Cause:** Fragmented event registrations across submodules and absence of process mutex.
- **Fix:** Resolved in Phase 3 & 4 via `instanceManager` and centralized modular routing.

---

## 12. Supabase Migration Schema Mismatch
- **Status:** **CONFIRMED (YES)**
- **Evidence:**
  - Code queried columns (`alert_channel_id`, `lockdown_punishment`, `ping_role_id`) that were absent from older Supabase base migrations.
- **Root Cause:** Database migrations were not version-controlled alongside code changes.
- **Fix:** Provide clean, self-contained SQL migration `supabase/migrations/20261024_antinuke_v2.sql` containing all required tables, constraints, RPC functions, and automated data copy script.

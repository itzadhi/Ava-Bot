---
name: ava-antinuke-debug
description: Debugging guide for Antinuke data integrity, snapshot debouncing, audit log timing races, and dry-run incident simulation.
---

# AVA Antinuke Debugging & Integrity Guide

## 1. Antinuke Architecture & Data Model
Antinuke protects servers from unauthorized mass channel/role deletions, bot additions, webhook creation, and raids.
Tables:
- `antinuke_settings`: Guild config (enabled, dry_run, thresholds jsonb, punishment, log_channel_id, alert_channel_id, extra_owners, version).
- `antinuke_snapshots`: Content-hashed records of channels and roles for restoration.
- `antinuke_trusted`: Whitelisted users, roles, and extra owners.
- `antinuke_exempt`: Channels and categories excluded from protection.
- `antinuke_actions`: Immutable audit log of executed punishments and restores.
- `lockdown_state`: Saved channel overwrites during active server lockdown.

## 2. Common Antinuke Bugs & Root Causes

### 2.1 Stale Cache & Overwrite Races
- **Symptom:** Antinuke settings mysteriously revert to default after an interaction or restart.
- **Root Cause:** A handler reads from stale in-memory cache, merges changes, and issues a blind upsert without version comparison.
- **Fix:** Optimistic concurrency control. Every write checks `WHERE version = current_version` and increments `version = version + 1`.

### 2.2 Audit Log Delay Race
- **Symptom:** Channel deleted by untrusted user, but executor is logged as `null` or ignored.
- **Root Cause:** Discord audit log entries take 200ms–800ms to propagate. If fetched synchronously, the log is empty.
- **Fix:** Exponential retry loop (3 attempts, 300ms backoff) matching `targetId === channel.id` and checking `createdAt >= Date.now() - 5000`.

### 2.3 Permanent Lockdown Perm Mute
- **Symptom:** Server unlocks, but regular members still cannot send messages in some channels.
- **Root Cause:** Only channels with pre-existing explicit `@everyone` overwrites were restored; channels that previously inherited default permissions retained `SendMessages: false`.
- **Fix:** `lockdown_state` must track `locked_channels` array. On unlock, delete the `@everyone` overwrite if no prior overwrite existed.

### 2.4 Missing ID Remapping
- **Symptom:** Restored channels break shop, ticket, or logging channels.
- **Root Cause:** Recreated channels have new snowflake IDs. Other modules still reference the old IDs.
- **Fix:** Universal `remapIds(guildId, { channels: Map, roles: Map })` updates all module settings atomically.

## 3. Running Antinuke Integrity Repair
To validate and repair schema or corrupted settings:
```javascript
import { repairAntiNukeState } from '../modules/antinuke/repair.js';

const result = await repairAntiNukeState(guildId);
// Returns: { repaired: boolean, fixedKeys: string[], errors: [] }
```

## 4. Running the Dry-Run Incident Simulation
Set `ENABLE_SIMULATION=true` in environment:
```bash
ENABLE_SIMULATION=true node tests/antinuke.test.js
```
The test simulates:
1. Untrusted user rapidly deleting 3 channels within 5 seconds.
2. Verify audit log retry correctly identifies executor.
3. Verify offender punishment is triggered (dry-run logs action).
4. Verify channels are restored in order: Categories first, then child channels.
5. Verify ID remapping updates all dependent module tables.
6. Verify exempt channels (tickets/shop) are untouched.

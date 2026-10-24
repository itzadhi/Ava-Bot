# AVA Overhaul Progress Tracker

## Current Phase
- **Phase 8: Antinuke Rebuild & Verification**

## Status by Phase
- [x] **Step 0: Git Setup** (Committed pre-overhaul checkpoint `d9f71f1`, switched to branch `ava-overhaul`, verified `.gitignore`)
- [x] **Phase 1: Full Scan & Diagnostics** (COMPLETED: `docs/SCAN_REPORT.md` and `docs/REMOVAL_CANDIDATES.md` generated with real evidence)
- [x] **Phase 2: Antigravity Skills + Rules + Workflows + Lessons Loop** (COMPLETED: 5 skills, 1 rule, 3 workflows, `docs/LESSONS.md`, and `npm run lessons:check` passing)
- [x] **Phase 3: Pterodactyl Readiness & Performance** (COMPLETED: zero-compilation prebuilt setup, `engines: >=20.0.0`, cgroup memory monitor with 80/90% thresholds, bounded 20MB log rotation, crash loop backoff, optional HTTP health endpoint, `/ava status` command, `tests/pterodactyl.test.js` passing 7/7)
- [x] **Phase 4: Brand = AVA + Terminal Style + Universal Logger** (COMPLETED: `/config/brand.js`, soft-pink terminal theme, 4 startup banners + ASCII fallback, universal child logger with secret redaction and pink gutter, strict `scripts/check-brand.js` passing with 0 violations across `src/`, wired into `npm run doctor`)
- [x] **Phase 5: Modular Plugin Architecture & Dead Code Removal** (COMPLETED: standard module contract in `src/core/modules/contract.js`, Zod settings validation with safe defaults in `settings.js`, fault-isolated loader in `loader.js`, `/ava modules` command, 22 feature module manifests created, `npm run new:module <name>` generator, dead root stubs and deprecated collector wrappers removed, `docs/ARCHITECTURE.md` written)
- [x] **Phase 6: Canvas & Banner Failure Handling Rewrite** (COMPLETED: safe worker pool with concurrency queue and 4s timeout, preflight verification on startup, disk cache with 10MB cap and LRU memory cache, SVG/pure text fallback, zero user-facing canvas errors, calm 1-line manager note with Error ID, bundled AVA pink theme, 6/6 tests passing)
- [x] **Phase 7: Auto Command Deployment & Guild Lifecycle** (COMPLETED: hash-based command comparison, auto-deploy with 429 backoff, stale command pruning, per-guild initialization reconciliation, prefix command parity, 6/6 tests passing)
- [ ] **Phase 8: Antinuke Rebuild & Verification** (NEXT: root causes evidence report, SQL migration file with optimistic locking, debounced snapshots, automated execution pipeline, central ID remapping, lockdown overhaul, dropdown wizard panel, /antinuke test and repair)
- [ ] **Phase 9: Final Verification, Documentation & Final Report**

## What Is Done
- Phases 1 through 6 completed and committed.
- Phase 7 Auto Command Deployment & Guild Lifecycle completed:
  - Built `src/core/commands/autoDeploy.js` featuring deterministic SHA-256 hash calculation, Discord slash command validation (1-32 name regex, 1-100 desc length, max 25 options limit), and dual-tier hash storage (local `cache/.command_hash.json` + Supabase `bot_state`).
  - Implemented smart deployment skip (`✿ Commands up to date (cached, no changes)`), automatic stale command pruning, Discord 429 rate limit backoff handler, and a 5-second non-blocking timeout guard.
  - Built `src/core/guilds/reconcile.js` providing startup settings reconciliation via bulk insert-if-missing (never overwriting existing records), batch cache warming, `guildCreate` initialization, and `guildDelete` departure tracking.
  - Eliminated startup channel snapshot storms and blind upserts across guilds.
  - Verified prefix commands share identical registry and handler logic with case-insensitivity and alias support.
  - Created automated test suite `tests/autodeploy.test.js` (6/6 passing).

## What Is Next
- Phase 8: Antinuke Rebuild & Verification
  - Investigate all 12 failure paths and output `docs/ANTINUKE_ROOT_CAUSES.md` with evidence.
  - Author Supabase SQL migration `supabase/migrations/20261024_antinuke_v2.sql` with versioned optimistic locking, action log, and data copy script (do not run automatically).
  - Rebuild `src/modules/antinuke/`: Zod settings schema, optimistic concurrency, debounced content-hashed snapshots, audit log lookup with retry, automated execution pipeline with punishment + restore + `remapIds()` across all modules.
  - Rebuild lockdown engine: exact overwrite tracking + `locked_channels`, auto-unlock with clean override deletion.
  - Rebuild panel as Components V2 dropdown wizard (owner/extra-owners only).
  - Add `/antinuke test` (simulation) and `/antinuke repair` commands.
  - Run full antinuke automated test suite.




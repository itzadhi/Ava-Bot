# AVA Overhaul Progress Tracker

## Current Phase
- **Phase 7: Auto Command Deployment ("autoexecute") & Guild Lifecycle**

## Status by Phase
- [x] **Step 0: Git Setup** (Committed pre-overhaul checkpoint `d9f71f1`, switched to branch `ava-overhaul`, verified `.gitignore`)
- [x] **Phase 1: Full Scan & Diagnostics** (COMPLETED: `docs/SCAN_REPORT.md` and `docs/REMOVAL_CANDIDATES.md` generated with real evidence)
- [x] **Phase 2: Antigravity Skills + Rules + Workflows + Lessons Loop** (COMPLETED: 5 skills, 1 rule, 3 workflows, `docs/LESSONS.md`, and `npm run lessons:check` passing)
- [x] **Phase 3: Pterodactyl Readiness & Performance** (COMPLETED: zero-compilation prebuilt setup, `engines: >=20.0.0`, cgroup memory monitor with 80/90% thresholds, bounded 20MB log rotation, crash loop backoff, optional HTTP health endpoint, `/ava status` command, `tests/pterodactyl.test.js` passing 7/7)
- [x] **Phase 4: Brand = AVA + Terminal Style + Universal Logger** (COMPLETED: `/config/brand.js`, soft-pink terminal theme, 4 startup banners + ASCII fallback, universal child logger with secret redaction and pink gutter, strict `scripts/check-brand.js` passing with 0 violations across `src/`, wired into `npm run doctor`)
- [x] **Phase 5: Modular Plugin Architecture & Dead Code Removal** (COMPLETED: standard module contract in `src/core/modules/contract.js`, Zod settings validation with safe defaults in `settings.js`, fault-isolated loader in `loader.js`, `/ava modules` command, 22 feature module manifests created, `npm run new:module <name>` generator, dead root stubs and deprecated collector wrappers removed, `docs/ARCHITECTURE.md` written)
- [x] **Phase 6: Canvas & Banner Failure Handling Rewrite** (COMPLETED: safe worker pool with concurrency queue and 4s timeout, preflight verification on startup, disk cache with 10MB cap and LRU memory cache, SVG/pure text fallback, zero user-facing canvas errors, calm 1-line manager note with Error ID, bundled AVA pink theme, 6/6 tests passing)
- [ ] **Phase 7: Auto Command Deployment & Guild Lifecycle** (NEXT: hash-based command comparison, auto-deploy with 429 backoff, stale command pruning, per-guild initialization reconciliation, prefix command parity)
- [ ] **Phase 8: Antinuke Rebuild & Verification**
- [ ] **Phase 9: Final Verification, Documentation & Final Report**

## What Is Done
- Phases 1 through 5 completed and committed.
- Phase 6 Canvas & Banner Failure Handling Rewrite completed:
  - Built `src/core/canvas/safeBanner.js` with worker pool, concurrency queue, 4-second render timeout, and worker restart on hang.
  - Implemented multi-tier caching: content hash (MD5 of product state, theme, compact) LRU in-memory cache plus capped disk cache (`cache/banners/`).
  - Implemented safe Discord CDN asset fetch with 5-second timeout and 5MB size limit; strictly rejects untrusted hosts.
  - Built graceful SVG fallback rendering with product details and zero canvas dependency when graphics engine is offline or times out.
  - Added calm 1-line manager note with unique Error ID (`Banner used the simple style this time (Ref: ERR-XXXXXX)`), completely eliminating user-facing technical error messages.
  - Added `ava` soft-pink aesthetic theme to `src/modules/shop/render/themes.js`.
  - Added startup preflight graphics engine verification in `src/index.js:init()`.
  - Created automated test suite `tests/canvas_safe.test.js` (6/6 passing).

## What Is Next
- Phase 7: Auto Command Deployment ("autoexecute") & Guild Lifecycle
  - Build `src/core/commands/autoDeploy.js` with SHA-256 hash comparison against stored hash.
  - Deploy commands only when changes occur; skip deploy when unchanged (`Commands up to date`).
  - Background retry with exponential backoff on Discord 429 rate limits.
  - Auto-prune stale / removed commands.
  - Validate command definitions before deployment with per-module error isolation.
  - Build `src/core/guilds/reconcile.js` for safe insert-if-missing per-guild initialization on startup and `guildCreate`.
  - Prefix command compatibility test.



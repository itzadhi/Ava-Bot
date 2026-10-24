# AVA Overhaul Progress Tracker

## Current Phase
- **Phase 4: Brand = AVA + Terminal Style + Universal Logger**

## Status by Phase
- [x] **Step 0: Git Setup** (Committed pre-overhaul checkpoint `d9f71f1`, switched to branch `ava-overhaul`, verified `.gitignore`)
- [x] **Phase 1: Full Scan & Diagnostics** (COMPLETED: `docs/SCAN_REPORT.md` and `docs/REMOVAL_CANDIDATES.md` generated with real evidence)
- [x] **Phase 2: Antigravity Skills + Rules + Workflows + Lessons Loop** (COMPLETED: 5 skills, 1 rule, 3 workflows, `docs/LESSONS.md`, and `npm run lessons:check` passing)
- [x] **Phase 3: Pterodactyl Readiness & Performance** (COMPLETED: zero-compilation prebuilt setup, `engines: >=20.0.0`, cgroup memory monitor with 80/90% thresholds, bounded 20MB log rotation, crash loop backoff, optional HTTP health endpoint, `/ava status` command, `tests/pterodactyl.test.js` passing 7/7)
- [ ] **Phase 4: Brand = AVA + Terminal Style + Universal Logger** (IN PROGRESS: `/config/brand.js`, soft-pink terminal theme, log format, universal child logger)
- [ ] **Phase 5: Modular Plugin Architecture & Dead Code Removal**
- [ ] **Phase 6: Canvas & Banner Failure Handling Rewrite**
- [ ] **Phase 7: Auto Command Deployment & Guild Lifecycle**
- [ ] **Phase 8: Antinuke Rebuild & Verification**
- [ ] **Phase 9: Final Verification, Documentation & Final Report**

## What Is Done
- Phase 1 & Phase 2 completed and committed.
- Phase 3 Pterodactyl readiness completed:
  - Removed node-canvas (`canvas`) from dependencies; prebuilt `@napi-rs/canvas` preserved.
  - Specified `"engines": { "node": ">=20.0.0" }` in `package.json`.
  - Implemented `src/core/pterodactyl/env.js` (validates Node version and env vars without leaking secrets).
  - Implemented `src/core/pterodactyl/memory.js` (inspects cgroup v1/v2 and MEMORY env, warns at 80%, trims cache at 90%).
  - Implemented `src/core/pterodactyl/crashGuard.js` (detects rapid crash loops, enforces exponential backoff, writes `logs/last-crash.json`).
  - Implemented `src/core/pterodactyl/storage.js` (daily log rotation with 20MB / 3 days retention caps).
  - Implemented `src/core/pterodactyl/healthServer.js` (optional HTTP health probe on `SERVER_PORT`).
  - Added `/ava status` command in `src/commands/owner/ava.js` (owner-only, Components V2, grey refresh button).
  - Resolved shop setup wizard test bug and fixed ESLint errors in shop/index.js.
  - Added and passed `tests/pterodactyl.test.js` (7/7 pass) and `scripts/test-pterodactyl.js` (100% pass).

## What Is Next
- Phase 4: Brand = AVA + Terminal Style
  - Create `/config/brand.js` (name: 'AVA', tagline, version, colors, footer, emoji set).
  - Build pink terminal palette (soft pink #FFB7D5, lavender #C9B6FF, mint #A8F0D1, peach #FFD3B0, sky #A9D8FF, warning butter #FFE9A8, error rose #FF7C98).
  - Build custom stylized multi-line AVA startup banner with block/slim/aesthetic/kawaii styles.
  - Build unified `/core/logger` with levels, child loggers, token redaction, and pink gutter styling.
  - Run brand check script (`scripts/check-brand.js`) to verify zero hardcoded old names.


## Known Problems & Focus Areas
- Antinuke data corruption and configuration overwrites.
- Canvas render failures showing technical errors to users.
- Old naming "Argoni" hardcoded in multiple locations.
- Mixed console logging and lack of unified Pterodactyl-compatible logger.
- Interaction handling timeouts / ack timing hazards.

---
description: Release readiness checklist before deploying to Pterodactyl panel or merging.
---

# /ava-release-check Workflow

Pre-deployment verification checklist:

1. **Doctor Suite Passes Cleanly:**
   ```bash
   npm run doctor
   ```
2. **Zero Banned Patterns & Brand Check Passes:**
   ```bash
   npm run lessons:check
   node scripts/check-brand.js
   ```
3. **Pterodactyl Deployment Dry Run:**
   - Verify `package.json` contains no `canvas` (only prebuilt `@napi-rs/canvas`).
   - Verify `engines` field is specified (`>=20.0.0`).
   - Run simulation:
     ```bash
     node scripts/test-pterodactyl.js
     ```
4. **All Tests Pass:**
   ```bash
   npm test
   ```
5. **Git & Progress State Clean:**
   - `PROGRESS.md` is updated.
   - Working tree is clean.
   - SQL migrations documented in `supabase/migrations/` for manual execution.

# Removal Candidates (Phase 1 Audit)

The following files, dependencies, and code assets have been identified as potential dead code or unnecessary bloat during the Phase 1 full system audit. Per the mission rules, candidates marked as **Uncertain** will be preserved until explicitly confirmed by the project owner.

---

## 1. Unused / High-Risk Dependencies

| Package | Status | Size / Hazard | Evidence | Recommended Action |
| :--- | :--- | :--- | :--- | :--- |
| `canvas` (`^3.2.3`) | Redundant / Build Hazard | ~15 MB compiled | Requires `node-gyp`, Cairo, Pango, C++ build chain on Linux. Fails on Pterodactyl without compiler. Code prefers `@napi-rs/canvas` (prebuilt). Only dynamic fallback in `src/modules/shop/render/canvasAdapter.js:18`. | Remove from `dependencies`. Rely on `@napi-rs/canvas` with graceful pure text/SVG fallback. |
| `libsodium-wrappers` (`^0.8.4`) | Unused | Flagged by `depcheck` | Zero static imports across `src/`. Flagged as unused dependency by `depcheck`. | Verify if required by `@discordjs/voice` encryption or remove. |
| `opusscript` (`^0.0.8`) | Unused | Flagged by `depcheck` | Outdated (0.0.8 vs 0.1.1). Flagged as unused by `depcheck`. | Mark for removal if native audio encoding is handled by FFmpeg. |
| `google-tts-api` (`^2.0.2`) | Vulnerable | 2 High CVEs | Pulls `axios <=0.32.0` (SSRF, Prototype Pollution, Header Injection, CSRF). | Migrate TTS provider to native `fetch` against Google TTS endpoint or sanitize. |
| `pino-pretty` (`^13.2.0`) | Overhead | In dev/runtime | Depcheck flagged; custom pink terminal logger will supersede it. | Safe to remove once custom AVA terminal logger is installed. |

---

## 2. Redundant / Dead Root Files & Stubs

| File / Folder | Status | Evidence | Recommended Action |
| :--- | :--- | :--- | :--- |
| `config/theme.js` (root) | Broken / Dead | 3 lines. Imports `./src/config/theme.js` which does not exist (`src/ui/theme.js` is the actual location). | Remove dead stub. |
| `utils/ui/format.js` (root) | Redundant Stub | 2 lines. Stub re-exporting `src/utils/ui/format.js`. | Verify zero external callers; remove. |
| `utils/ui/index.js` (root) | Redundant Stub | 2 lines. Stub re-exporting `src/utils/ui/index.js`. | Verify zero external callers; remove. |
| `temp/Feedback-Bot-main` | Clone Archive | 57.9 KB. Old reference repository in `temp/`. | Keep in `.gitignore` or delete after verification. |
| `temp/Suggestions-Bot-main` | Clone Archive | 77.4 KB. Old reference repository in `temp/`. | Keep in `.gitignore` or delete after verification. |
| `_reference/opentui` | Reference Clone | 76.3 MB! Requires Bun and real interactive TTY. Incompatible with Pterodactyl panel headless container. | Excluded by `.gitignore`. Do not ship in container build. |
| `transcripts/1447230598295978198/*.html` | Static Test Fixtures | 29.1 KB across 7 HTML files. | Move to `tests/fixtures/` or keep in `transcripts/` ignored by git. |
| `scripts/push_permission_update.js` | One-off scratch script | 1.8 KB. Used once during permify rollout. | Move to scratch or archive. |
| `scripts/verify-tables.js` | Redundant | 1.1 KB. Superseded by `doctor.js` schema parity checks. | Merge checks into doctor. |

---

## 3. Dead / Banned Code Patterns

| Location | Issue | Evidence | Proposed Fix |
| :--- | :--- | :--- | :--- |
| `src/utils/embed.js` (`componentsToEmbed`) | Embed conversion in V2 environment | Lines 120-200. Converts components to embeds. Global Rule 1 bans embeds. | Remove `componentsToEmbed`. Retain webhook replay sanitizers only if needed for chatlog export. |
| `src/structures/CommandContext.js:201-225` | Leftover collector stub | Comment explicitly marked `@deprecated Collectors are eliminated in favor of persistent session handlers`. | Remove dead collector wrapper stub. |
| `src/modules/shop/index.js:620-628` | Undefined Select Menu builders | `StringSelectMenuBuilder` and `StringSelectMenuOptionBuilder` used without import. ESLint 7 errors. | Fix imports and migrate to standardized component builders. |

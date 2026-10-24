---
description: Always-on project rules for AVA Discord bot development
---

# Always-On AVA Development Rules

1. **Components V2 ONLY (`MessageFlags.IsComponentsV2`):**
   - Zero embeds (`EmbedBuilder` is strictly banned).
   - No `content` text with V2 components.
   - Never use `setColor()` or `setAccentColor()`.

2. **Every Button is Grey:**
   - Always use `greyButton()` helper (`ButtonStyle.Secondary` or `ButtonStyle.Link`).
   - Never use `Primary`, `Success`, or `Danger` styles.
   - Use dropdowns (select menus) for choices; buttons are for Back / Next / Cancel / Confirm.

3. **Zero Technical Jargon in User Copy:**
   - Users never see: "Components V2", "Supabase", "Postgres", "atomic", "cache", stack traces, or canvas error strings.
   - All user copy lives in `/config/copy.js`.
   - Errors show a polite 1-line explanation + Error ID.

4. **Acknowledge First (<500ms):**
   - Every handler runs through `runHandler` / `safeRespond`.
   - Never execute database queries, heavy computations, or canvas rendering before initial acknowledgement.
   - Modal-opening buttons are cache-only (no deferral before `showModal()`).

5. **Work in Small Steps with Proof:**
   - Always read the full file before editing.
   - Keep new files under ~300 lines.
   - Never claim something works without running the command and showing output.
   - Keep `PROGRESS.md` and `docs/LESSONS.md` updated.
   - Brand name always comes from `/config/brand.js`. No hardcoded "Argoni" or old names.

---
name: ava-conventions
description: Project conventions, architecture, module contract, UI rules, and banned patterns for AVA Discord bot.
---

# AVA Project Conventions & Architecture Guide

## 1. Project Architecture & Folder Layout
```
/src
  /config         # Brand configuration, constants, centralized copy
    brand.js      # Single source of truth for name ('AVA'), colors, badges
    copy.js       # Centralized user-facing strings (NO tech jargon)
  /core           # Engine infrastructure
    /client       # AVA Client instantiation & lifecycle management
    /interactions # runHandler, safeRespond, ownership, session store
    /logger       # Pink-themed ANSI logger with NDJSON file rotation
    /cache        # Write-through guild settings cache, LRU caches
    /db           # Supabase client, query retry, optimistic locks
    /queue        # Concurrency throttled queue (p-queue)
    /jobs         # Background schedulers, cron tasks
  /modules        # Plugin modules
    /<name>
      module.js   # Module definition contract
      commands/   # Slash & prefix command definitions
      components/ # Button, select menu, modal handlers
      events/     # Event listeners isolated to module
      db/         # Schema, queries, migrations
  /ui             # Components V2 builders, theme tokens, cards, greyButton
```

## 2. The Module Contract
Every module must export a manifest adhering to:
```javascript
export default {
  id: 'module_name',
  name: 'Module Display Name',
  version: '1.0.0',
  dependsOn: [],
  defaultEnabled: true,
  intents: [],
  commands: [],
  components: [],
  events: {},
  jobs: [],
  migrations: [],
  settingsSchema: null, // Zod schema
  healthCheck: async () => ({ healthy: true }),
  onLoad: async (client) => {},
  onUnload: async (client) => {}
};
```

## 3. Global UI Rules
1. **Components V2 ONLY (`MessageFlags.IsComponentsV2`):**
   - Zero embeds (`EmbedBuilder` is strictly banned).
   - No `content` text along with V2 components.
   - Never use `.setColor()` or `setAccentColor()`.
2. **Every Button is Grey:**
   - Use `greyButton()` helper exclusively (`ButtonStyle.Secondary`).
   - Link buttons use `ButtonStyle.Link`.
   - Never use `ButtonStyle.Primary`, `ButtonStyle.Success`, or `ButtonStyle.Danger`.
   - Wizard choices must use dropdowns (select menus). Buttons are reserved for Back / Next / Cancel / Confirm.
3. **No Technical Jargon in User Copy:**
   - Never show: "Components V2", "Supabase", "Postgres", "atomic", "cache", "stack trace", or canvas error strings.
   - All user copy lives in `/config/copy.js`.
   - Errors display a polite 1-line explanation + Error ID (`ERR-XXXX-XXXX`). Technical details go to logs.
4. **Ownership & Access:**
   - Always build custom IDs with `buildId({ module, action, guildId, ownerId, key })`.
   - Always parse with `parseId(customId)`.
   - Enforce ownership through `checkPanelAccess()`.

## 4. Banned Patterns Checklist
- [x] NO `console.log`, `console.error`, `console.warn` (use `logger`).
- [x] NO `EmbedBuilder` or `embeds: [...]`.
- [x] NO Primary / Success / Danger button styles.
- [x] NO Discord Collectors (`createMessageComponentCollector`).
- [x] NO database queries or heavy calculations before initial acknowledgement.
- [x] NO hardcoded names ("Argoni" or others) - always use `/config/brand.js`.

## 5. Definition of Done
1. Code passes `npm run doctor`.
2. `npx eslint src/ --quiet` reports 0 errors.
3. All unit & integration tests pass with `npm test`.
4. `PROGRESS.md` and `docs/LESSONS.md` updated.
5. Changes committed with descriptive commit message.

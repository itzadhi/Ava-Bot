# AVA System Architecture & Plugin Specification

AVA is built on an enterprise-grade, modular, plugin-based architecture designed for high availability, fault isolation, and seamless execution inside Pterodactyl container environments.

---

## 1. Directory Layout

```
/
├── .agents/                    # Antigravity Skills, Rules, and Workflows
├── config/
│   └── brand.js                # Single source of truth for AVA branding
├── docs/                       # Architectural docs, audit reports, and lessons learned
├── logs/                       # Rotating NDJSON structured log files (20MB / 3-day cap)
├── scripts/                    # CLI tooling (doctor, lessons, module generator)
├── src/
│   ├── config.js               # Global runtime credentials and environment parsing
│   ├── index.js                # AvaClient bootstrap and lifecycle entry point
│   ├── shard.js                # Sharding manager for Discord Gateway clustering
│   ├── commands/               # Slash and prefix command definitions
│   ├── core/                   # Framework primitives and infrastructure
│   │   ├── cache/              # Write-through in-memory caches and batch writers
│   │   ├── interactions/       # Ack-first routers, session stores, ownership checks
│   │   ├── logger/             # Universal logger with soft-pink ANSI theme and file sink
│   │   ├── modules/            # Plugin loader, contract schema, settings validation
│   │   └── pterodactyl/        # Memory monitoring, crash loop guard, log rotation
│   ├── db/                     # Supabase data adapters and query retry wrappers
│   ├── modules/                # Self-contained feature modules (plugins)
│   │   ├── antinuke/           # Disaster recovery & raid defense
│   │   ├── automod/            # Multi-layer content filters & anti-spam
│   │   ├── autorole/           # Automated join role assignment
│   │   ├── backup/             # Cross-server snapshot & restore
│   │   ├── boosts/             # Nitro boost celebrations & auto-roles
│   │   ├── chatlog/            # Encrypted channel export & replay
│   │   ├── feedback/           # Community feedback & star reviews
│   │   ├── help/               # Command explorer and user manual
│   │   ├── logs/               # Server audit & moderation logging
│   │   ├── owner/              # Owner administrative dashboard & broadcasts
│   │   ├── panel/              # Dynamic server action panels & central dashboard
│   │   ├── permify/            # Server permission synchronization & auto-repair
│   │   ├── settings/           # Server configuration & one-tap toggles
│   │   ├── shop/               # Automated digital storefront & order fulfillment
│   │   ├── staff/              # Staff moderation queues & quick actions
│   │   ├── starter/            # Reference module demonstrating Components V2
│   │   ├── sticky/             # Channel bottom-pinned sticky notes
│   │   ├── stickyroles/        # Persistent role re-assignment upon rejoin
│   │   ├── suggestions/        # Community suggestions & voting pipeline
│   │   ├── sync/               # Multi-server message & role replication
│   │   ├── tickets/            # Enterprise support tickets & transcript generator
│   │   └── voice/              # Join-to-Create voice rooms & Google TTS
│   ├── services/               # Background task queues and interval schedulers
│   ├── structures/             # Command, Component, and Module registry definitions
│   └── ui/                     # Components V2 cards, builders, themes, and tokens
├── supabase/
│   └── migrations/             # Idempotent SQL migration files
└── tests/                      # Automated Node.js test suites
```

---

## 2. Standard Module Contract

Every feature in `/src/modules/<name>/module.js` exports a manifest complying with `ModuleManifestSchema` (`src/core/modules/contract.js`):

```javascript
import { z } from 'zod';

export const moduleManifest = {
  // Unique lowercase identifier (alphanumeric, hyphens, underscores)
  id: 'polls',

  // Human-readable display name
  name: 'Community Polls',

  // Semantic version
  version: '1.0.0',

  // Short feature description
  description: 'Interactive single and multiple-choice polling system',

  // Array of module IDs this module requires to run first
  dependsOn: [],

  // Default activation state (can be overridden by config or environment)
  defaultEnabled: true,

  // Required privileged or optional Discord gateway intents
  intents: [],

  // Slash and prefix command definitions
  commands: [],

  // Interactive component handlers matching customId pattern
  components: [
    {
      customId: 'polls:*',
      type: 'button',
      async execute(interaction, args) {
        // Ack-first component handling
      }
    }
  ],

  // Discord Gateway event listeners { [eventName]: handlerFunction }
  events: {},

  // Scheduled recurring background cron jobs
  jobs: [
    {
      name: 'poll-auto-close',
      expression: '*/5 * * * *',
      run: async (client) => {
        // Periodic check
      }
    }
  ],

  // Database migration filenames required by this module
  migrations: [],

  // Zod settings schema for runtime validation with safe fallbacks
  settingsSchema: z.object({
    enabled: z.boolean().default(true),
    maxOptions: z.number().default(10)
  }),

  // Safe fallback defaults used if database data is corrupted or missing
  defaultSettings: {
    enabled: true,
    maxOptions: 10
  },

  // User-facing copy dictionary
  copy: {
    voted: 'Your vote has been recorded.'
  },

  // Health check hook called by /ava modules and telemetry
  async healthCheck(client) {
    return { healthy: true, details: 'Polls database operational' };
  },

  // Lifecycle initialization hook
  async onLoad({ client, logger, manifest }) {
    logger.debug('Polls module initialized.');
  },

  // Lifecycle teardown hook (e.g. on hot-reload or disable)
  async onUnload({ client, logger, manifest }) {
    logger.debug('Polls module unloaded.');
  }
};

export default moduleManifest;
```

---

## 3. Fault Isolation & Dynamic Control

1. **Topological Dependency Ordering:** The plugin loader resolves the dependency graph between modules and initializes them in correct sequence.
2. **Failure Containment:** If a module throws an unhandled exception during `import` or inside `onLoad`, the loader marks only that module as `'failed'`, logs the error with details, and cleanly boots all remaining modules.
3. **Environment Toggles:**
   - Disable specific modules without code changes:
     ```env
     DISABLED_MODULES=tickets,shop
     ```
   - Whitelist only specific modules:
     ```env
     ENABLED_MODULES=antinuke,automod,logs
     ```
   - Target an individual module:
     ```env
     MODULE_ANTINUKE_ENABLED=true
     MODULE_SHOP_ENABLED=false
     ```
4. **Live Telemetry:** Owners can inspect module statuses and run health checks at any time via `/ava modules`.

---

## 4. Add a Feature in 10 Minutes (Developer Guide)

Follow this systematic workflow whenever adding a new feature to AVA:

### Step 1: Scaffold the Module
Run the automated scaffolding generator:
```bash
npm run new:module giveaways
```
This generates:
- `src/modules/giveaways/module.js` (Contract manifest)
- `src/modules/giveaways/index.js` (Component and job logic)
- `tests/module_giveaways.test.js` (Automated verification)

### Step 2: Implement Component Logic (`index.js`)
Use Components V2 builders and grey buttons strictly:
```javascript
import { safeRespond } from '../../core/interactions/safeRespond.js';
import { successCard } from '../../ui/cards.js';

export async function handleGiveawaysInteraction(interaction, [action, giveawayId]) {
  // Always acknowledge immediately
  await interaction.deferUpdate().catch(() => {});

  if (action === 'enter') {
    return safeRespond(interaction, successCard({
      title: 'Giveaway Entry',
      subtitle: 'Entry Confirmed',
      body: `You have successfully entered giveaway **#${giveawayId}**!`
    }), { ephemeral: true });
  }
}
```

### Step 3: Run the Module Test Suite
Run the unit test created by the generator:
```bash
node tests/module_giveaways.test.js
```

### Step 4: Verify with System Doctor
Ensure zero unresolved imports and clean compliance:
```bash
npm run doctor
```

Done! The new module is auto-discovered on startup, validated against the contract, and reported in `/ava modules`.

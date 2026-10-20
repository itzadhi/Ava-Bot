import { Client, GatewayIntentBits, MessageFlags } from 'discord.js';
import {
  successCard,
  errorCard,
  infoCard,
  warnCard,
  confirmCard,
  progressCard,
  listCard,
  detailCard,
  loadingCard,
  backupCard,
  metricCard,
  formCard,
  mediaGalleryCard,
  brandCard,
  homeCard,
  restoreConsoleCard
} from './cards.js';
import { config } from '../config.js';

async function runPreview() {
  console.log('--- Generating Discord Components V2 Previews ---');

  const previews = {
    restoreConsoleCard: restoreConsoleCard({
      stage: 'running',
      record: { name: 'Adhi Production Layout', id: 'XCGA-82F6' },
      targetGuildName: 'Adhithya Development',
      originGuildName: 'Adhi Development',
      doneSteps: 2,
      totalSteps: 5,
      currentPhaseText: 'Setting verified role hierarchy & permissions',
      checklist: [
        '✅ **Phase 1: Clean Slate Wipe** — Wiped 14 channels and 6 roles',
        '🔄 **Phase 2: Role Hierarchy & Permissions Engine** — Setting role hierarchy...',
        '⏳ **Phase 3: Category Architecture** — Pending',
        '⏳ **Phase 4: Channels & Overwrites** — Pending',
        '⏳ **Phase 5: Server Settings & Emojis** — Pending'
      ]
    }),
    homeCard: homeCard({
      title: 'Argoni Control Center',
      subtitle: 'Universal Server Snapshots • Live Guild Sync • Blueprint Hub'
    }),
    loadingCard: loadingCard({
      title: 'Backing Up Server',
      subtitle: 'Collecting roles, channels, and permissions...'
    }),
    successCard: successCard({
      title: 'Backup Created',
      subtitle: 'Snapshot has been encrypted and stored safely.',
      body: '> 🔑 **ID**: `A7K2-9QXM`\n> 📦 **Size**: `142 KB`\n> 📊 **Components**: `42 channels` • `18 roles`',
      tip: 'Run /backup load id:A7K2-9QXM on any server to deploy this layout.'
    }),
    errorCard: errorCard({
      title: 'Restore Incomplete',
      subtitle: 'Could not complete role hierarchy restoration.',
      reason: 'The bot role is positioned lower than the "Moderator" role in server settings.',
      fix: 'Move the "Argoni" role above other roles in Server Settings -> Roles.'
    }),
    infoCard: infoCard({
      title: 'About Argoni',
      subtitle: 'Modern Server Backup, Restore & Sync Platform',
      body: '> 🧩 **Engine**: Discord Components V2\n> 🔒 **Encryption**: AES-256-GCM at rest\n> 🌐 **Cross-Server**: Universal Server Cloning'
    }),
    backupCard: backupCard({
      title: 'Universal Server Snapshot',
      id: 'A7K2-9QXM',
      name: 'Production-Release',
      sizeFormatted: '142.5 KB',
      originGuildName: 'Main Community Hub',
      originGuildId: '123456789012345678',
      targetGuildName: 'Staging Server',
      isCrossServer: true,
      authorTag: '<@123456789012345678>',
      createdAt: '<t:1700000000:R>',
      locked: true,
      stats: { channels: 42, roles: 18, emojis: 12 }
    }),
    metricCard: metricCard({
      title: 'Telemetry Overview',
      subtitle: 'Real-time performance metrics',
      metrics: [
        { label: 'Gateway Ping', value: '38ms', detail: 'Optimal' },
        { label: 'Database Latency', value: '14ms', detail: 'Supabase' },
        { label: 'Memory RSS', value: '46 MB', detail: 'Node.js 20' }
      ]
    }),
    confirmCard: confirmCard({
      title: 'Confirm Universal Restore',
      subtitle: 'This will restore a snapshot from an external server.',
      details: '• **Origin Guild**: `Main Community Hub`\n• **Target Guild**: `Testing Server`\n• **Clean Mode**: `Additive`',
      confirmLabel: 'Deploy Cross-Server',
      cancelLabel: 'Cancel',
      danger: true
    }),
    progressCard: progressCard({
      title: 'Restoring Server Structure',
      step: 'Rebuilding Category Hierarchy',
      done: 28,
      total: 42
    }),
    listCard: listCard({
      title: 'Universal Backups',
      subtitle: 'Showing 5 most recent snapshots',
      items: [
        '**1. Release-Prep** (`A7K2-9QXM`) 🔒 `[Locked]`\n> 📦 `142 KB` • 🌐 Origin: `123456789` • Created <t:1700000000:R>',
        '**2. Daily-Auto** (`B9W1-4PLX`) 🤖 `[Auto]`\n> 📦 `138 KB` • 🏠 Local • Created <t:1699900000:R>'
      ],
      page: 1,
      totalPages: 3,
      customIdPrefix: 'bk_list'
    }),
    brandCard: brandCard({
      title: 'Argoni Discord Engine'
    })
  };

  for (const [name, payload] of Object.entries(previews)) {
    console.log(`\n=== Card: ${name} ===`);
    console.log(`Flags: ${payload.flags} (MessageFlags.IsComponentsV2: ${(payload.flags & MessageFlags.IsComponentsV2) !== 0})`);
    console.log(`Components: ${payload.components.length} Container(s)`);
    if (payload.files?.length) {
      console.log(`Attached Files: ${payload.files.map(f => f.name).join(', ')}`);
    }
    const json = payload.components[0].toJSON();
    console.log(`Borderless (no sidebar color): ${json.accent_color === undefined}`);
    console.log(`Child components: ${json.components?.length || 0}`);
  }
}

runPreview().catch(console.error);

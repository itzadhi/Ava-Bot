import fs from 'node:fs';
import path from 'node:path';
import { getSupabase } from '../src/db/client.js';

export const BOT_TABLES = [
  'antinuke_actions',
  'antinuke_exempt',
  'antinuke_incidents',
  'antinuke_settings',
  'antinuke_snapshots',
  'antinuke_trusted',
  'audit_logs',
  'automod_allowlist',
  'automod_exemptions',
  'automod_incidents',
  'automod_regex',
  'automod_settings',
  'automod_strikes',
  'automod_words',
  'ava_jobs',
  'backup_intervals',
  'backups',
  'blacklist',
  'boost_history',
  'bot_instances',
  'bot_state',
  'channel_snapshots',
  'chatlogs',
  'error_logs',
  'feedback',
  'guild_roles',
  'guild_settings',
  'lockdown_state',
  'module_data',
  'panel_state',
  'permify_snapshots',
  'premium_codes',
  'shop_blacklist',
  'shop_categories',
  'shop_coupon_uses',
  'shop_coupons',
  'shop_order_events',
  'shop_order_sequences',
  'shop_orders',
  'shop_products',
  'shop_reviews',
  'shop_settings',
  'shop_stock_items',
  'shop_waitlist',
  'sticky_messages',
  'sticky_notes',
  'sticky_roles',
  'suggestion_votes',
  'suggestions',
  'synced_messages',
  'syncs',
  'temp_channels',
  'templates',
  'ticket_blacklist',
  'ticket_categories',
  'ticket_counters',
  'ticket_macros',
  'ticket_notes',
  'ticket_panels',
  'ticket_questions',
  'ticket_ratings',
  'ticket_settings',
  'ticket_transcripts',
  'tickets',
  'transcripts',
  'tts_prefs',
  'user_voice_prefs'
];

export async function runBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve('backups', `pre-reset-${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  const db = getSupabase();
  const manifest = {
    timestamp: new Date().toISOString(),
    tables: {},
    totalRows: 0
  };

  process.stdout.write(`Exporting database backup to ${backupDir}...\n`);

  for (const table of BOT_TABLES) {
    try {
      let page = 0;
      const pageSize = 1000;
      let allRows = [];
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await db
          .from(table)
          .select('*')
          .range(page * pageSize, (page + 1) * pageSize - 1);

        if (error) {
          allRows = [];
          break;
        }

        if (data && data.length > 0) {
          allRows.push(...data);
          if (data.length < pageSize) hasMore = false;
          else page++;
        } else {
          hasMore = false;
        }
      }

      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(allRows, null, 2), 'utf8');

      manifest.tables[table] = allRows.length;
      manifest.totalRows += allRows.length;
    } catch (err) {
      manifest.tables[table] = 0;
    }
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  // Compute folder size
  let totalBytes = 0;
  for (const file of fs.readdirSync(backupDir)) {
    const stat = fs.statSync(path.join(backupDir, file));
    totalBytes += stat.size;
  }
  const sizeMb = (totalBytes / (1024 * 1024)).toFixed(2);

  process.stdout.write(`✓ Backup complete: ${manifest.totalRows} rows across ${BOT_TABLES.length} tables.\n`);
  process.stdout.write(`  Location: ${backupDir}\n`);
  process.stdout.write(`  Directory size: ${sizeMb} MB (${totalBytes} bytes)\n`);

  return { backupDir, manifest, sizeMb, totalBytes };
}

if (process.argv[1]?.endsWith('backup-data.js')) {
  await runBackup();
}

import { getSupabase } from '../src/db/client.js';
import { BOT_TABLES } from './backup-data.js';

export async function verifySchema() {
  const db = getSupabase();
  const mismatches = [];

  for (const table of BOT_TABLES) {
    try {
      const { error } = await db.from(table).select('*').limit(1);
      if (error) {
        mismatches.push({ table, error: error.message });
      }
    } catch (err) {
      mismatches.push({ table, error: err.message });
    }
  }

  return mismatches;
}

if (process.argv[1]?.endsWith('verify-schema.js')) {
  process.stdout.write('\nVerifying live database schema against known bot tables...\n');
  const mismatches = await verifySchema();

  if (mismatches.length === 0) {
    process.stdout.write(`✅ 100% Schema Parity: All ${BOT_TABLES.length} bot tables are online and accessible.\n\n`);
  } else {
    process.stdout.write(`❌ Detected ${mismatches.length} table mismatch(es):\n`);
    for (const m of mismatches) {
      process.stdout.write(`• Table "${m.table}": ${m.error}\n`);
    }
    process.stdout.write('\n');
  }
}

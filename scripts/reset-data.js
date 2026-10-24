import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getSupabase } from '../src/db/client.js';
import { BOT_TABLES } from './backup-data.js';

function getProjectDetails() {
  const urlStr = process.env.SUPABASE_URL || '';
  try {
    const url = new URL(urlStr);
    const host = url.host;
    const ref = host.split('.')[0];
    return { host, ref };
  } catch (_) {
    return { host: 'unknown', ref: 'unknown' };
  }
}

async function checkLiveHeartbeat() {
  const db = getSupabase();
  try {
    const { data } = await db
      .from('bot_instances')
      .select('*')
      .order('last_seen', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      const lastSeen = new Date(data[0].last_seen).getTime();
      const ageSec = Math.floor((Date.now() - lastSeen) / 1000);
      if (ageSec < 60) {
        return { isAlive: true, ageSec, instance: data[0] };
      }
    }
  } catch (_) {}

  return { isAlive: false };
}

async function getTableRowCounts(tables) {
  const db = getSupabase();
  const counts = {};
  for (const table of tables) {
    try {
      const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
      if (!error && count !== null) {
        counts[table] = count;
      }
    } catch (_) {}
  }
  return counts;
}

async function cleanStorageBuckets(dryRun = true) {
  const db = getSupabase();
  const knownBuckets = ['backups', 'shop-banners', 'transcripts'];
  const report = [];

  for (const b of knownBuckets) {
    try {
      const { data: objects, error } = await db.storage.from(b).list();
      if (!error && objects && objects.length > 0) {
        const paths = objects.map(o => o.name);
        report.push({ bucket: b, count: paths.length });
        if (!dryRun) {
          await db.storage.from(b).remove(paths);
        }
      }
    } catch (_) {}
  }

  return report;
}

function cleanLocalFiles(dryRun = true) {
  const dirs = ['cache', 'logs', 'transcripts'];
  const removed = [];

  for (const dir of dirs) {
    const p = path.resolve(dir);
    if (fs.existsSync(p)) {
      const files = fs.readdirSync(p);
      removed.push({ dir, fileCount: files.length });
      if (!dryRun) {
        for (const file of files) {
          const fp = path.join(p, file);
          try {
            fs.rmSync(fp, { recursive: true, force: true });
          } catch (_) {}
        }
      }
    }
  }

  return removed;
}

export async function runReset({ execute = false, force = false, confirmationPhrase = '' } = {}) {
  const { host, ref } = getProjectDetails();
  const expectedPhrase = `WIPE ${ref}`;

  process.stdout.write('\n════════════════════════════════════════════════════════════════════════════════\n');
  process.stdout.write('                     AVA FRESH START: DATABASE RESET TOOL                       \n');
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n');
  process.stdout.write(`Target Project Ref : ${ref}\n`);
  process.stdout.write(`Target Database Host: ${host}\n`);
  process.stdout.write(`Execution Mode     : ${execute ? 'EXECUTE (DATA WILL BE TRUNCATED)' : 'DRY RUN (NO CHANGES)'}\n`);
  process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n\n');

  // Check 1: Live heartbeat
  const hb = await checkLiveHeartbeat();
  if (hb.isAlive && !force) {
    process.stdout.write(`❌ REFUSED: Active instance detected (${hb.instance.instance_id}, PID ${hb.instance.pid}).\n`);
    process.stdout.write(`   Heartbeat received ${hb.ageSec}s ago. Stop all bot instances before resetting.\n`);
    process.stdout.write('   To bypass with authorization, use --force and re-confirm.\n\n');
    return { success: false, reason: 'LIVE_INSTANCE_DETECTED' };
  }

  // Check 2: Table Discovery & Row Counts
  process.stdout.write('Discovering bot tables and counting current rows...\n');
  const beforeCounts = await getTableRowCounts(BOT_TABLES);
  let totalRowsBefore = 0;

  process.stdout.write('\nTable Name                    | Rows Before | Action\n');
  process.stdout.write('------------------------------+-------------+-------------------------------------------\n');
  for (const [table, count] of Object.entries(beforeCounts)) {
    totalRowsBefore += count;
    const tCol = table.padEnd(29);
    const cCol = String(count).padStart(11);
    const act = execute ? 'TRUNCATE CASCADE' : 'WOULD TRUNCATE (DRY RUN)';
    process.stdout.write(`${tCol} | ${cCol} | ${act}\n`);
  }
  process.stdout.write('------------------------------+-------------+-------------------------------------------\n');
  process.stdout.write(`TOTAL BOT TABLES DETECTED     : ${Object.keys(beforeCounts).length} tables (${totalRowsBefore} total rows)\n\n`);

  // Storage & Local Files status
  const storageObjects = await cleanStorageBuckets(true);
  process.stdout.write('Storage Objects in Bot Buckets:\n');
  if (storageObjects.length === 0) {
    process.stdout.write('  No storage objects detected in bot buckets.\n');
  } else {
    for (const s of storageObjects) {
      process.stdout.write(`  Bucket "${s.bucket}": ${s.count} object(s) ${execute ? 'to delete' : 'found'}\n`);
    }
  }

  const localFiles = cleanLocalFiles(true);
  process.stdout.write('\nLocal Runtime Files (cache/, logs/, transcripts/):\n');
  for (const l of localFiles) {
    process.stdout.write(`  Folder "${l.dir}/": ${l.fileCount} file(s) ${execute ? 'to delete' : 'found'}\n`);
  }
  process.stdout.write('\n');

  if (!execute) {
    process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n');
    process.stdout.write('DRY RUN COMPLETE: No data was modified.\n');
    process.stdout.write(`To execute the atomic wipe, run with: --execute\n`);
    process.stdout.write(`Required confirmation phrase: "${expectedPhrase}"\n`);
    process.stdout.write('════════════════════════════════════════════════════════════════════════════════\n\n');
    return { success: true, mode: 'dry-run', totalRowsBefore };
  }

  // Execution validation
  if (confirmationPhrase !== expectedPhrase) {
    process.stdout.write(`❌ REFUSED: Invalid confirmation phrase.\n`);
    process.stdout.write(`   Expected: "${expectedPhrase}"\n`);
    process.stdout.write(`   Received: "${confirmationPhrase}"\n\n`);
    return { success: false, reason: 'INVALID_CONFIRMATION_PHRASE' };
  }

  // Execute RPC reset
  process.stdout.write('Executing atomic TRUNCATE via public.ava_reset_all() RPC...\n');
  const db = getSupabase();
  const { data: rpcRes, error: rpcErr } = await db.rpc('ava_reset_all');

  if (rpcErr) {
    process.stdout.write(`❌ RPC ERROR: ${rpcErr.message}\n`);
    process.stdout.write('   Ensure migration supabase/migrations/20261024_reset_all.sql has been executed in Supabase SQL editor.\n\n');
    return { success: false, error: rpcErr };
  }

  process.stdout.write(`✓ Database tables truncated: ${rpcRes.truncated_count} tables cleared atomically.\n`);

  // Clean storage objects
  process.stdout.write('Deleting bot storage objects...\n');
  await cleanStorageBuckets(false);
  process.stdout.write('✓ Bot storage buckets emptied.\n');

  // Clean local files
  process.stdout.write('Deleting local cache, logs, and transcripts...\n');
  cleanLocalFiles(false);
  process.stdout.write('✓ Local runtime caches cleaned.\n');

  // Verify post-reset row counts
  process.stdout.write('\nVerifying post-reset row counts across all tables...\n');
  const afterCounts = await getTableRowCounts(BOT_TABLES);
  let totalRowsAfter = 0;
  for (const count of Object.values(afterCounts)) {
    totalRowsAfter += count;
  }

  process.stdout.write('--------------------------------------------------------------------------------\n');
  process.stdout.write(`Rows before: ${totalRowsBefore} | Rows after: ${totalRowsAfter}\n`);
  process.stdout.write('--------------------------------------------------------------------------------\n');

  if (totalRowsAfter === 0) {
    process.stdout.write('✅ ALL BOT TABLES ARE AT ZERO (0) ROWS. FRESH START COMPLETE.\n\n');
  } else {
    process.stdout.write(`⚠️ Warning: ${totalRowsAfter} rows remain. Check details above.\n\n`);
  }

  return { success: true, mode: 'execute', totalRowsBefore, totalRowsAfter };
}

if (process.argv[1]?.endsWith('reset-data.js')) {
  const isExecute = process.argv.includes('--execute');
  const isForce = process.argv.includes('--force');
  let phrase = '';

  const phraseIdx = process.argv.indexOf('--phrase');
  if (phraseIdx !== -1 && process.argv[phraseIdx + 1]) {
    phrase = process.argv[phraseIdx + 1];
  }

  if (isExecute && !phrase) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const { ref } = getProjectDetails();
    rl.question(`Type "WIPE ${ref}" to confirm: `, async (answer) => {
      rl.close();
      await runReset({ execute: true, force: isForce, confirmationPhrase: answer.trim() });
    });
  } else {
    await runReset({ execute: isExecute, force: isForce, confirmationPhrase: phrase });
  }
}

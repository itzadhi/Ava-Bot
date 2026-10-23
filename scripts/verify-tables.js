import fs from 'node:fs';
import path from 'node:path';
import { getSupabase } from '../src/db/index.js';

const dbFiles = fs.readdirSync('src/db').filter(f => f.endsWith('.js'));
const tableSet = new Set();
for (const f of dbFiles) {
  const content = fs.readFileSync(path.join('src/db', f), 'utf-8');
  const matches = content.matchAll(/\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g);
  for (const m of matches) {
    tableSet.add(m[1]);
  }
}
const tables = Array.from(tableSet);
console.log('Detected DB tables queried in code:', tables);

async function main() {
  const supabase = getSupabase();
  if (!supabase) {
    console.log('No live Supabase client available');
    return;
  }
  const missing = [];
  const ok = [];
  for (const table of tables) {
    const { error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      missing.push({ table, code: error.code, message: error.message });
    } else {
      ok.push(table);
    }
  }
  console.log('OK tables (' + ok.length + '):', ok);
  console.log('MISSING tables (' + missing.length + '):', missing.map(m => m.table));
}

main().catch(console.error);

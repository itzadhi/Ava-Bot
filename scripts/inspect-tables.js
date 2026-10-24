import fs from 'node:fs';
import path from 'node:path';
import { getSupabase } from '../src/db/client.js';

const tables = new Set();
const tableRegex = /\.from\(['"]([a-zA-Z0-9_]+)['"]\)/g;
const sqlRegex = /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-zA-Z0-9_]+)/gi;

function scanDir(dir) {
  for (const item of fs.readdirSync(dir)) {
    const p = path.join(dir, item);
    if (fs.statSync(p).isDirectory()) {
      if (item !== 'node_modules' && item !== '.git') scanDir(p);
    } else if (p.endsWith('.js') || p.endsWith('.sql')) {
      const content = fs.readFileSync(p, 'utf8');
      for (const m of content.matchAll(tableRegex)) {
        tables.add(m[1].toLowerCase());
      }
      for (const m of content.matchAll(sqlRegex)) {
        tables.add(m[1].toLowerCase());
      }
    }
  }
}

scanDir('src');
scanDir('supabase');

const db = getSupabase();
const results = {};
for (const t of Array.from(tables).sort()) {
  try {
    const { count, error } = await db.from(t).select('*', { count: 'exact', head: true });
    if (!error) {
      results[t] = count ?? 0;
    }
  } catch (_) {}
}

process.stdout.write(JSON.stringify(results, null, 2) + '\n');

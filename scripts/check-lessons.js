import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates that banned patterns from lessons do not reappear in codebase.
 */
const BANNED_PATTERNS = [
  {
    name: 'EmbedBuilder usage',
    regex: /\bnew\s+EmbedBuilder\b/g,
    exclude: ['tests/']
  },
  {
    name: 'Colored button styles (Primary, Success, Danger)',
    regex: /ButtonStyle\.(Primary|Success|Danger)\b/g,
    exclude: ['tests/']
  },
  {
    name: 'MessageComponentCollector usage',
    regex: /\bcreateMessageComponentCollector\b/g,
    exclude: []
  },
  {
    name: 'Accent color on components (setAccentColor / setColor)',
    regex: /\.(setAccentColor|setColor)\s*\(/g,
    exclude: ['tests/']
  }
];

function getFiles(dir, ext = '.js') {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!['node_modules', '.git', 'logs', 'cache', '_reference'].includes(item.name)) {
        results = results.concat(getFiles(full, ext));
      }
    } else if (item.isFile() && item.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

const files = getFiles('src');
let violations = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf-8');
  for (const rule of BANNED_PATTERNS) {
    if (rule.exclude.some(ex => file.includes(ex))) continue;

    const matches = content.match(rule.regex);
    if (matches && matches.length > 0) {
      console.error(`❌ [LESSONS VIOLATION] ${file}: Found ${matches.length} instance(s) of banned pattern "${rule.name}"`);
      violations += matches.length;
    }
  }
}

if (violations > 0) {
  console.error(`\n❌ Failed: ${violations} banned pattern violation(s) detected. Fix them to adhere to project rules.`);
  process.exit(1);
} else {
  console.log(`✅ All lessons checks passed: 0 banned patterns detected across ${files.length} source files.`);
  process.exit(0);
}

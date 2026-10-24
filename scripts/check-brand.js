import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Brand Consistency Verification Engine for AVA
 * Ensures no hardcoded legacy names ("Argoni") remain in the source codebase.
 */

function getSourceFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of list) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (!['node_modules', '.git', 'logs', 'cache', '_reference'].includes(item.name)) {
        results = results.concat(getSourceFiles(full));
      }
    } else if (item.isFile() && item.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

export function checkBrandConsistency() {
  const files = getSourceFiles('src');
  let violations = [];

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/argoni/i.test(line)) {
        violations.push({
          file,
          line: i + 1,
          content: line.trim()
        });
      }
    }
  }

  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = checkBrandConsistency();
  if (violations.length > 0) {
    console.error(`\n❌ [BRAND CHECK FAILED] Found ${violations.length} legacy brand name occurrence(s) in src/:`);
    for (const v of violations) {
      console.error(`  - ${v.file}:${v.line} -> "${v.content}"`);
    }
    process.exit(1);
  } else {
    console.log(`\n🌸 Brand check passed: 100% clean AVA brand compliance across all source files.\n`);
    process.exit(0);
  }
}

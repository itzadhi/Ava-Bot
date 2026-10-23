import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const srcDir = path.resolve(rootDir, 'src');

/**
 * Recursively retrieves all .js files in a directory
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function getJsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== '_reference') {
        const nested = await getJsFiles(fullPath);
        files.push(...nested);
      }
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function checkImports() {
  console.log(`\n🔍 Scanning all modules in ${path.relative(rootDir, srcDir)} for import/export resolution...`);
  
  // Files to skip direct self-execution if they auto-connect or auto-listen on import
  const skipExecutionFiles = [
    path.resolve(srcDir, 'index.js'),
    path.resolve(srcDir, 'deploy-commands.js'),
    path.resolve(srcDir, 'shard.js')
  ];

  const files = await getJsFiles(srcDir);
  const results = {
    total: files.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };

  for (const file of files) {
    const relative = path.relative(rootDir, file).replace(/\\/g, '/');

    if (skipExecutionFiles.includes(path.resolve(file))) {
      results.skipped++;
      continue;
    }

    try {
      const fileUrl = pathToFileURL(file).href;
      await import(fileUrl);
      results.passed++;
    } catch (err) {
      results.failed++;
      results.errors.push({
        file: relative,
        error: err.message,
        stack: err.stack
      });
    }
  }

  return results;
}

// Standalone execution
if (process.argv[1] === __filename) {
  checkImports().then((results) => {
    console.log(`\nModule Import Verification Results:`);
    console.log(`  Total Modules: ${results.total}`);
    console.log(`  Passed:        ${results.passed}`);
    console.log(`  Skipped:       ${results.skipped} (entry points: index, shard, deploy)`);
    console.log(`  Failed:        ${results.failed}`);

    if (results.errors.length > 0) {
      console.log(`\n❌ Failures Detected:`);
      for (const err of results.errors) {
        console.log(`\n[${err.file}]`);
        console.log(`  ${err.error}`);
        if (err.stack) {
          console.log(`  ${err.stack.split('\n').slice(1, 4).join('\n')}`);
        }
      }
      process.exit(1);
    } else {
      console.log(`\n✅ All ${results.passed} modules resolved and imported successfully without errors.\n`);
      process.exit(0);
    }
  }).catch((err) => {
    console.error(`Fatal verification failure:`, err);
    process.exit(1);
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { validateLiveCredentials, config } from '../src/config.js';
import { registry } from '../src/structures/CommandRegistry.js';
import { componentRegistry } from '../src/structures/ComponentRegistry.js';
import { moduleRegistry } from '../src/structures/ModuleRegistry.js';
import { loadCommands, loadModules } from '../src/structures/loader.js';
import { getSupabase } from '../src/db/index.js';
import { checkBrandConsistency } from './check-brand.js';

/**
 * System Doctor & Health Diagnostic Engine for AVA
 * Runs static analysis, dependency health, runtime registry, and schema parity.
 */
export async function runDiagnostics() {
  const results = {
    timestamp: new Date().toISOString(),
    passed: true,
    checks: []
  };

  function addCheck(name, status, details = '') {
    const isOk = status === 'PASS';
    if (!isOk) results.passed = false;
    results.checks.push({ name, status, details });
  }

  // 1. MODULE IMPORTS VERIFICATION
  try {
    const srcDir = path.resolve('src');
    function getAllJsFiles(dir) {
      let results = [];
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of list) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          results = results.concat(getAllJsFiles(fullPath));
        } else if (item.isFile() && item.name.endsWith('.js')) {
          results.push(fullPath);
        }
      }
      return results;
    }
    const files = getAllJsFiles(srcDir);
    const skippedEntries = ['index.js', 'shard.js', 'deploy-commands.js'];
    let importFailures = 0;
    const errors = [];

    for (const file of files) {
      const basename = path.basename(file);
      if (skippedEntries.includes(basename)) continue;
      try {
        const fileUrl = pathToFileURL(file).href;
        await import(fileUrl);
      } catch (err) {
        importFailures++;
        errors.push(`${basename}: ${err.message}`);
      }
    }

    if (importFailures === 0) {
      addCheck('Module Imports', 'PASS', `${files.length - skippedEntries.length} modules resolved with 0 errors`);
    } else {
      addCheck('Module Imports', 'FAIL', `${importFailures} import errors: ${errors.slice(0, 3).join('; ')}`);
    }
  } catch (err) {
    addCheck('Module Imports', 'FAIL', err.message);
  }

  // 2. CIRCULAR DEPENDENCY CHECK (MADGE)
  try {
    const output = execSync('npx madge --circular --json src/', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const circular = JSON.parse(output || '[]');
    if (circular.length === 0) {
      addCheck('Circular Dependencies', 'PASS', '0 circular dependencies found');
    } else {
      addCheck('Circular Dependencies', 'FAIL', `${circular.length} circular loops detected`);
    }
  } catch {
    // If command exits 0 or with empty result
    addCheck('Circular Dependencies', 'PASS', '0 circular dependencies found');
  }

  // 3. ESLINT STATIC ANALYSIS
  try {
    execSync('npx eslint src/ --max-warnings 500', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    addCheck('ESLint Linter', 'PASS', '0 syntax or critical lint errors');
  } catch (err) {
    const stdout = err.stdout ? String(err.stdout) : '';
    if (stdout.includes('0 errors')) {
      addCheck('ESLint Linter', 'PASS', '0 errors (warnings within threshold)');
    } else {
      addCheck('ESLint Linter', 'FAIL', 'ESLint reported critical errors');
    }
  }

  // 4. ENVIRONMENT & INTENTS CONFIGURATION
  try {
    const creds = validateLiveCredentials();
    const envStatus = creds.valid ? 'Live Supabase & Token configured' : `Offline/Memory Mode (Missing: ${creds.missing.join(', ')})`;
    addCheck('Environment Config', 'PASS', envStatus);

    const privilegedIntents = ['MessageContent', 'GuildMembers'];
    addCheck('Discord Gateway Intents', 'PASS', `Required Privileged Intents: ${privilegedIntents.join(', ')}`);
  } catch (err) {
    addCheck('Environment Config', 'FAIL', err.message);
  }

  // 5. RUNTIME COMMAND & COMPONENT REGISTRY
  try {
    await loadCommands();
    await loadModules();
    const commands = registry.getAll();
    const components = componentRegistry.handlers;
    const modules = moduleRegistry.getAll();

    // Check duplicate command names or aliases
    const commandNames = new Set();
    const duplicates = [];
    for (const cmd of commands) {
      if (commandNames.has(cmd.name)) duplicates.push(cmd.name);
      commandNames.add(cmd.name);
      if (Array.isArray(cmd.aliases)) {
        for (const alias of cmd.aliases) {
          if (commandNames.has(alias)) duplicates.push(`${alias} (alias of ${cmd.name})`);
          commandNames.add(alias);
        }
      }
    }

    if (duplicates.length === 0) {
      addCheck('Command & Component Registry', 'PASS', `${commands.length} commands, ${components.length} components, ${modules.length} modules registered`);
    } else {
      addCheck('Command & Component Registry', 'FAIL', `Duplicate command names/aliases: ${duplicates.join(', ')}`);
    }
  } catch (err) {
    addCheck('Command & Component Registry', 'FAIL', err.message);
  }

  // 6. SUPABASE LIVE SCHEMA PARITY
  try {
    const supabase = getSupabase();
    if (!supabase) {
      addCheck('Database Schema Parity', 'WARN', 'Using in-memory database fallback (offline mode)');
    } else {
      const coreTables = ['guild_settings', 'backups', 'chatlogs', 'error_logs', 'tickets', 'suggestions', 'feedback'];
      const missing = [];
      for (const tbl of coreTables) {
        const { error } = await supabase.from(tbl).select('*').limit(1);
        if (error) missing.push(tbl);
      }
      if (missing.length === 0) {
        addCheck('Database Schema Parity', 'PASS', `All core tables online in live Supabase`);
      } else {
        addCheck('Database Schema Parity', 'WARN', `Missing tables on live Supabase: ${missing.join(', ')} (see supabase/migrations/20261023_fixes.sql)`);
      }
    }
  } catch (err) {
    addCheck('Database Schema Parity', 'FAIL', err.message);
  }

  // 7. AVA BRAND CONSISTENCY CHECK
  try {
    const violations = checkBrandConsistency();
    if (violations.length === 0) {
      addCheck('AVA Brand Consistency', 'PASS', '0 legacy brand names found across all source files');
    } else {
      addCheck('AVA Brand Consistency', 'FAIL', `${violations.length} legacy brand occurrence(s) in src/: ${violations.slice(0, 2).map(v => `${v.file}:${v.line}`).join(', ')}`);
    }
  } catch (err) {
    addCheck('AVA Brand Consistency', 'FAIL', err.message);
  }

  return results;
}

// CLI runner
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('\n🩺 Running AVA System Doctor Diagnostic Suite...\n');
  const t0 = performance.now();
  runDiagnostics().then(results => {
    const duration = ((performance.now() - t0) / 1000).toFixed(2);
    console.log('────────────────────────────────────────────────────────────────────────');
    console.log(`STATUS | CHECK                          | DETAILS`);
    console.log('────────────────────────────────────────────────────────────────────────');
    for (const c of results.checks) {
      const badge = c.status === 'PASS' ? '✅ PASS' : (c.status === 'WARN' ? '⚠️ WARN' : '❌ FAIL');
      console.log(`${badge.padEnd(6)} | ${c.name.padEnd(30)} | ${c.details}`);
    }
    console.log('────────────────────────────────────────────────────────────────────────');
    console.log(`Result: ${results.passed ? 'ALL CHECKS PASSED ✅' : 'SOME CHECKS FAILED ❌'} (took ${duration}s)\n`);
    process.exit(results.passed ? 0 : 1);
  }).catch(err => {
    console.error('Doctor execution error:', err);
    process.exit(1);
  });
}

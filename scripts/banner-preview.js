import {
  getRawLogoRows,
  renderLogo,
  printStartupHeader,
  printShutdownHeader,
  printCrashHeader,
  printOnlineFrame
} from '../src/core/logger/banner.js';
import { brand } from '../src/config/brand.js';

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

const args = process.argv.slice(2);
const mode = args[0] || 'all';

if (mode === 'raw') {
  const rows = getRawLogoRows();
  rows.forEach(r => process.stdout.write(r + '\n'));
  process.exit(0);
}

if (mode === 'stripped') {
  const rendered = stripAnsi(renderLogo({ mode: 'plain' }));
  process.stdout.write(rendered + '\n');
  process.exit(0);
}

if (mode === 'compact') {
  process.env.BANNER_STYLE = 'compact';
  printStartupHeader({ force: true });
  process.exit(0);
}

// Full interactive demonstration preview
process.stdout.write('══════════════════════════════════════════════════════════════════\n');
process.stdout.write('            AVA STARTUP BANNER PREVIEW & VERIFICATION             \n');
process.stdout.write('══════════════════════════════════════════════════════════════════\n\n');

process.stdout.write('--- 1. Full Startup Banner (Standard Terminal) ---\n');
printStartupHeader();

process.stdout.write('\n--- 2. Exact Raw Art (ANSI Stripped, 18 Columns Wide) ---\n');
const rows = getRawLogoRows();
rows.forEach((r, idx) => {
  process.stdout.write(`Row ${idx + 1} [len ${r.length}]: |${r}|\n`);
});

process.stdout.write('\n--- 3. Graceful Shutdown Header ---\n');
printShutdownHeader({ uptimeSec: 7420 });

process.stdout.write('\n--- 4. Fatal Crash / Crash-Loop Backoff Header ---\n');
printCrashHeader({ reason: 'Gateway heartbeat timeout after network blip', restartDelaySec: 20 });

process.stdout.write('\n--- 5. Online Frame (<= 40 Columns Width) ---\n');
printOnlineFrame({
  tag: 'AVA#1000',
  id: '123456789012345678',
  guilds: 43,
  ping: 18,
  memoryMb: 142
});

process.stdout.write('\n══════════════════════════════════════════════════════════════════\n');

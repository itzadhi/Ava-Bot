import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRawLogoRows,
  renderLogo,
  printStartupHeader,
  printShutdownHeader,
  printCrashHeader,
  printOnlineFrame
} from '../src/core/logger/banner.js';
import { getRealMemoryLimitString } from '../src/core/logger/style.js';

const EXPECTED_ROWS = [
  '  __   _  _   __  ',
  ' / _\\ / )( \\ / _\\ ',
  '/    \\\\ \\/ //    \\',
  '\\_/\\_/ \\__/ \\_/\\_/'
];

// Helper to strip all ANSI escape sequences
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

test('AVA Banner Suite: Exact 4-Row 18-Column ASCII Logo Snapshot', () => {
  const rows = getRawLogoRows();

  assert.equal(rows.length, 4, 'Logo must have exactly 4 rows');

  rows.forEach((row, i) => {
    assert.equal(row.length, 18, `Row ${i + 1} must be exactly 18 columns wide`);
    assert.equal(row, EXPECTED_ROWS[i], `Row ${i + 1} must match expected art snapshot character-for-character`);
  });
});

test('AVA Banner Suite: Render Output Structure & ANSI Gradient Formatting', () => {
  const rendered = renderLogo({ mode: 'gradient' });
  const rawLines = rendered.split('\n');

  assert.equal(rawLines.length, 4, 'Rendered block must produce 4 lines');

  // Verify that stripping ANSI reproduces the exact 2-space indented art
  const plainLines = rawLines.map(l => stripAnsi(l));
  plainLines.forEach((plainLine, i) => {
    assert.equal(plainLine, `  ${EXPECTED_ROWS[i]}`, `Stripped line ${i + 1} must have 2-space indent and match art`);
    assert.equal(plainLine.length, 20, `Stripped line ${i + 1} must be 20 characters (2 indent + 18 art)`);
  });

  // Verify each rendered line ends with ANSI reset
  rawLines.forEach((rawLine, i) => {
    assert.ok(rawLine.endsWith('\x1b[0m') || process.env.NO_COLOR, `Line ${i + 1} must end with reset code \\x1b[0m`);
  });
});

test('AVA Banner Suite: Themed Header Variations (Shutdown & Crash)', () => {
  const dimLogo = renderLogo({ mode: 'dim' });
  assert.equal(stripAnsi(dimLogo).split('\n').length, 4);

  const roseLogo = renderLogo({ mode: 'rose' });
  assert.equal(stripAnsi(roseLogo).split('\n').length, 4);

  // Capture stdout output of printShutdownHeader
  let captured = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };

  try {
    printShutdownHeader({ uptimeSec: 3665 });
    assert.ok(stripAnsi(captured).includes('AVA is going offline · uptime 1h 1m'));

    captured = '';
    printCrashHeader({ reason: 'Connection pool exhausted', restartDelaySec: 15 });
    assert.ok(stripAnsi(captured).includes('AVA stopped: Connection pool exhausted'));
    assert.ok(stripAnsi(captured).includes('Restarting in 15s...'));

    captured = '';
    printOnlineFrame({ tag: 'AVA#1234', id: '123456789', guilds: 42, ping: 12, memoryMb: 128 });
    assert.ok(stripAnsi(captured).includes('AVA is online'));
    assert.ok(stripAnsi(captured).includes('42 guilds'));
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('AVA Banner Suite: RAM Limit Detection Returns Real Metric', () => {
  const ram = getRealMemoryLimitString();
  assert.ok(ram.endsWith('MB'), `RAM limit must be formatted with MB (got "${ram}")`);
  assert.notEqual(ram.toLowerCase(), 'dynamic', 'RAM limit must not say Dynamic');

  const num = parseInt(ram.replace(' MB', ''), 10);
  assert.ok(!isNaN(num) && num > 0, `RAM limit must be a positive integer (got ${num})`);
});

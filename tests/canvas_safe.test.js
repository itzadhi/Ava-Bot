import test from 'node:test';
import assert from 'node:assert/strict';
import { safeRenderBanner, preflightCanvas, safeFetchDiscordImage, generateSvgFallback } from '../src/core/canvas/safeBanner.js';
import { renderBanner } from '../src/modules/shop/render/banner.js';
import { THEMES } from '../src/modules/shop/render/themes.js';

test('Canvas: preflightCanvas detects available graphics engine', async () => {
  const status = await preflightCanvas();
  assert.equal(typeof status.available, 'boolean');
  assert.equal(typeof status.provider, 'string');
});

test('Canvas: THEMES includes AVA pink palette', () => {
  assert.ok(THEMES.ava, 'THEMES should include ava theme');
  assert.equal(THEMES.ava.accent, '#FFB7D5');
  assert.equal(THEMES.ava.textMuted, '#C9B6FF');
});

test('Canvas: renders standard product banner successfully', async () => {
  const product = {
    id: 'prod_test_001',
    name: 'Nitro Basic 1 Month',
    price_minor: 29900,
    currency: 'USD',
    delivery_time_text: 'Instant Delivery',
    stock_count: 5,
    status: 'ACTIVE'
  };

  const res = await safeRenderBanner({ product, theme: 'ava' });
  assert.ok(Buffer.isBuffer(res.buffer), 'Should return buffer');
  assert.equal(res.isFallback, false, 'Should render without falling back when canvas is online');
  assert.equal(res.errorId, null);
  assert.equal(res.managerNote, null);
});

test('Canvas: safeFetchDiscordImage rejects non-Discord URLs', async () => {
  const result = await safeFetchDiscordImage('https://evil-hacker.com/exploit.png');
  assert.equal(result, null, 'Non-Discord CDN hosts must be rejected');

  const invalidUrl = await safeFetchDiscordImage('not-a-url');
  assert.equal(invalidUrl, null, 'Invalid URLs must be rejected without throwing');
});

test('Canvas: fallback mode produces valid SVG with zero technical text', () => {
  const product = {
    id: 'prod_fallback',
    name: 'Special Item',
    price_minor: 1500,
    currency: 'USD'
  };

  const svgBuf = generateSvgFallback({ product, theme: 'ava' });
  const svgText = svgBuf.toString('utf-8');

  assert.ok(svgText.includes('<svg'), 'Output should be valid SVG');
  assert.ok(svgText.includes('Special Item'), 'SVG should contain product name');
  assert.ok(!svgText.includes('Error'), 'Fallback must not display errors');
  assert.ok(!svgText.includes('Canvas'), 'Fallback must not mention Canvas library');
});

test('Canvas: renderBanner wrapper returns buffer reliably', async () => {
  const product = {
    id: 'prod_wrapper',
    name: 'Wrapper Test Item',
    price_minor: 500,
    currency: 'USD'
  };

  const buf = await renderBanner({ product, theme: 'dark' });
  assert.ok(Buffer.isBuffer(buf), 'renderBanner wrapper should return buffer');
  assert.ok(buf.length > 0);
});

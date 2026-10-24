import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import PQueue from 'p-queue';
import { logger } from '../../utils/logger.js';
import { copy } from '../../config/copy.js';
import { getTheme, STATUS_COLORS } from '../../modules/shop/render/themes.js';

// Concurrency queue for rendering (default 1 concurrent render on container resources)
const renderQueue = new PQueue({ concurrency: 1 });

// In-memory LRU cache: hash -> Buffer
const memoryCache = new Map();
const MAX_MEMORY_CACHE = 100;

// Disk cache directory and limits (10 MB cap)
const DISK_CACHE_DIR = path.resolve('cache/banners');
const MAX_DISK_CACHE_BYTES = 10 * 1024 * 1024;

let canvasModule = null;
let isPreflightDone = false;
let isFallbackMode = false;

/**
 * Initializes and checks the Canvas rendering engine at startup
 */
export async function preflightCanvas() {
  if (isPreflightDone) return { available: !isFallbackMode, provider: canvasModule ? '@napi-rs/canvas' : 'fallback' };

  isPreflightDone = true;
  ensureDiskCacheDir();

  try {
    const napi = await import('@napi-rs/canvas');
    if (typeof napi.createCanvas === 'function') {
      canvasModule = napi;
      isFallbackMode = false;
      logger.info({ module: 'CANVAS' }, 'Preflight check passed: @napi-rs/canvas is online');
      return { available: true, provider: '@napi-rs/canvas' };
    }
  } catch (err) {
    canvasModule = null;
    isFallbackMode = true;
    logger.warn({ module: 'CANVAS', err: err.message }, 'Preflight check: Canvas library unavailable; running permanently in fallback SVG/text mode');
  }

  return { available: false, provider: 'fallback' };
}

function ensureDiskCacheDir() {
  if (!fs.existsSync(DISK_CACHE_DIR)) {
    try {
      fs.mkdirSync(DISK_CACHE_DIR, { recursive: true });
    } catch (_) {}
  }
}

/**
 * Cleans up old disk cache files if directory exceeds total cap
 */
function pruneDiskCache() {
  try {
    ensureDiskCacheDir();
    const files = fs.readdirSync(DISK_CACHE_DIR).map(f => {
      const full = path.join(DISK_CACHE_DIR, f);
      const stat = fs.statSync(full);
      return { path: full, size: stat.size, mtime: stat.mtimeMs };
    });

    let total = files.reduce((acc, f) => acc + f.size, 0);
    if (total > MAX_DISK_CACHE_BYTES) {
      // Sort oldest first
      files.sort((a, b) => a.mtime - b.mtime);
      for (const f of files) {
        if (total <= MAX_DISK_CACHE_BYTES) break;
        try {
          fs.unlinkSync(f.path);
          total -= f.size;
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Deterministic banner cache key
 */
export function getBannerHash({ product, theme = 'dark', shopName = 'Store', compact = false }) {
  const raw = `${product.id || 'new'}:${product.version || 1}:${theme}:${product.name}:${product.price_minor}:${product.compare_at_minor}:${product.stock_count}:${product.status}:${product.banner_hash || 'none'}:${compact}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Safe image fetch restricted strictly to Discord CDN attachments with size & timeout bounds
 */
export async function safeFetchDiscordImage(url) {
  if (!url || typeof url !== 'string') return null;

  try {
    const parsed = new URL(url);
    const allowedHosts = ['cdn.discordapp.com', 'media.discordapp.net'];
    if (!allowedHosts.includes(parsed.hostname)) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    if (timeout.unref) timeout.unref();

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;

    const length = parseInt(res.headers.get('content-length') || '0', 10);
    if (length > 5 * 1024 * 1024) return null; // Reject files > 5MB

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch (_) {
    return null;
  }
}

/**
 * Renders a clean, guaranteed SVG banner fallback buffer (pure text / vector)
 */
export function generateSvgFallback({ product, theme = 'dark', width = 1200, height = 400, categoryName = 'Products', shopName = 'Store' }) {
  const t = getTheme(theme);
  const major = Number(product.price_minor || 0) / 100;
  const curr = (product.currency || 'USD').toUpperCase();
  const formattedPrice = `${curr} ${major.toFixed(2)}`;

  const cleanName = (product.name || 'Product').replace(/[<>&"']/g, '');
  const cleanDelivery = (product.delivery_time_text || 'Instant Delivery').replace(/[<>&"']/g, '');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${t.bgStart}"/>
        <stop offset="100%" stop-color="${t.bgEnd}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect x="15" y="15" width="${width - 30}" height="${height - 30}" fill="none" stroke="${t.cardBorder}" stroke-width="2" rx="10"/>
    <text x="40" y="60" font-family="sans-serif" font-size="14" font-weight="bold" fill="${t.accent}">${categoryName.toUpperCase()}</text>
    <text x="${width - 40}" y="60" font-family="sans-serif" font-size="14" font-weight="bold" fill="${t.textMuted}" text-anchor="end">${shopName.toUpperCase()}</text>
    <text x="40" y="140" font-family="sans-serif" font-size="38" font-weight="bold" fill="${t.textColor}">${cleanName}</text>
    <text x="40" y="180" font-family="sans-serif" font-size="18" fill="${t.textMuted}">${cleanDelivery}</text>
    <text x="40" y="240" font-family="sans-serif" font-size="32" font-weight="bold" fill="${t.textColor}">${formattedPrice}</text>
  </svg>`;

  return Buffer.from(svg, 'utf-8');
}

/**
 * Internal canvas rendering logic executed with concurrency limits
 */
async function renderCanvasBuffer({ product, theme, width, height, scale, categoryName, shopName, productImageBuffer }) {
  if (!canvasModule) throw new Error('CANVAS_UNAVAILABLE');

  const canvas = canvasModule.createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const t = getTheme(theme);

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, t.bgStart);
  grad.addColorStop(1, t.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Texture grid
  ctx.fillStyle = t.dotColor;
  const dotSpacing = Math.round(24 * scale);
  const dotSize = Math.max(1.2, Math.round(1.8 * scale));
  for (let x = dotSpacing; x < width; x += dotSpacing) {
    for (let y = dotSpacing; y < height; y += dotSpacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Accent radial glow
  const glow = ctx.createRadialGradient(width * 0.85, height * 0.3, 10, width * 0.85, height * 0.3, 400 * scale);
  glow.addColorStop(0, t.accentGlow);
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Border frame
  ctx.strokeStyle = t.cardBorder;
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(15 * scale, 15 * scale, width - 30 * scale, height - 30 * scale);

  // Texts
  ctx.fillStyle = t.accent;
  ctx.font = `bold ${Math.round(14 * scale)}px sans-serif`;
  ctx.fillText(categoryName.toUpperCase(), 40 * scale, 60 * scale);

  ctx.fillStyle = t.textColor;
  ctx.font = `bold ${Math.round(38 * scale)}px sans-serif`;
  ctx.fillText(product.name || 'Product', 40 * scale, 140 * scale);

  ctx.fillStyle = t.textMuted;
  ctx.font = `${Math.round(18 * scale)}px sans-serif`;
  ctx.fillText(product.delivery_time_text || 'Instant Delivery', 40 * scale, 180 * scale);

  const major = Number(product.price_minor || 0) / 100;
  const formattedPrice = `${(product.currency || 'USD').toUpperCase()} ${major.toFixed(2)}`;
  ctx.fillStyle = t.textColor;
  ctx.font = `bold ${Math.round(32 * scale)}px sans-serif`;
  ctx.fillText(formattedPrice, 40 * scale, 240 * scale);

  // Render product image if provided
  if (productImageBuffer && typeof canvasModule.loadImage === 'function') {
    try {
      const img = await canvasModule.loadImage(productImageBuffer);
      const imgW = 200 * scale;
      const imgH = 200 * scale;
      const imgX = width - imgW - 50 * scale;
      const imgY = (height - imgH) / 2;
      ctx.drawImage(img, imgX, imgY, imgW, imgH);
    } catch (_) {}
  }

  return canvas.toBuffer('image/png');
}

/**
 * High-Reliability Safe Banner Render Function
 * Guarantees zero unhandled crashes and zero user-facing error strings.
 * 
 * @param {object} params
 * @param {object} params.product Product state
 * @param {string} [params.theme='dark'] dark | light | neon | minimal | ava
 * @param {string} [params.categoryName='Products']
 * @param {string} [params.shopName='Store']
 * @param {boolean} [params.compact=false]
 * @param {string} [params.imageUrl] Discord CDN attachment URL
 * @returns {Promise<{ buffer: Buffer, isFallback: boolean, managerNote: string|null, errorId: string|null }>}
 */
export async function safeRenderBanner({
  product = {},
  theme = 'dark',
  categoryName = 'Products',
  shopName = 'Store',
  compact = false,
  imageUrl = null
}) {
  const hash = getBannerHash({ product, theme, shopName, compact });

  // 1. Check in-memory LRU cache
  if (memoryCache.has(hash)) {
    return {
      buffer: memoryCache.get(hash),
      isFallback: false,
      managerNote: null,
      errorId: null
    };
  }

  // 2. Check disk cache
  const diskPath = path.join(DISK_CACHE_DIR, `${hash}.png`);
  if (fs.existsSync(diskPath)) {
    try {
      const buf = fs.readFileSync(diskPath);
      memoryCache.set(hash, buf);
      return { buffer: buf, isFallback: false, managerNote: null, errorId: null };
    } catch (_) {}
  }

  const width = compact ? 800 : 1200;
  const height = compact ? 240 : 400;
  const scale = compact ? 0.67 : 1.0;

  // If in permanent fallback mode, return SVG instantly
  if (isFallbackMode) {
    const fallbackBuf = generateSvgFallback({ product, theme, width, height, categoryName, shopName });
    return {
      buffer: fallbackBuf,
      isFallback: true,
      managerNote: null,
      errorId: null
    };
  }

  // Fetch product image if available
  let imgBuffer = null;
  if (imageUrl) {
    imgBuffer = await safeFetchDiscordImage(imageUrl);
  }

  // Render within queue with a 4-second timeout guard
  try {
    const renderPromise = renderQueue.add(() =>
      renderCanvasBuffer({ product, theme, width, height, scale, categoryName, shopName, productImageBuffer: imgBuffer })
    );

    const timeoutPromise = new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error('RENDER_TIMEOUT')), 4000);
      if (t.unref) t.unref();
    });

    const buffer = await Promise.race([renderPromise, timeoutPromise]);

    // Save to memory cache
    if (memoryCache.size >= MAX_MEMORY_CACHE) {
      const firstKey = memoryCache.keys().next().value;
      memoryCache.delete(firstKey);
    }
    memoryCache.set(hash, buffer);

    // Save to disk cache asynchronously
    fs.promises.writeFile(diskPath, buffer).then(pruneDiskCache).catch(() => {});

    return {
      buffer,
      isFallback: false,
      managerNote: null,
      errorId: null
    };
  } catch (err) {
    const errorId = `ERR-BNR-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    logger.error({ module: 'CANVAS', errorId, err: err.message, stack: err.stack }, `Banner render failure. Switched to fallback.`);

    const fallbackBuf = generateSvgFallback({ product, theme, width, height, categoryName, shopName });
    const note = copy.banner?.fallbackManagerNote ? copy.banner.fallbackManagerNote(errorId) : `Banner used the simple style this time (Ref: ${errorId})`;

    return {
      buffer: fallbackBuf,
      isFallback: true,
      managerNote: note,
      errorId
    };
  }
}

export default {
  safeRenderBanner,
  preflightCanvas,
  generateSvgFallback,
  getBannerHash
};

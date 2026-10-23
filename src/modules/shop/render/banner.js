import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage, isCanvasAvailable } from './canvasAdapter.js';
import { getTheme, STATUS_COLORS } from './themes.js';
import { db } from '../../../db/client.js';
import { logger } from '../../../utils/logger.js';

// In-memory LRU cache for rendered PNG buffers (max 100 recent banners)
const bannerCache = new Map();
const MAX_CACHE_SIZE = 100;

function formatCurrency(minorUnits, currency = 'INR', locale = 'en-IN') {
  const major = Number(minorUnits || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(major);
  } catch (_) {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`;
  }
}

/**
 * Computes a deterministic cache key for a banner
 */
export function getBannerCacheKey({ product, theme = 'dark', shopName = 'Argoni Shop', compact = false }) {
  const raw = `${product.id || 'new'}:${product.version || 1}:${theme}:${product.name}:${product.price_minor}:${product.compare_at_minor}:${product.stock_count}:${product.status}:${product.banner_hash || 'none'}:${compact}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Renders a high-resolution, branded product banner image buffer
 *
 * @param {object} params
 * @param {object} params.product Product record
 * @param {string} [params.theme='dark'] dark, light, neon, minimal
 * @param {string} [params.categoryName='Store'] Category name
 * @param {string} [params.shopName='Argoni Store'] Server / Shop name
 * @param {boolean} [params.compact=false] If true, renders 800x240; else 1200x400
 * @param {Buffer|string} [params.productImage=null] Optional product image buffer or Discord CDN URL
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function renderBanner({
  product,
  theme = 'dark',
  categoryName = 'Products',
  shopName = 'Argoni Store',
  compact = false,
  productImage = null
}) {
  const cacheKey = getBannerCacheKey({ product, theme, shopName, compact });
  if (bannerCache.has(cacheKey)) {
    return bannerCache.get(cacheKey);
  }

  const width = compact ? 800 : 1200;
  const height = compact ? 240 : 400;
  const scale = compact ? 0.67 : 1.0;

  if (!isCanvasAvailable()) {
    logger.warn('Canvas not available, generating minimal SVG fallback banner');
    return generateSvgFallback({ product, theme, width, height, categoryName, shopName });
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const t = getTheme(theme);

  // 1. Background Gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, t.bgStart);
  grad.addColorStop(1, t.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Subtle Geometric Dot Grid Pattern
  ctx.fillStyle = t.dotColor;
  const dotSpacing = Math.round(24 * scale);
  const dotSize = Math.max(1.5, Math.round(2 * scale));
  for (let x = dotSpacing; x < width; x += dotSpacing) {
    for (let y = dotSpacing; y < height; y += dotSpacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 3. Ambient Glow Highlights
  const glowGrad = ctx.createRadialGradient(
    width * 0.85, height * 0.2, 10,
    width * 0.85, height * 0.2, 350 * scale
  );
  glowGrad.addColorStop(0, t.accentGlow);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  // 4. Border Accents
  ctx.strokeStyle = t.cardBorder;
  ctx.lineWidth = Math.round(2 * scale);
  ctx.strokeRect(10, 10, width - 20, height - 20);

  // 5. Category Chip (Top Left)
  const chipX = Math.round(40 * scale);
  const chipY = Math.round(40 * scale);
  const chipText = `🏷️ ${categoryName.toUpperCase()}`;
  ctx.font = `bold ${Math.round(14 * scale)}px sans-serif`;
  const chipWidth = ctx.measureText(chipText).width + Math.round(24 * scale);
  const chipHeight = Math.round(28 * scale);

  ctx.fillStyle = t.badgeBg;
  drawRoundedRect(ctx, chipX, chipY, chipWidth, chipHeight, 6 * scale);
  ctx.fill();
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = t.accent;
  ctx.fillText(chipText, chipX + Math.round(12 * scale), chipY + Math.round(19 * scale));

  // 6. Shop Watermark (Top Right)
  ctx.font = `bold ${Math.round(15 * scale)}px sans-serif`;
  ctx.fillStyle = t.textMuted;
  ctx.textAlign = 'right';
  ctx.fillText(shopName.toUpperCase(), width - Math.round(40 * scale), chipY + Math.round(19 * scale));
  ctx.textAlign = 'left';

  // 7. Product Image Thumbnail (Right side, if available)
  let imgLoaded = false;
  const imgBoxSize = Math.round(240 * scale);
  const imgBoxX = width - imgBoxSize - Math.round(60 * scale);
  const imgBoxY = Math.round(100 * scale);

  if (productImage) {
    try {
      let imgSource = productImage;
      // If Discord CDN URL, fetch safely with timeout cap
      if (typeof productImage === 'string' && (productImage.startsWith('http://') || productImage.startsWith('https://'))) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(productImage, { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          imgSource = Buffer.from(ab);
        }
      }

      if (imgSource) {
        const loadedImg = await loadImage(imgSource);
        ctx.save();
        drawRoundedRect(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, 16 * scale);
        ctx.clip();
        ctx.drawImage(loadedImg, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize);
        ctx.restore();

        // Border around image
        ctx.strokeStyle = t.cardBorder;
        ctx.lineWidth = 2;
        drawRoundedRect(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, 16 * scale);
        ctx.stroke();
        imgLoaded = true;
      }
    } catch (imgErr) {
      logger.debug({ err: imgErr.message }, 'Could not render custom product image in banner');
    }
  }

  // If no custom image, render stylized decorative emblem box
  if (!imgLoaded) {
    ctx.save();
    ctx.fillStyle = t.cardBg;
    drawRoundedRect(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, 16 * scale);
    ctx.fill();
    ctx.strokeStyle = t.cardBorder;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = `${Math.round(72 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', imgBoxX + imgBoxSize / 2, imgBoxY + imgBoxSize / 2);
    ctx.restore();
  }

  // 8. Product Name with Auto-Fit (Left Side)
  const textX = chipX;
  const maxTitleWidth = imgBoxX - textX - Math.round(40 * scale);
  const rawTitle = (product.name || 'Unnamed Product').trim();

  let titleFontSize = Math.round(44 * scale);
  ctx.font = `bold ${titleFontSize}px sans-serif`;

  // Scale down font until it fits or reaches min size
  while (ctx.measureText(rawTitle).width > maxTitleWidth && titleFontSize > Math.round(24 * scale)) {
    titleFontSize -= 2;
    ctx.font = `bold ${titleFontSize}px sans-serif`;
  }

  let finalTitle = rawTitle;
  if (ctx.measureText(finalTitle).width > maxTitleWidth) {
    while (ctx.measureText(finalTitle + '...').width > maxTitleWidth && finalTitle.length > 3) {
      finalTitle = finalTitle.slice(0, -1);
    }
    finalTitle += '...';
  }

  ctx.fillStyle = t.textColor;
  const titleY = chipY + chipHeight + Math.round(55 * scale);
  ctx.fillText(finalTitle, textX, titleY);

  // 9. Short Description or Delivery Tagline
  ctx.font = `${Math.round(18 * scale)}px sans-serif`;
  ctx.fillStyle = t.textMuted;
  const descY = titleY + Math.round(34 * scale);
  const shortDesc = product.delivery_time_text || product.description || 'Instant Automated Delivery';
  const truncatedDesc = shortDesc.length > 55 ? shortDesc.slice(0, 52) + '...' : shortDesc;
  ctx.fillText(truncatedDesc, textX, descY);

  // 10. Price Badge & Compare-At Strikethrough
  const priceY = descY + Math.round(45 * scale);
  const currentPriceFormatted = formatCurrency(product.price_minor, product.currency, product.locale);

  ctx.font = `bold ${Math.round(32 * scale)}px sans-serif`;
  ctx.fillStyle = t.textColor;
  ctx.fillText(currentPriceFormatted, textX, priceY + Math.round(26 * scale));

  const currentPriceWidth = ctx.measureText(currentPriceFormatted).width;

  // Strikethrough compare-at price if on sale
  if (product.compare_at_minor && product.compare_at_minor > product.price_minor) {
    const oldPriceFormatted = formatCurrency(product.compare_at_minor, product.currency, product.locale);
    ctx.font = `${Math.round(20 * scale)}px sans-serif`;
    ctx.fillStyle = t.textMuted;
    const oldPriceX = textX + currentPriceWidth + Math.round(16 * scale);
    const oldPriceY = priceY + Math.round(24 * scale);
    ctx.fillText(oldPriceFormatted, oldPriceX, oldPriceY);

    const oldPriceWidth = ctx.measureText(oldPriceFormatted).width;
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(oldPriceX - 2, oldPriceY - 7 * scale);
    ctx.lineTo(oldPriceX + oldPriceWidth + 2, oldPriceY - 7 * scale);
    ctx.stroke();
  }

  // 11. Status Ribbon / Badge (Bottom Left)
  let statusKey = 'IN_STOCK';
  if (product.status === 'paused') {
    statusKey = 'PAUSED';
  } else if (product.stock_type !== 'unlimited' && product.stock_count <= 0) {
    statusKey = 'SOLD_OUT';
  } else if (product.stock_type !== 'unlimited' && product.stock_count <= (product.low_stock_threshold || 3)) {
    statusKey = 'LOW_STOCK';
  }

  const s = STATUS_COLORS[statusKey] || STATUS_COLORS.IN_STOCK;
  const statusX = textX;
  const statusY = priceY + Math.round(50 * scale);
  const statusText = `● ${s.label}`;
  ctx.font = `bold ${Math.round(14 * scale)}px sans-serif`;
  const statusWidth = ctx.measureText(statusText).width + Math.round(24 * scale);
  const statusHeight = Math.round(30 * scale);

  ctx.fillStyle = s.bg;
  drawRoundedRect(ctx, statusX, statusY, statusWidth, statusHeight, 6 * scale);
  ctx.fill();

  ctx.fillStyle = s.text;
  ctx.fillText(statusText, statusX + Math.round(12 * scale), statusY + Math.round(20 * scale));

  // 12. If SOLD OUT: Desaturate / dim overlay + bold SOLD OUT watermark
  if (statusKey === 'SOLD_OUT') {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.72)';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-0.1);

    ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.lineWidth = 6 * scale;
    drawRoundedRect(ctx, -200 * scale, -45 * scale, 400 * scale, 90 * scale, 12 * scale);
    ctx.stroke();

    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
    ctx.font = `bold ${Math.round(52 * scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SOLD OUT', 0, 0);
    ctx.restore();
  }

  // 13. Export PNG buffer
  const buffer = canvas.toBuffer('image/png');

  // Maintain LRU cache
  if (bannerCache.size >= MAX_CACHE_SIZE) {
    const firstKey = bannerCache.keys().next().value;
    bannerCache.delete(firstKey);
  }
  bannerCache.set(cacheKey, buffer);

  // Asynchronously sync to Supabase Storage and local cache
  syncBannerStorage(product.id, cacheKey, buffer).catch(() => {});

  return buffer;
}

/**
 * Draws a rounded rectangle helper
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Asynchronous background sync to Supabase Storage 'shop-banners' bucket
 */
async function syncBannerStorage(productId, hash, buffer) {
  try {
    const filePath = `banners/${productId || 'temp'}_${hash.slice(0, 8)}.png`;
    await db.storage.from('shop-banners').upload(filePath, buffer, {
      contentType: 'image/png',
      upsert: true
    });
  } catch (_) {}
}

/**
 * Clean SVG fallback generator if canvas is unavailable
 */
function generateSvgFallback({ product, theme, width, height, categoryName, shopName }) {
  const t = getTheme(theme);
  const formattedPrice = formatCurrency(product.price_minor, product.currency, product.locale);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${t.bgStart}"/>
        <stop offset="100%" stop-color="${t.bgEnd}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect x="15" y="15" width="${width - 30}" height="${height - 30}" fill="none" stroke="${t.cardBorder}" stroke-width="2"/>
    <text x="40" y="60" font-family="sans-serif" font-size="14" font-weight="bold" fill="${t.accent}">${categoryName.toUpperCase()}</text>
    <text x="${width - 40}" y="60" font-family="sans-serif" font-size="14" font-weight="bold" fill="${t.textMuted}" text-anchor="end">${shopName.toUpperCase()}</text>
    <text x="40" y="140" font-family="sans-serif" font-size="38" font-weight="bold" fill="${t.textColor}">${product.name || 'Product'}</text>
    <text x="40" y="180" font-family="sans-serif" font-size="18" fill="${t.textMuted}">${product.delivery_time_text || 'Instant Delivery'}</text>
    <text x="40" y="240" font-family="sans-serif" font-size="32" font-weight="bold" fill="${t.textColor}">${formattedPrice}</text>
  </svg>`;

  return Buffer.from(svg, 'utf-8');
}

export default {
  renderBanner,
  getBannerCacheKey
};

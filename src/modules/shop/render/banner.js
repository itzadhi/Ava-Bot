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
export function getBannerCacheKey({ product, theme = 'dark', shopName = 'Store', compact = false }) {
  const raw = `${product.id || 'new'}:${product.version || 1}:${theme}:${product.name}:${product.price_minor}:${product.compare_at_minor}:${product.stock_count}:${product.status}:${product.banner_hash || 'none'}:${compact}`;
  return crypto.createHash('md5').update(raw).digest('hex');
}

/**
 * Renders a high-resolution, branded product banner image buffer
 *
 * @param {object} params
 * @param {object} params.product Product record
 * @param {string} [params.theme='dark'] dark, light, neon, minimal
 * @param {string} [params.categoryName='Products'] Category name
 * @param {string} [params.shopName='Store'] Server / Shop name
 * @param {boolean} [params.compact=false] If true, renders 800x240; else 1200x400
 * @param {Buffer|string} [params.productImage=null] Optional product image buffer or Discord CDN URL
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function renderBanner({
  product,
  theme = 'dark',
  categoryName = 'Products',
  shopName = 'Store',
  compact = false,
  productImage = null
}) {
  const cleanShopName = (shopName && shopName !== 'Argoni Store') ? shopName : 'Store';
  const cacheKey = getBannerCacheKey({ product, theme, shopName: cleanShopName, compact });
  if (bannerCache.has(cacheKey)) {
    return bannerCache.get(cacheKey);
  }

  const width = compact ? 800 : 1200;
  const height = compact ? 240 : 400;
  const scale = compact ? 0.67 : 1.0;

  if (!isCanvasAvailable()) {
    logger.warn('Canvas not available, generating minimal SVG fallback banner');
    return generateSvgFallback({ product, theme, width, height, categoryName, shopName: cleanShopName });
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const t = getTheme(theme);

  // 1. Deep Luxury Background Gradient
  const grad = ctx.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, t.bgStart);
  grad.addColorStop(1, t.bgEnd);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // 2. Subtle Geometric Dot Grid Pattern (Atmospheric texture)
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

  // 3. Multi-Layered Ambient Glow Highlights
  const glow1 = ctx.createRadialGradient(
    width * 0.85, height * 0.3, 10,
    width * 0.85, height * 0.3, 400 * scale
  );
  glow1.addColorStop(0, t.accentGlow);
  glow1.addColorStop(0.6, 'rgba(99, 102, 241, 0.08)');
  glow1.addColorStop(1, 'transparent');
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, width, height);

  const glow2 = ctx.createRadialGradient(
    width * 0.15, height * 0.85, 10,
    width * 0.15, height * 0.85, 300 * scale
  );
  glow2.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
  glow2.addColorStop(1, 'transparent');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, width, height);

  // 4. Subtle Outer Border Accent
  ctx.strokeStyle = t.cardBorder;
  ctx.lineWidth = Math.round(1.5 * scale);
  drawRoundedRect(ctx, 12, 12, width - 24, height - 24, 12 * scale);
  ctx.stroke();

  // 5. Category Chip (Top Left)
  const chipX = Math.round(44 * scale);
  const chipY = Math.round(40 * scale);
  const chipText = categoryName.toUpperCase();
  ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
  const chipTextWidth = ctx.measureText(chipText).width;
  const chipWidth = chipTextWidth + Math.round(28 * scale);
  const chipHeight = Math.round(28 * scale);

  ctx.fillStyle = t.badgeBg;
  drawRoundedRect(ctx, chipX, chipY, chipWidth, chipHeight, 14 * scale);
  ctx.fill();
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = t.accent;
  ctx.fillText(chipText, chipX + Math.round(14 * scale), chipY + Math.round(19 * scale));

  // 6. Shop Watermark / Server Name (Top Right)
  ctx.font = `bold ${Math.round(14 * scale)}px sans-serif`;
  ctx.fillStyle = t.textMuted;
  ctx.textAlign = 'right';
  ctx.fillText(cleanShopName.toUpperCase(), width - Math.round(44 * scale), chipY + Math.round(19 * scale));
  ctx.textAlign = 'left';

  // 7. Right Side Visual Composition (Image OR Sleek Geometric Accent)
  let imgLoaded = false;
  const imgBoxSize = Math.round(220 * scale);
  const imgBoxX = width - imgBoxSize - Math.round(50 * scale);
  const imgBoxY = Math.round(95 * scale);

  if (productImage) {
    try {
      let imgSource = productImage;
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
        drawRoundedRect(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, 20 * scale);
        ctx.clip();
        ctx.drawImage(loadedImg, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize);
        ctx.restore();

        // High-end glassmorphic border around image
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = Math.round(2 * scale);
        drawRoundedRect(ctx, imgBoxX, imgBoxY, imgBoxSize, imgBoxSize, 20 * scale);
        ctx.stroke();
        imgLoaded = true;
      }
    } catch (imgErr) {
      logger.debug({ err: imgErr.message }, 'Could not render custom product image in banner');
    }
  }

  // IF NO CUSTOM IMAGE: Render modern abstract neon concentric rings (NO ugly placeholder box!)
  if (!imgLoaded) {
    ctx.save();
    const centerX = width - Math.round(150 * scale);
    const centerY = height * 0.52;

    // Outer subtle ring
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.15)';
    ctx.lineWidth = Math.round(2 * scale);
    ctx.beginPath();
    ctx.arc(centerX, centerY, 120 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Middle accented ring
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.35)';
    ctx.lineWidth = Math.round(2.5 * scale);
    ctx.beginPath();
    ctx.arc(centerX, centerY, 80 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // Inner glowing core
    const coreGrad = ctx.createRadialGradient(centerX, centerY, 5, centerX, centerY, 45 * scale);
    coreGrad.addColorStop(0, 'rgba(99, 102, 241, 0.5)');
    coreGrad.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 45 * scale, 0, Math.PI * 2);
    ctx.fill();

    // Decorative floating nodes
    ctx.fillStyle = t.accent;
    const angles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
    for (const angle of angles) {
      const nodeX = centerX + Math.cos(angle) * 80 * scale;
      const nodeY = centerY + Math.sin(angle) * 80 * scale;
      ctx.beginPath();
      ctx.arc(nodeX, nodeY, 4 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 8. Product Title Header with generous width & clean auto-fit
  const textX = chipX;
  const maxTitleWidth = imgLoaded
    ? (imgBoxX - textX - Math.round(30 * scale))
    : (width - textX - Math.round(260 * scale));

  const rawTitle = (product.name || 'Product').trim();
  let titleFontSize = Math.round(44 * scale);
  ctx.font = `bold ${titleFontSize}px sans-serif`;

  while (ctx.measureText(rawTitle).width > maxTitleWidth && titleFontSize > Math.round(22 * scale)) {
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

  // Draw Title with subtle depth
  ctx.fillStyle = t.textColor;
  const titleY = chipY + chipHeight + Math.round(52 * scale);
  ctx.fillText(finalTitle, textX, titleY);

  // 9. Short Tagline / Delivery Guarantee
  ctx.font = `${Math.round(17 * scale)}px sans-serif`;
  ctx.fillStyle = t.textMuted;
  const descY = titleY + Math.round(30 * scale);
  const shortDesc = product.delivery_time_text || product.description || 'Instant Automated Delivery';
  const truncatedDesc = shortDesc.length > 60 ? shortDesc.slice(0, 57) + '...' : shortDesc;
  ctx.fillText(truncatedDesc, textX, descY);

  // 10. Price Display & Compare-At
  const priceY = descY + Math.round(42 * scale);
  const currentPriceFormatted = formatCurrency(product.price_minor, product.currency, product.locale);

  // High-End Price Pill Container
  ctx.font = `bold ${Math.round(34 * scale)}px sans-serif`;
  const priceTextWidth = ctx.measureText(currentPriceFormatted).width;

  ctx.fillStyle = t.textColor;
  ctx.fillText(currentPriceFormatted, textX, priceY + Math.round(26 * scale));

  // Strikethrough compare-at price if on sale
  if (product.compare_at_minor && product.compare_at_minor > product.price_minor) {
    const oldPriceFormatted = formatCurrency(product.compare_at_minor, product.currency, product.locale);
    ctx.font = `${Math.round(20 * scale)}px sans-serif`;
    ctx.fillStyle = t.textMuted;
    const oldPriceX = textX + priceTextWidth + Math.round(18 * scale);
    const oldPriceY = priceY + Math.round(25 * scale);
    ctx.fillText(oldPriceFormatted, oldPriceX, oldPriceY);

    const oldPriceWidth = ctx.measureText(oldPriceFormatted).width;
    ctx.strokeStyle = '#EF4444';
    ctx.lineWidth = 2 * scale;
    ctx.beginPath();
    ctx.moveTo(oldPriceX - 2, oldPriceY - 7 * scale);
    ctx.lineTo(oldPriceX + oldPriceWidth + 2, oldPriceY - 7 * scale);
    ctx.stroke();
  }

  // 11. Stock Ribbon Badge (Bottom Left)
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
  const statusY = priceY + Math.round(48 * scale);
  const statusText = `● ${s.label}`;
  ctx.font = `bold ${Math.round(13 * scale)}px sans-serif`;
  const statusWidth = ctx.measureText(statusText).width + Math.round(26 * scale);
  const statusHeight = Math.round(28 * scale);

  ctx.fillStyle = s.bg;
  drawRoundedRect(ctx, statusX, statusY, statusWidth, statusHeight, 14 * scale);
  ctx.fill();

  ctx.fillStyle = s.text;
  ctx.fillText(statusText, statusX + Math.round(13 * scale), statusY + Math.round(19 * scale));

  // 12. If SOLD OUT: Sleek subtle diagonal banner overlay
  if (statusKey === 'SOLD_OUT') {
    ctx.fillStyle = 'rgba(10, 10, 15, 0.65)';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-0.08);

    ctx.fillStyle = 'rgba(220, 38, 38, 0.95)';
    drawRoundedRect(ctx, -180 * scale, -36 * scale, 360 * scale, 72 * scale, 12 * scale);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2 * scale;
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    ctx.font = `bold ${Math.round(36 * scale)}px sans-serif`;
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

  // Asynchronously sync to Supabase Storage
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
    <rect x="15" y="15" width="${width - 30}" height="${height - 30}" fill="none" stroke="${t.cardBorder}" stroke-width="2" rx="10"/>
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

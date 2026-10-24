import { safeRenderBanner, getBannerHash, generateSvgFallback } from '../../../core/canvas/safeBanner.js';

/**
 * Computes a deterministic cache key for a banner
 */
export function getBannerCacheKey({ product, theme = 'dark', shopName = 'Store', compact = false }) {
  return getBannerHash({ product, theme, shopName, compact });
}

/**
 * Renders a high-resolution, branded product banner image buffer
 * Guarantees zero crashes and zero user-facing error text via safeRenderBanner.
 *
 * @param {object} params
 * @param {object} params.product Product record
 * @param {string} [params.theme='dark'] dark | light | neon | minimal | ava
 * @param {string} [params.categoryName='Products'] Category name
 * @param {string} [params.shopName='Store'] Server / Shop name
 * @param {boolean} [params.compact=false] If true, renders 800x240; else 1200x400
 * @param {Buffer|string} [params.productImage=null] Optional product image buffer or Discord CDN URL
 * @returns {Promise<Buffer>} PNG or SVG image buffer
 */
export async function renderBanner({
  product,
  theme = 'dark',
  categoryName = 'Products',
  shopName = 'Store',
  compact = false,
  productImage = null
}) {
  const result = await safeRenderBanner({
    product,
    theme,
    categoryName,
    shopName,
    compact,
    imageUrl: typeof productImage === 'string' ? productImage : null
  });

  return result.buffer;
}

export { generateSvgFallback, safeRenderBanner };
export default {
  renderBanner,
  getBannerCacheKey,
  safeRenderBanner,
  generateSvgFallback
};

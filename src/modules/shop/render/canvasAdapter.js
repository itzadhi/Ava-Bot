import { logger } from '../../../utils/logger.js';

let canvasModule = null;
let providerName = 'none';

try {
  const napi = await import('@napi-rs/canvas');
  if (typeof napi.createCanvas === 'function') {
    canvasModule = napi;
    providerName = '@napi-rs/canvas';
  }
} catch (_) {
  // @napi-rs/canvas unavailable or blocked by OS AppLocker
}

if (!canvasModule) {
  logger.warn('Prebuilt @napi-rs/canvas not available; graphics engine will operate in pure SVG/text fallback mode');
}

logger.info(`[CANVAS] Graphics engine initialized using provider: "${providerName}"`);

export function getCanvasProvider() {
  return providerName;
}

export function isCanvasAvailable() {
  return canvasModule !== null && typeof canvasModule.createCanvas === 'function';
}

export function createCanvas(width, height) {
  if (!isCanvasAvailable()) {
    throw new Error('CANVAS_UNAVAILABLE: No compatible canvas library installed or loaded');
  }
  return canvasModule.createCanvas(width, height);
}

export async function loadImage(source) {
  if (!isCanvasAvailable() || typeof canvasModule.loadImage !== 'function') {
    throw new Error('CANVAS_UNAVAILABLE: loadImage is not available');
  }
  return canvasModule.loadImage(source);
}

export function registerFont(fontPath, options) {
  if (canvasModule && typeof canvasModule.registerFont === 'function') {
    try {
      canvasModule.registerFont(fontPath, options);
    } catch (_) {}
  } else if (canvasModule && typeof canvasModule.GlobalFonts?.registerFromPath === 'function') {
    try {
      canvasModule.GlobalFonts.registerFromPath(fontPath, options?.family);
    } catch (_) {}
  }
}

export default {
  createCanvas,
  loadImage,
  registerFont,
  isCanvasAvailable,
  getCanvasProvider
};

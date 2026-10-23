import { releaseExpiredOrders } from '../db.js';
import { logger } from '../../../utils/logger.js';

let expiryJobInterval = null;

/**
 * Starts the shop order reservation expiry sweeper
 * Runs every 2 minutes to release unpaid reservations and restore stock.
 * @param {import('discord.js').Client} client
 */
export function startShopExpiryJob(client) {
  if (expiryJobInterval) {
    clearInterval(expiryJobInterval);
  }

  // Run on startup
  runExpiryCheck(client);

  // Sweep every 2 minutes
  expiryJobInterval = setInterval(() => {
    runExpiryCheck(client);
  }, 2 * 60 * 1000);

  if (expiryJobInterval.unref) {
    expiryJobInterval.unref();
  }

  logger.info('[SHOP] Order reservation expiry job started (2-minute interval)');
}

async function runExpiryCheck(client) {
  try {
    const res = await releaseExpiredOrders();
    if (res?.released_orders > 0) {
      logger.info({ releasedOrders: res.released_orders }, '[SHOP] Released expired unpaid reservations and restored stock');
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Shop expiry check error');
  }
}

/**
 * Clears the expiry job on bot shutdown
 */
export function stopShopExpiryJob() {
  if (expiryJobInterval) {
    clearInterval(expiryJobInterval);
    expiryJobInterval = null;
    logger.info('[SHOP] Order reservation expiry job stopped');
  }
}

export default {
  startShopExpiryJob,
  stopShopExpiryJob
};

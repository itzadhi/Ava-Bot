/**
 * Premium Middleware - No Paywall
 * All features, backups, and capabilities are 100% unlocked for server owners.
 */
export async function checkPremiumLimits(ctx, command) {
  return { ok: true };
}

export default checkPremiumLimits;

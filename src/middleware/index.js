import { checkBlacklist } from './blacklist.js';
import { checkMaintenance } from './maintenance.js';
import { checkDisabledCommand } from './disabled.js';
import { checkPermissions } from './permissions.js';
import { checkPremiumLimits } from './premium.js';
import { checkCooldown } from './cooldown.js';

export async function runMiddlewareChain(ctx, command) {
  const steps = [
    checkBlacklist,
    checkMaintenance,
    checkDisabledCommand,
    checkPermissions,
    checkPremiumLimits,
    checkCooldown
  ];

  for (const step of steps) {
    const result = await step(ctx, command);
    if (!result || result.ok === false) {
      return false;
    }
  }

  return true;
}

export * from './blacklist.js';
export * from './maintenance.js';
export * from './disabled.js';
export * from './permissions.js';
export * from './premium.js';
export * from './cooldown.js';

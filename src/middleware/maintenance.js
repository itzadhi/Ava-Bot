import { isMaintenanceActive, getMaintenanceMessage } from '../db/botState.js';
import { config } from '../config.js';
import { warnCard } from '../ui/cards.js';

export async function checkMaintenance(ctx, command) {
  // Owners bypass maintenance
  if (config.OWNER_IDS.includes(ctx.user.id)) {
    return { ok: true };
  }

  if (isMaintenanceActive()) {
    const payload = warnCard({
      title: 'Under Maintenance',
      subtitle: 'System is temporarily paused for updates.',
      body: getMaintenanceMessage(),
      subtext: 'Check support server for updates',
      ephemeral: true
    });
    await ctx.reply(payload);
    return { ok: false };
  }

  return { ok: true };
}

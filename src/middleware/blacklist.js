import { isBlacklisted } from '../db/blacklist.js';
import { config } from '../config.js';
import { errorCard } from '../ui/cards.js';

export async function checkBlacklist(ctx, command) {
  // Owners bypass blacklist check
  if (config.OWNER_IDS.includes(ctx.user.id)) {
    return { ok: true };
  }

  const result = isBlacklisted(ctx.user.id, ctx.guild?.id);
  if (result.blacklisted) {
    if (ctx.isSlash) {
      const payload = errorCard({
        title: 'Access Denied',
        reason: result.type === 'user' 
          ? 'Your account has been restricted from accessing AVA.'
          : 'This guild has been blacklisted from using AVA.',
        fix: 'Contact AVA Support if you believe this is in error.',
        ephemeral: true
      });
      await ctx.reply(payload);
    }
    // Prefix ignores blacklisted users silently
    return { ok: false };
  }

  return { ok: true };
}

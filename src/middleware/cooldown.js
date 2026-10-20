import { config } from '../config.js';
import { warnCard } from '../ui/cards.js';

// Map of commandKey -> Map of (userId/guildId -> expirationTimestamp)
const cooldowns = new Map();

export async function checkCooldown(ctx, command) {
  // Bot owners bypass cooldowns
  if (config.OWNER_IDS.includes(ctx.user.id)) {
    return { ok: true };
  }

  const cooldownSeconds = command.cooldown || 3;
  if (cooldownSeconds <= 0) return { ok: true };

  const key = command.name;
  if (!cooldowns.has(key)) {
    cooldowns.set(key, new Map());
  }

  const timestamps = cooldowns.get(key);
  const now = Date.now();
  const cooldownAmount = cooldownSeconds * 1000;

  // Use user id or guild id depending on scope
  const identifier = command.guildCooldown ? (ctx.guild?.id || ctx.user.id) : ctx.user.id;

  if (timestamps.has(identifier)) {
    const expirationTime = timestamps.get(identifier) + cooldownAmount;
    if (now < expirationTime) {
      const timeLeft = Math.ceil((expirationTime - now) / 1000);
      await ctx.reply(warnCard({
        title: 'Cooldown Active',
        subtitle: `Please wait before running /${command.name} again.`,
        body: `**Remaining Time**: ${timeLeft} second${timeLeft > 1 ? 's' : ''}`,
        subtext: 'Argoni rate limiter',
        ephemeral: true
      }));
      return { ok: false };
    }
  }

  timestamps.set(identifier, now);
  setTimeout(() => timestamps.delete(identifier), cooldownAmount);

  return { ok: true };
}

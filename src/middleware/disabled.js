import { isCommandDisabled, getCommandDisableReason } from '../db/botState.js';
import { config } from '../config.js';
import { errorCard } from '../ui/cards.js';

export async function checkDisabledCommand(ctx, command) {
  // Owners bypass disabled check
  if (config.OWNER_IDS.includes(ctx.user.id)) {
    return { ok: true };
  }

  if (isCommandDisabled(command.name)) {
    const reason = getCommandDisableReason(command.name);
    const payload = errorCard({
      title: 'Command Disabled',
      subtitle: `/${command.name} is currently unavailable.`,
      reason,
      fix: 'Please wait until the administration re-enables this command.',
      ephemeral: true
    });
    await ctx.reply(payload);
    return { ok: false };
  }

  return { ok: true };
}

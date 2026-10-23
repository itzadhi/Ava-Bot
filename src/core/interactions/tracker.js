/**
 * Global interaction acknowledgement tracker
 * Uses WeakSet and WeakMap to guarantee interactions are never acknowledged twice,
 * preventing Discord Error 40060 (Interaction has already been acknowledged).
 */

const acknowledgedInteractions = new WeakSet();
const interactionMetadata = new WeakMap();

/**
 * Checks if an interaction has already been acknowledged either through
 * the tracker or through Discord.js internal state flags.
 * @param {import('discord.js').Interaction} interaction
 * @returns {boolean}
 */
export function isAcknowledged(interaction) {
  if (!interaction) return true;
  return (
    acknowledgedInteractions.has(interaction) ||
    Boolean(interaction.deferred) ||
    Boolean(interaction.replied)
  );
}

/**
 * Marks an interaction as acknowledged with timing and method details.
 * @param {import('discord.js').Interaction} interaction
 * @param {string} [method='unknown'] Method used ('deferReply', 'deferUpdate', 'reply', 'update', 'showModal')
 * @returns {boolean} True if successfully marked, false if it was already marked
 */
export function markAcknowledged(interaction, method = 'unknown') {
  if (!interaction) return false;
  if (isAcknowledged(interaction)) {
    return false;
  }

  acknowledgedInteractions.add(interaction);
  interactionMetadata.set(interaction, {
    acknowledgedAt: Date.now(),
    method
  });
  return true;
}

/**
 * Retrieves metadata for an acknowledged interaction
 * @param {import('discord.js').Interaction} interaction
 * @returns {{ acknowledgedAt: number, method: string }|null}
 */
export function getInteractionMeta(interaction) {
  if (!interaction) return null;
  return interactionMetadata.get(interaction) || null;
}

export default {
  isAcknowledged,
  markAcknowledged,
  getInteractionMeta
};

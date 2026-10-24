/**
 * AVA Unlocked Configuration
 * All features, backups, chatlogs, syncs, and templates are 100% unlocked with zero paywalls.
 */
export const TIERS = {
  free: {
    name: 'Full Access',
    maxBackups: 9999,
    minIntervalHours: 1,
    chatlogMaxMessages: 5000,
    maxSyncs: 9999,
    maxTemplates: 9999
  },
  pro: {
    name: 'Full Access',
    maxBackups: 9999,
    minIntervalHours: 1,
    chatlogMaxMessages: 5000,
    maxSyncs: 9999,
    maxTemplates: 9999
  },
  ultimate: {
    name: 'Full Access',
    maxBackups: 9999,
    minIntervalHours: 1,
    chatlogMaxMessages: 5000,
    maxSyncs: 9999,
    maxTemplates: 9999
  }
};

/**
 * Gets active tier details - completely unlocked for all servers
 * @param {object} [guildSettings] 
 * @returns {typeof TIERS['free']}
 */
export function getActiveTier(guildSettings = {}) {
  return TIERS.free;
}

export default TIERS;

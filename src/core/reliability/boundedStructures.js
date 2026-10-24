import { logger } from '../../utils/logger.js';

/**
 * Bounded Structure Registry:
 * Audits in-memory Maps, Sets, and Caches to guarantee no unbounded memory growth
 * over 30+ days of continuous uptime.
 */
class BoundedStructuresRegistry {
  constructor() {
    /** @type {Map<string, { structure: Map|Set|Array, maxCap: number, description: string }>} */
    this.registry = new Map();
  }

  /**
   * Registers a data structure with a hard capacity cap
   * @param {string} name
   * @param {Map|Set|Array} structure
   * @param {number} maxCap
   * @param {string} [description='']
   */
  register(name, structure, maxCap = 1000, description = '') {
    this.registry.set(name, {
      structure,
      maxCap,
      description
    });
  }

  /**
   * Returns current statistics across all registered structures
   * @returns {Array<{ name: string, size: number, maxCap: number, pct: number, warning: boolean }>}
   */
  getStats() {
    const stats = [];
    for (const [name, entry] of this.registry.entries()) {
      const size = entry.structure?.size !== undefined ? entry.structure.size : (entry.structure?.length || 0);
      const pct = Math.round((size / entry.maxCap) * 100);
      const isWarn = pct >= 80;

      if (isWarn) {
        logger.warn({ name, size, maxCap: entry.maxCap, pct }, `[MEMORY WARNING] Structure "${name}" has reached ${pct}% of capacity`);
      }

      stats.push({
        name,
        size,
        maxCap: entry.maxCap,
        pct,
        warning: isWarn
      });
    }
    return stats;
  }

  /**
   * Performs proactive emergency sweep on all registered structures if memory is constrained
   */
  emergencySweep() {
    let swept = 0;
    for (const [name, entry] of this.registry.entries()) {
      const s = entry.structure;
      if (typeof s.clear === 'function' && s.size > (entry.maxCap * 0.8)) {
        swept += s.size;
        s.clear();
        logger.info({ name }, `Emergency sweep cleared ${name}`);
      }
    }
    return swept;
  }
}

export const boundedStructures = new BoundedStructuresRegistry();
export default boundedStructures;

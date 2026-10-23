import os from 'node:os';
import { logger } from '../utils/logger.js';
import { db } from '../db/client.js';

class InstanceManager {
  constructor() {
    this.instanceId = `inst_${os.hostname()}_${process.pid}_${Date.now().toString(36)}`;
    this.hostname = os.hostname();
    this.pid = process.pid;
    this.startedAt = new Date().toISOString();
    this.heartbeatTimer = null;
    this.otherInstancesCount = 0;
    this.conflictingInstances = [];
  }

  /**
   * Starts the 10-second heartbeat to Supabase bot_instances table.
   */
  startHeartbeat() {
    this.writeHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.writeHeartbeat();
    }, 10000);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }

    // Cleanup on process exit
    const cleanup = () => this.stopHeartbeat();
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    process.once('beforeExit', cleanup);
  }

  async writeHeartbeat() {
    try {
      const now = new Date().toISOString();
      // Upsert heartbeat record
      const { error: upsertErr } = await db
        .from('bot_instances')
        .upsert({
          instance_id: this.instanceId,
          host: this.hostname,
          pid: this.pid,
          started_at: this.startedAt,
          last_seen: now
        }, { onConflict: 'instance_id' });

      if (upsertErr) {
        // Table might not exist yet if SQL migration is pending
        return;
      }

      // Check for other live instances (last_seen within 30s)
      const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
      const { data: liveInstances, error: queryErr } = await db
        .from('bot_instances')
        .select('instance_id, host, pid, started_at, last_seen')
        .gt('last_seen', thirtySecAgo)
        .neq('instance_id', this.instanceId);

      if (!queryErr && Array.isArray(liveInstances)) {
        this.otherInstancesCount = liveInstances.length;
        this.conflictingInstances = liveInstances;
        if (liveInstances.length > 0) {
          logger.error({
            currentInstance: this.instanceId,
            conflictingInstances: liveInstances
          }, '🚨 MULTIPLE BOT INSTANCES DETECTED RUNNING SIMULTANEOUSLY! Another bot instance is active with the same token! This causes random interaction failures.');
        }
      }
    } catch (_) {
      // Non-fatal, suppress if Supabase is offline
    }
  }

  async stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      await db.from('bot_instances').delete().eq('instance_id', this.instanceId);
      logger.info({ instanceId: this.instanceId }, 'Instance heartbeat cleaned up gracefully');
    } catch (_) {}
  }

  getInstanceCount() {
    return 1 + this.otherInstancesCount;
  }

  getStatus() {
    return {
      instanceId: this.instanceId,
      host: this.hostname,
      pid: this.pid,
      startedAt: this.startedAt,
      runningCount: 1 + this.otherInstancesCount,
      conflicts: this.conflictingInstances
    };
  }
}

export const instanceManager = new InstanceManager();
export default instanceManager;

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { logger } from '../utils/logger.js';
import { guildSettingsCache } from './cache/guildCache.js';
import { sessionStore } from './interactions/session.js';

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();

    // Rolling latencies (last 1000 items)
    this.ackLatencies = [];
    this.handlerLatencies = [];
    this.dbLatencies = [];
    this.slowestDbQuery = { name: 'none', durationMs: 0 };

    // Interactions in sliding 60-second window
    this.recentInteractions = [];

    // Hourly error counters: code -> timestamps array
    this.errorCounts = new Map([
      ['10062', []],
      ['40060', []],
      ['50027', []],
      ['429', []],
      ['other', []]
    ]);

    // Check event loop lag every 10s
    this.lagCheckTimer = setInterval(() => {
      const p95LagMs = this.histogram.percentile(95) / 1e6;
      if (p95LagMs > 100) {
        logger.warn({ p95LagMs: Math.round(p95LagMs) }, '⚠️ High event loop lag detected (>100ms)');
      }
    }, 10000);

    if (this.lagCheckTimer.unref) {
      this.lagCheckTimer.unref();
    }
  }

  recordAck(durationMs) {
    if (durationMs > 2000) {
      logger.warn({ durationMs: Math.round(durationMs) }, '⚠️ Slow interaction acknowledgement (>2.0s)');
    }
    this.ackLatencies.push(durationMs);
    if (this.ackLatencies.length > 1000) this.ackLatencies.shift();

    const now = Date.now();
    this.recentInteractions.push(now);
    this.cleanRecentInteractions(now);
  }

  recordHandler(durationMs) {
    this.handlerLatencies.push(durationMs);
    if (this.handlerLatencies.length > 1000) this.handlerLatencies.shift();
  }

  recordDbQuery(name, durationMs) {
    this.dbLatencies.push(durationMs);
    if (this.dbLatencies.length > 1000) this.dbLatencies.shift();

    if (durationMs > this.slowestDbQuery.durationMs) {
      this.slowestDbQuery = { name, durationMs: Math.round(durationMs) };
    }
  }

  recordError(code) {
    const key = ['10062', '40060', '50027', '429'].includes(String(code)) ? String(code) : 'other';
    const now = Date.now();
    if (!this.errorCounts.has(key)) {
      this.errorCounts.set(key, []);
    }
    this.errorCounts.get(key).push(now);
  }

  cleanRecentInteractions(now = Date.now()) {
    const cutoff = now - 60000;
    while (this.recentInteractions.length > 0 && this.recentInteractions[0] < cutoff) {
      this.recentInteractions.shift();
    }
  }

  getErrorCountLastHour(code) {
    const list = this.errorCounts.get(String(code)) || [];
    const oneHourAgo = Date.now() - 3600000;
    return list.filter(ts => ts > oneHourAgo).length;
  }

  getPercentile(arr, p) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  getAverage(arr) {
    if (arr.length === 0) return 0;
    const sum = arr.reduce((acc, val) => acc + val, 0);
    return sum / arr.length;
  }

  getSnapshot(client) {
    const now = Date.now();
    this.cleanRecentInteractions(now);

    const mem = process.memoryUsage();
    const wsPing = client?.ws?.ping !== undefined ? Math.round(client.ws.ping) : -1;
    const uptimeSec = Math.floor((now - this.startTime) / 1000);
    const guildCount = client?.guilds?.cache?.size || 0;

    return {
      wsPing: wsPing >= 0 ? `${wsPing} ms` : 'N/A',
      uptime: `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m ${uptimeSec % 60}s`,
      guilds: guildCount,
      interactionsPerMin: this.recentInteractions.length,
      ackTime: {
        avg: `${this.getAverage(this.ackLatencies).toFixed(1)} ms`,
        p95: `${this.getPercentile(this.ackLatencies, 95).toFixed(1)} ms`
      },
      handlerTime: {
        avg: `${this.getAverage(this.handlerLatencies).toFixed(1)} ms`,
        p95: `${this.getPercentile(this.handlerLatencies, 95).toFixed(1)} ms`
      },
      dbQueries: {
        avg: `${this.getAverage(this.dbLatencies).toFixed(1)} ms`,
        slowest: `${this.slowestDbQuery.name} (${this.slowestDbQuery.durationMs} ms)`
      },
      eventLoopLag: {
        p50: `${(this.histogram.percentile(50) / 1e6).toFixed(2)} ms`,
        p95: `${(this.histogram.percentile(95) / 1e6).toFixed(2)} ms`,
        max: `${(this.histogram.max / 1e6).toFixed(2)} ms`
      },
      memory: {
        rss: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,
        heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,
        heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`
      },
      cacheSizes: {
        guildSettings: guildSettingsCache.size,
        activeSessions: sessionStore.sessions.size
      },
      errorsLastHour: {
        unknownInteraction10062: this.getErrorCountLastHour('10062'),
        alreadyAcknowledged40060: this.getErrorCountLastHour('40060'),
        invalidWebhook50027: this.getErrorCountLastHour('50027'),
        rateLimit429: this.getErrorCountLastHour('429'),
        other: this.getErrorCountLastHour('other')
      }
    };
  }
}

export const metrics = new MetricsCollector();
export default metrics;

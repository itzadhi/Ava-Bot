import { AsyncLocalStorage } from 'node:async_hooks';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { logger } from '../../utils/logger.js';

export const traceStorage = new AsyncLocalStorage();

// Event loop delay monitor with 20ms resolution
let eld = null;
try {
  eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
} catch (_) {}

/**
 * Returns current event loop lag in milliseconds (p95 or mean)
 * @returns {number}
 */
export function getEventLoopLagMs() {
  if (!eld) return 0;
  // Convert nanoseconds to milliseconds
  const p95Ns = eld.percentile(95);
  return Math.round((p95Ns / 1e6) * 10) / 10;
}

/**
 * Creates and enters an interaction trace context
 * @param {object} baseInfo
 * @param {Function} fn
 * @returns {Promise<any>}
 */
export function runWithTrace(baseInfo, fn) {
  const trace = {
    id: baseInfo.id || null,
    identifier: baseInfo.identifier || 'unknown',
    startTime: performance.now(),
    ackMs: 0,
    db: { count: 0, totalMs: 0, calls: [] },
    rest: { count: 0, totalMs: 0, calls: [], rateLimitedCount: 0 },
    fetch: { count: 0, totalMs: 0, calls: [] },
    buildMs: 0,
    canvasMs: 0,
    spans: [],
    metadata: { ...baseInfo }
  };

  return traceStorage.run(trace, fn);
}

/**
 * Retrieves the currently active trace, if any
 * @returns {object|null}
 */
export function getCurrentTrace() {
  return traceStorage.getStore() || null;
}

/**
 * Records an arbitrary named span inside the current trace
 * @param {string} name
 * @param {number} durationMs
 * @param {object} [details={}]
 */
export function recordSpan(name, durationMs, details = {}) {
  const trace = getCurrentTrace();
  if (!trace) return;
  trace.spans.push({
    name,
    durationMs: Math.round(durationMs * 10) / 10,
    details
  });
}

/**
 * Records a database operation span
 * @param {string} table
 * @param {string} operation
 * @param {number} durationMs
 */
export function recordDbCall(table, operation, durationMs) {
  const trace = getCurrentTrace();
  if (!trace) return;
  const ms = Math.round(durationMs * 10) / 10;
  trace.db.count++;
  trace.db.totalMs += ms;
  trace.db.calls.push({ table, operation, durationMs: ms });
  recordSpan(`db:${table}:${operation}`, ms);
}

/**
 * Records a Discord REST call span
 * @param {string} route
 * @param {number} durationMs
 * @param {boolean} [waitedRateLimit=false]
 */
export function recordRestCall(route, durationMs, waitedRateLimit = false) {
  const trace = getCurrentTrace();
  if (!trace) return;
  const ms = Math.round(durationMs * 10) / 10;
  trace.rest.count++;
  trace.rest.totalMs += ms;
  if (waitedRateLimit) trace.rest.rateLimitedCount++;
  trace.rest.calls.push({ route, durationMs: ms, waitedRateLimit });
  recordSpan(`rest:${route}`, ms, { waitedRateLimit });
}

/**
 * Records an entity fetch span (members, channels, audit log, etc.)
 * @param {string} target
 * @param {number} durationMs
 */
export function recordFetchCall(target, durationMs) {
  const trace = getCurrentTrace();
  if (!trace) return;
  const ms = Math.round(durationMs * 10) / 10;
  trace.fetch.count++;
  trace.fetch.totalMs += ms;
  trace.fetch.calls.push({ target, durationMs: ms });
  recordSpan(`fetch:${target}`, ms);
}

/**
 * Records payload build duration
 * @param {number} durationMs
 */
export function recordBuildDuration(durationMs) {
  const trace = getCurrentTrace();
  if (!trace) return;
  trace.buildMs += Math.round(durationMs * 10) / 10;
  recordSpan('payload:build', durationMs);
}

/**
 * Sets initial acknowledgement duration
 * @param {number} durationMs
 */
export function setAckDuration(durationMs) {
  const trace = getCurrentTrace();
  if (!trace) return;
  trace.ackMs = Math.round(durationMs * 10) / 10;
  recordSpan('ack', trace.ackMs);
}

/**
 * Sets visible first response duration
 * @param {number} durationMs
 */
export function setFirstResponseDuration(durationMs) {
  const trace = getCurrentTrace();
  if (!trace) return;
  trace.firstResponseMs = Math.round(durationMs * 10) / 10;
  recordSpan('firstResponse', trace.firstResponseMs);
}

/**
 * Summarizes the trace into structured log fields and human-readable string
 * Adheres strictly to Phase D.5 single-line format:
 * #6289 /lockdown ack=595ms rest=2/410ms db=7/2324ms build=12ms total=3.1s lag=35ms
 * @param {object} [options={}]
 * @returns {{ summaryLine: string, topSlowSpans: Array<{ name: string, ms: number }>, metrics: object, totalMs: number, ackMs: number, firstResponseMs: number, unattributedMs: number }}
 */
export function summarizeTrace(options = {}) {
  const trace = getCurrentTrace();
  if (!trace) {
    return { summaryLine: 'trace=none', topSlowSpans: [], metrics: {}, totalMs: 0, ackMs: 0, firstResponseMs: 0, unattributedMs: 0 };
  }

  const totalMs = Math.round(performance.now() - trace.startTime);
  const totalSec = (totalMs / 1000).toFixed(1);
  const ackMs = Math.round(trace.ackMs || 0);
  const firstResponseMs = Math.round(trace.firstResponseMs || ackMs || 0);
  const dbCount = trace.db.count;
  const dbMs = Math.round(trace.db.totalMs);
  const restCount = trace.rest.count;
  const restMs = Math.round(trace.rest.totalMs);
  const buildMs = Math.round(trace.buildMs);
  const loopLag = Math.round(getEventLoopLagMs());

  // Compute unattributed time: total - union(spans)
  const unionMs = dbMs + restMs + buildMs;
  const unattributedMs = Math.max(0, totalMs - unionMs);

  const idShort = trace.id ? `#${String(trace.id).slice(-4)}` : '#0000';
  const summaryLine = `${idShort} ${trace.identifier} ack=${ackMs}ms rest=${restCount}/${restMs}ms db=${dbCount}/${dbMs}ms build=${buildMs}ms total=${totalSec}s lag=${loopLag}ms`;

  // Top slowest spans
  const sortedSpans = [...trace.spans].sort((a, b) => b.durationMs - a.durationMs);
  const topSlowSpans = sortedSpans.slice(0, 3).map(s => ({
    name: s.name,
    ms: s.durationMs,
    details: s.details
  }));

  return {
    summaryLine,
    totalMs,
    ackMs,
    firstResponseMs,
    unattributedMs,
    topSlowSpans,
    metrics: {
      ackMs,
      firstResponseMs,
      dbCount,
      dbMs,
      restCount,
      restMs,
      buildMs,
      unattributedMs,
      loopLagMs: loopLag,
      rateLimitedRestCalls: trace.rest.rateLimitedCount
    }
  };
}

export default {
  runWithTrace,
  getCurrentTrace,
  recordSpan,
  recordDbCall,
  recordRestCall,
  recordFetchCall,
  recordBuildDuration,
  setAckDuration,
  summarizeTrace,
  getEventLoopLagMs
};

import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';
import { config, validateLiveCredentials } from '../config.js';
import { logger } from '../utils/logger.js';
import { recordDbCall } from '../core/interactions/trace.js';

let supabaseClient = null;
let isMock = false;

// In-memory fallback database for local testing or when credentials are not configured
class MemoryStorage {
  constructor() {
    this.tables = {
      guild_settings: new Map(),
      backups: new Map(),
      backup_intervals: new Map(),
      chatlogs: new Map(),
      templates: new Map(),
      syncs: new Map(),
      synced_messages: new Map(),
      blacklist: new Map(),
      premium_codes: new Map(),
      bot_state: new Map(),
      audit_logs: new Map(),
      error_logs: new Map(),
      module_data: new Map(),
      antinuke_settings: new Map(),
      antinuke_trusted: new Map(),
      antinuke_exempt: new Map(),
      channel_snapshots: new Map(),
      antinuke_incidents: new Map(),
      lockdown_state: new Map(),
      ava_jobs: new Map(),
      automod_settings: new Map(),
      automod_words: new Map(),
      automod_allowlist: new Map(),
      automod_regex: new Map(),
      automod_exemptions: new Map(),
      automod_strikes: new Map()
    };
    this.autoId = 1;
    this.buckets = {
      backups: new Map()
    };
  }

  _getKey(tableName, record) {
    if (record.id) return String(record.id);
    if (tableName === 'channel_snapshots' && record.guild_id && record.channel_id) {
      return `${record.guild_id}:${record.channel_id}`;
    }
    if (tableName === 'antinuke_trusted' && record.guild_id && record.target_id && record.target_type) {
      return `${record.guild_id}:${record.target_id}:${record.target_type}`;
    }
    if (tableName === 'antinuke_exempt' && record.guild_id && record.target_id && record.type) {
      return `${record.guild_id}:${record.target_id}:${record.type}`;
    }
    if (tableName === 'automod_words' && record.guild_id && record.word) {
      return `${record.guild_id}:${record.word.toLowerCase()}`;
    }
    if (tableName === 'automod_allowlist' && record.guild_id && record.word) {
      return `${record.guild_id}:${record.word.toLowerCase()}`;
    }
    if (tableName === 'automod_exemptions' && record.guild_id && record.target_id && record.type) {
      return `${record.guild_id}:${record.target_id}:${record.type}`;
    }
    if (tableName === 'automod_strikes' && record.guild_id && record.user_id) {
      return `${record.guild_id}:${record.user_id}`;
    }
    if (tableName === 'lockdown_state' && record.guild_id) {
      return String(record.guild_id);
    }
    if (tableName === 'antinuke_settings' && record.guild_id) {
      return String(record.guild_id);
    }
    if (tableName === 'automod_settings' && record.guild_id) {
      return String(record.guild_id);
    }
    return record.id || record.channel_id || (record.user_id && record.guild_id ? `${record.user_id}:${record.guild_id}` : null) || record.code || record.guild_id || record.key;
  }

  from(tableName) {
    if (!this.tables[tableName]) {
      this.tables[tableName] = new Map();
    }
    const table = this.tables[tableName];

    return {
      select: (columns = '*') => {
        let filters = [];
        let orderConfig = null;
        let limitCount = null;
        let rangeConfig = null;

        const queryBuilder = {
          eq: (col, val) => {
            filters.push(row => row[col] === val);
            return queryBuilder;
          },
          neq: (col, val) => {
            filters.push(row => row[col] !== val);
            return queryBuilder;
          },
          in: (col, arr) => {
            filters.push(row => arr.includes(row[col]));
            return queryBuilder;
          },
          is: (col, val) => {
            filters.push(row => row[col] === val);
            return queryBuilder;
          },
          not: (col, op, val) => {
            if (op === 'is') {
              filters.push(row => row[col] !== val);
            }
            return queryBuilder;
          },
          lt: (col, val) => {
            filters.push(row => row[col] < val);
            return queryBuilder;
          },
          gt: (col, val) => {
            filters.push(row => row[col] > val);
            return queryBuilder;
          },
          lte: (col, val) => {
            filters.push(row => row[col] <= val);
            return queryBuilder;
          },
          gte: (col, val) => {
            filters.push(row => row[col] >= val);
            return queryBuilder;
          },
          ilike: (col, pattern) => {
            const regex = new RegExp(pattern.replace(/%/g, '.*'), 'i');
            filters.push(row => regex.test(row[col] || ''));
            return queryBuilder;
          },
          order: (col, { ascending = true } = {}) => {
            orderConfig = { col, ascending };
            return queryBuilder;
          },
          limit: (n) => {
            limitCount = n;
            return queryBuilder;
          },
          range: (from, to) => {
            rangeConfig = { from, to };
            return queryBuilder;
          },
          single: async () => {
            let rows = Array.from(table.values());
            for (const f of filters) {
              rows = rows.filter(f);
            }
            if (rows.length === 0) {
              return { data: null, error: { message: 'Row not found', code: 'PGRST116' } };
            }
            return { data: { ...rows[0] }, error: null };
          },
          maybeSingle: async () => {
            let rows = Array.from(table.values());
            for (const f of filters) {
              rows = rows.filter(f);
            }
            if (rows.length === 0) {
              return { data: null, error: null };
            }
            return { data: { ...rows[0] }, error: null };
          },
          then: (resolve, reject) => {
            let rows = Array.from(table.values());
            for (const f of filters) {
              rows = rows.filter(f);
            }
            if (orderConfig) {
              rows.sort((a, b) => {
                const va = a[orderConfig.col];
                const vb = b[orderConfig.col];
                if (va < vb) return orderConfig.ascending ? -1 : 1;
                if (va > vb) return orderConfig.ascending ? 1 : -1;
                return 0;
              });
            }
            if (rangeConfig) {
              rows = rows.slice(rangeConfig.from, rangeConfig.to + 1);
            } else if (limitCount !== null) {
              rows = rows.slice(0, limitCount);
            }
            recordDbCall(tableName, 'select', 0.5);
            return Promise.resolve({ data: rows.map(r => ({ ...r })), error: null }).then(resolve, reject);
          },
          catch: (reject) => queryBuilder.then(null, reject),
          finally: (cb) => queryBuilder.then().finally(cb)
        };

        return queryBuilder;
      },

      insert: (records) => {
        recordDbCall(tableName, 'insert', 0.5);
        const toInsert = Array.isArray(records) ? records : [records];
        const inserted = [];
        for (const item of toInsert) {
          const compKey = this._getKey(tableName, item);
          const id = item.id || (item.guild_id && !table.has(item.guild_id) ? item.guild_id : ++this.autoId);
          const record = { ...item, id: item.id || id, created_at: item.created_at || new Date().toISOString() };
          const key = compKey || id;
          table.set(String(key), record);
          inserted.push(record);
        }
        const res = Promise.resolve({ data: inserted, error: null });
        return {
          select: () => ({
            single: async () => ({ data: inserted[0], error: null }),
            then: (resolve, reject) => res.then(resolve, reject),
            catch: (reject) => res.catch(reject),
            finally: (cb) => res.finally(cb)
          }),
          then: (resolve, reject) => res.then(resolve, reject),
          catch: (reject) => res.catch(reject),
          finally: (cb) => res.finally(cb)
        };
      },

      upsert: (record, options = {}) => {
        recordDbCall(tableName, 'upsert', 0.5);
        const compKey = this._getKey(tableName, record);
        const key = compKey || ++this.autoId;
        const existing = table.get(String(key)) || {};
        const updated = { ...existing, ...record, updated_at: new Date().toISOString() };
        table.set(String(key), updated);
        const res = Promise.resolve({ data: [updated], error: null });
        return {
          select: () => ({
            single: async () => ({ data: updated, error: null }),
            then: (resolve, reject) => res.then(resolve, reject),
            catch: (reject) => res.catch(reject),
            finally: (cb) => res.finally(cb)
          }),
          then: (resolve, reject) => res.then(resolve, reject),
          catch: (reject) => res.catch(reject),
          finally: (cb) => res.finally(cb)
        };
      },

      update: (updates) => {
        let filters = [];
        const apply = () => {
          const updated = [];
          for (const [k, row] of table.entries()) {
            if (filters.every(f => f(row))) {
              const newRow = { ...row, ...updates, updated_at: new Date().toISOString() };
              table.set(k, newRow);
              updated.push(newRow);
            }
          }
          return updated;
        };
        const builder = {
          eq: (col, val) => {
            filters.push(row => row[col] === val);
            apply();
            return builder;
          },
          then: (resolve, reject) => {
            const updated = apply();
            return Promise.resolve({ data: updated, error: null }).then(resolve, reject);
          },
          catch: (reject) => {
            const updated = apply();
            return Promise.resolve({ data: updated, error: null }).catch(reject);
          },
          finally: (cb) => {
            const updated = apply();
            return Promise.resolve({ data: updated, error: null }).finally(cb);
          }
        };
        return builder;
      },

      delete: () => {
        let filters = [];
        const apply = () => {
          const deleted = [];
          for (const [k, row] of Array.from(table.entries())) {
            if (filters.every(f => f(row))) {
              table.delete(k);
              deleted.push(row);
            }
          }
          return deleted;
        };
        const builder = {
          eq: (col, val) => {
            filters.push(row => row[col] === val);
            apply();
            return builder;
          },
          neq: (col, val) => {
            filters.push(row => row[col] !== val);
            apply();
            return builder;
          },
          lt: (col, val) => {
            filters.push(row => row[col] < val);
            apply();
            return builder;
          },
          then: (resolve, reject) => {
            const deleted = apply();
            return Promise.resolve({ data: deleted, error: null }).then(resolve, reject);
          },
          catch: (reject) => {
            const deleted = apply();
            return Promise.resolve({ data: deleted, error: null }).catch(reject);
          },
          finally: (cb) => {
            const deleted = apply();
            return Promise.resolve({ data: deleted, error: null }).finally(cb);
          }
        };
        return builder;
      }
    };
  }

  get storage() {
    return {
      from: (bucketName) => {
        if (!this.buckets[bucketName]) {
          this.buckets[bucketName] = new Map();
        }
        const bucket = this.buckets[bucketName];
        return {
          upload: async (path, fileBuffer, { contentType, upsert } = {}) => {
            if (bucket.has(path) && !upsert) {
              return { data: null, error: { message: 'File already exists' } };
            }
            bucket.set(path, { buffer: Buffer.from(fileBuffer), contentType });
            return { data: { path }, error: null };
          },
          download: async (path) => {
            const file = bucket.get(path);
            if (!file) {
              return { data: null, error: { message: 'File not found' } };
            }
            return { data: new Blob([file.buffer]), error: null };
          },
          remove: async (paths) => {
            const toRemove = Array.isArray(paths) ? paths : [paths];
            for (const p of toRemove) {
              bucket.delete(p);
            }
            return { data: toRemove, error: null };
          }
        };
      }
    };
  }

  async rpc(funcName, params = {}) {
    if (funcName === 'next_ticket_number') {
      const guildId = params.p_guild_id;
      if (!this.tables.ticket_counters) this.tables.ticket_counters = new Map();
      const current = this.tables.ticket_counters.get(guildId) || { guild_id: guildId, last_number: 0 };
      const nextNum = (current.last_number || 0) + 1;
      current.last_number = nextNum;
      this.tables.ticket_counters.set(guildId, current);
      return { data: nextNum, error: null };
    }
    return { data: null, error: { message: `RPC ${funcName} not supported in memory adapter` } };
  }
}

const memoryDb = new MemoryStorage();

export function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const status = validateLiveCredentials();
  if (status.valid) {
    try {
      const customFetch = (url, options = {}) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        if (timeoutId.unref) timeoutId.unref();

        const fetchOptions = {
          ...options,
          signal: options.signal || controller.signal,
          keepalive: true
        };

        const fetchStart = performance.now();
        return fetch(url, fetchOptions).then(res => {
          try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split('/');
            const table = pathParts[pathParts.length - 1] || 'unknown';
            const method = options.method || 'GET';
            const op = method === 'GET' ? 'select' : method === 'POST' ? 'insert/upsert' : method === 'PATCH' ? 'update' : method === 'DELETE' ? 'delete' : method;
            recordDbCall(table, op, performance.now() - fetchStart);
          } catch (_) {}
          return res;
        }).finally(() => {
          clearTimeout(timeoutId);
        });
      };

      supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        },
        global: {
          fetch: customFetch
        }
      });
      logger.info('Connected to live Supabase backend (keep-alive enabled, 5s timeout guard)');
      return supabaseClient;
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize live Supabase client, falling back to memory database');
    }
  } else {
    logger.debug('Using in-memory Supabase adapter (live credentials not supplied or in test mode)');
  }

  isMock = true;
  supabaseClient = memoryDb;
  return supabaseClient;
}

export function isUsingMockDb() {
  return isMock;
}

export const db = new Proxy({}, {
  get: (target, prop) => {
    const client = getSupabase();
    return client[prop];
  }
});

export { memoryDb, MemoryStorage };
export default db;

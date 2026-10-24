import { z } from 'zod';

const safeInt = (min, max, def) => z.preprocess(val => {
  if (val === null || val === undefined || val === '') return def;
  const num = Number(val);
  if (isNaN(num)) return def;
  return Math.min(Math.max(Math.floor(num), min), max);
}, z.number().int().default(def));

const safeBool = (def = false) => z.preprocess(val => {
  if (val === null || val === undefined || val === '') return def;
  if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1';
  return Boolean(val);
}, z.boolean().default(def));

export const AntinukeThresholdsSchema = z.object({
  channel_delete_limit: safeInt(1, 20, 3),
  channel_delete_window_seconds: safeInt(2, 120, 10),
  restore_single_deletions: safeBool(false),
  mass_role_delete_limit: safeInt(1, 20, 3),
  mass_role_delete_window_seconds: safeInt(2, 120, 10),
  mass_ban_limit: safeInt(1, 30, 5),
  mass_ban_window_seconds: safeInt(2, 120, 15),
  mass_kick_limit: safeInt(1, 30, 5),
  mass_kick_window_seconds: safeInt(2, 120, 15),
  bot_add_protection: safeBool(true),
  webhook_spam_limit: safeInt(1, 20, 3),
  webhook_spam_window_seconds: safeInt(2, 120, 10),
  dangerous_perm_grant: safeBool(true),
  raid_distinct_users: safeInt(2, 50, 5),
  raid_messages_per_user: safeInt(1, 20, 4),
  raid_window_seconds: safeInt(2, 60, 5),
  raid_identical_content_users: safeInt(2, 20, 3),
  raid_join_burst_count: safeInt(3, 50, 8),
  raid_join_window_seconds: safeInt(2, 60, 10),
  lockdown_calm_seconds: safeInt(10, 600, 60),
  lockdown_max_duration_seconds: safeInt(60, 7200, 900)
}).default({});

export const AntinukeSettingsSchema = z.object({
  guild_id: z.string().min(1),
  enabled: safeBool(false),
  dry_run: safeBool(false),
  thresholds: AntinukeThresholdsSchema,
  punishment: z.enum(['ban', 'kick', 'strip_roles', 'timeout']).default('ban'),
  lockdown_punishment: z.enum(['ban', 'kick', 'strip_roles', 'timeout']).default('ban'),
  log_channel_id: z.string().nullable().default(null),
  alert_channel_id: z.string().nullable().default(null),
  ping_role_id: z.string().nullable().default(null),
  extra_owners: z.array(z.string()).default([]),
  version: safeInt(1, 2147483647, 1),
  schema_version: safeInt(1, 10, 2)
});

export const LockdownStateSchema = z.object({
  guild_id: z.string().min(1),
  active: safeBool(false),
  started_at: z.string().nullable().default(null),
  reason: z.string().default('Active emergency lockdown'),
  locked_channels: z.array(z.string()).default([]),
  saved_overwrites: z.record(z.string(), z.any()).default({}),
  offenders: z.array(z.string()).default([]),
  calm_until: z.string().nullable().default(null),
  max_until: z.string().nullable().default(null),
  version: safeInt(1, 2147483647, 1)
});

export default {
  AntinukeThresholdsSchema,
  AntinukeSettingsSchema,
  LockdownStateSchema
};

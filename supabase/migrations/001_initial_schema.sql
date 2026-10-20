-- Argoni Database Schema
-- Production-grade, Verification-Ready Discord Bot
-- All tables protected by Row Level Security (RLS) - Deny all to anon, service_role only

-- 1. GUILD SETTINGS
CREATE TABLE IF NOT EXISTS public.guild_settings (
    guild_id TEXT PRIMARY KEY,
    locale TEXT NOT NULL DEFAULT 'en-US',
    prefix TEXT NOT NULL DEFAULT 'a!',
    prefix_commands_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    chatlog_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    message_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    premium_tier TEXT NOT NULL DEFAULT 'free',
    premium_until TIMESTAMPTZ,
    backup_role_id TEXT,
    log_channel_id TEXT,
    left_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_guild_settings_left_at ON public.guild_settings(left_at);
CREATE INDEX IF NOT EXISTS idx_guild_settings_prefix ON public.guild_settings(prefix);

-- 2. BACKUPS
CREATE TABLE IF NOT EXISTS public.backups (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    options JSONB NOT NULL DEFAULT '{}'::jsonb,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_auto BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_backups_guild_id ON public.backups(guild_id);
CREATE INDEX IF NOT EXISTS idx_backups_owner_id ON public.backups(owner_id);
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON public.backups(created_at);

-- 3. BACKUP INTERVALS (Scheduled Auto-Backups)
CREATE TABLE IF NOT EXISTS public.backup_intervals (
    guild_id TEXT PRIMARY KEY REFERENCES public.guild_settings(guild_id) ON DELETE CASCADE,
    interval_hours INT NOT NULL DEFAULT 24,
    max_backups INT NOT NULL DEFAULT 5,
    last_run TIMESTAMPTZ,
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

-- 4. CHATLOGS
CREATE TABLE IF NOT EXISTS public.chatlogs (
    id TEXT PRIMARY KEY,
    backup_id TEXT REFERENCES public.backups(id) ON DELETE SET NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_count INT NOT NULL DEFAULT 0,
    storage_path TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_chatlogs_guild_id ON public.chatlogs(guild_id);
CREATE INDEX IF NOT EXISTS idx_chatlogs_expires_at ON public.chatlogs(expires_at);

-- 5. TEMPLATES
CREATE TABLE IF NOT EXISTS public.templates (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'Other',
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    uses INT NOT NULL DEFAULT 0,
    backup_id TEXT REFERENCES public.backups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_templates_is_public ON public.templates(is_public);
CREATE INDEX IF NOT EXISTS idx_templates_category ON public.templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_owner_id ON public.templates(owner_id);

-- 6. SYNCS
CREATE TABLE IF NOT EXISTS public.syncs (
    id TEXT PRIMARY KEY,
    source_guild TEXT NOT NULL,
    target_guild TEXT NOT NULL,
    source_channel TEXT,
    target_channel TEXT,
    type TEXT NOT NULL, -- 'messages' | 'bans' | 'roles' | 'channels' | 'role-assign'
    direction TEXT NOT NULL DEFAULT 'one-way', -- 'one-way' | 'two-way'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_syncs_source_guild ON public.syncs(source_guild);
CREATE INDEX IF NOT EXISTS idx_syncs_target_guild ON public.syncs(target_guild);

-- 7. SYNCED MESSAGES (Loop prevention)
CREATE TABLE IF NOT EXISTS public.synced_messages (
    source_message_id TEXT NOT NULL,
    target_message_id TEXT NOT NULL,
    sync_id TEXT NOT NULL REFERENCES public.syncs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (source_message_id, target_message_id)
);

CREATE INDEX IF NOT EXISTS idx_synced_messages_sync_id ON public.synced_messages(sync_id);
CREATE INDEX IF NOT EXISTS idx_synced_messages_created_at ON public.synced_messages(created_at);

-- 8. BLACKLIST
CREATE TABLE IF NOT EXISTS public.blacklist (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL, -- 'user' | 'guild'
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    added_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_blacklist_type_target ON public.blacklist(type, target_id);
CREATE INDEX IF NOT EXISTS idx_blacklist_target_id ON public.blacklist(target_id);

-- 9. PREMIUM CODES
CREATE TABLE IF NOT EXISTS public.premium_codes (
    code TEXT PRIMARY KEY,
    tier TEXT NOT NULL, -- 'pro' | 'ultimate'
    duration_days INT NOT NULL DEFAULT 30,
    uses_left INT NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 10. BOT STATE (Key-value for maintenance, disabled commands, presence)
CREATE TABLE IF NOT EXISTS public.bot_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 11. AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_id ON public.audit_logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

-- 12. ERROR LOGS
CREATE TABLE IF NOT EXISTS public.error_logs (
    id BIGSERIAL PRIMARY KEY,
    scope TEXT NOT NULL,
    message TEXT NOT NULL,
    stack TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs(created_at);

-- ROW LEVEL SECURITY (RLS) POLICIES
-- Enable RLS on every table; reject anon access, allow service_role only
ALTER TABLE public.guild_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_intervals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chatlogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.syncs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synced_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;

-- Note: In Supabase, the service_role key automatically bypasses RLS policies.
-- By creating no policies for the 'anon' or 'authenticated' roles, all client-side queries
-- without the service_role key are denied by default.

-- STORAGE BUCKET CONFIGURATION
-- Run in Supabase SQL editor or storage API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('backups', 'backups', false) ON CONFLICT DO NOTHING;

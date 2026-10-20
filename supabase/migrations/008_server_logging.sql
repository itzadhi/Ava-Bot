-- Migration 008: Server Logging and Module Data Persistence
-- Adds support for granular per-category server logging channels and feature data storage

-- 1. Ensure module_data generic table exists (stores category toggles and channel mappings)
CREATE TABLE IF NOT EXISTS public.module_data (
    id BIGSERIAL PRIMARY KEY,
    module_name TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT 'global',
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_module_data_composite 
    ON public.module_data (module_name, guild_id, key);

CREATE INDEX IF NOT EXISTS idx_module_data_lookup 
    ON public.module_data (module_name, guild_id);

-- Enable Row Level Security (service_role only access)
ALTER TABLE public.module_data ENABLE ROW LEVEL SECURITY;

-- 2. Optional: Add dedicated log columns to guild_settings for direct indexing
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS mod_log_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS message_log_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS member_log_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS role_log_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS voice_log_channel_id TEXT;

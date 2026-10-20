-- Migration 005: AutoMod Interactive System and Boost Tracking with Auto-Role
-- Adds columns to guild_settings and tables for automod infractions and boost events

-- 1. AutoMod configuration columns
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_anti_invites BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_anti_links BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_anti_spam BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_anti_mentions BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_anti_caps BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_word_filter BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_banned_words TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_action TEXT DEFAULT 'delete';
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_log_channel_id TEXT;

-- 2. Boost tracking & auto-role configuration columns
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_tracking_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_role_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_message TEXT DEFAULT 'Thank you for boosting the server!';
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_auto_role_enabled BOOLEAN DEFAULT TRUE;

-- 3. Optional Incident & Boost History Tables
CREATE TABLE IF NOT EXISTS public.automod_incidents (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rule TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    content TEXT,
    channel_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.boost_history (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL, -- 'boost_start', 'boost_end'
    tier INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

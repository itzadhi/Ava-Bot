-- ==============================================================================
-- ARGONI DATABASE FIXES & MISSING SCHEMA DEFINITIONS
-- Generated: 2026-10-23
-- Target: Live Supabase Backend
--
-- Notice: This file contains ONLY the verified missing tables and columns
-- detected during schema comparison against the live Supabase instance.
-- All statements use IF NOT EXISTS / idempotent DDL and do NOT delete any data.
-- Run this in the Supabase SQL Editor to bring the live database to 100% parity.
-- ==============================================================================

-- 1. MODULE DATA (Generic key-value store for extensible feature modules)
CREATE TABLE IF NOT EXISTS public.module_data (
    module TEXT NOT NULL,
    key TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT 'global',
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (module, key, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_module_data_guild ON public.module_data(guild_id);
CREATE INDEX IF NOT EXISTS idx_module_data_module ON public.module_data(module);

ALTER TABLE public.module_data ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access on module_data" ON public.module_data;
CREATE POLICY "Deny public access on module_data" ON public.module_data FOR ALL TO anon USING (false);

-- 2. STICKY NOTES (Persistent pinned notices that auto-repost at the channel bottom)
CREATE TABLE IF NOT EXISTS public.sticky_notes (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    content TEXT NOT NULL,
    last_message_id TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sticky_notes_guild_chan ON public.sticky_notes(guild_id, channel_id);

ALTER TABLE public.sticky_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access on sticky_notes" ON public.sticky_notes;
CREATE POLICY "Deny public access on sticky_notes" ON public.sticky_notes FOR ALL TO anon USING (false);

-- 3. STICKY ROLES (Re-applies persistent roles when a member rejoins a guild)
CREATE TABLE IF NOT EXISTS public.sticky_roles (
    id TEXT PRIMARY KEY, -- `${guild_id}:${user_id}`
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_ids TEXT[] DEFAULT '{}'::TEXT[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sticky_roles_guild_user ON public.sticky_roles(guild_id, user_id);

ALTER TABLE public.sticky_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Deny public access on sticky_roles" ON public.sticky_roles;
CREATE POLICY "Deny public access on sticky_roles" ON public.sticky_roles FOR ALL TO anon USING (false);

-- 4. MISSING COLUMNS ON GUILD_SETTINGS
-- Bot Profile Customization & Suggestion / Feedback Thread & Image Controls (from Migration 004)
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_nickname TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_avatar_url TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_banner_url TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_bio TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS suggestion_thread_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS suggestion_allow_images BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS feedback_allow_images BOOLEAN DEFAULT TRUE;

-- Boost Tracking & AutoMod (from Migration 005)
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_channel_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_message TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_role_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS boost_tracking_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_enabled BOOLEAN DEFAULT TRUE;

-- Sticky Roles & Auto-Role Settings (from Migration 006)
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_roles_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_role_ids TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_all_roles BOOLEAN DEFAULT TRUE;

-- AutoMod Staff Exception Role (from Migration 007)
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_exception_role_id TEXT;

-- Server Audit Logging (from Migration 008)
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS logging_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS log_channel_overrides JSONB DEFAULT '{}'::jsonb;

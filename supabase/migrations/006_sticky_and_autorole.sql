-- Migration 006: Sticky Notes, Sticky Roles, and Auto-Role System

-- 1. Sticky Notes table
CREATE TABLE IF NOT EXISTS public.sticky_notes (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    content TEXT NOT NULL,
    last_message_id TEXT,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Sticky Roles table
CREATE TABLE IF NOT EXISTS public.sticky_roles (
    id TEXT PRIMARY KEY, -- `${guild_id}:${user_id}`
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role_ids TEXT[] DEFAULT '{}'::TEXT[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Guild settings columns for Sticky Roles & Auto-Role
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_roles_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_role_ids TEXT[] DEFAULT '{}'::TEXT[];
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS sticky_all_roles BOOLEAN DEFAULT TRUE;

ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS autorole_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS autorole_member_role_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS autorole_bot_role_id TEXT;

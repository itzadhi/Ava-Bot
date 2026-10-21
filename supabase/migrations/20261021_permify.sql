-- Argoni Database Schema: Permify Permission Wizard & Multi-Role Autorole
-- Migration: 20261021_permify.sql
-- Protected by Row Level Security (RLS) - service_role access

-- 1. PERMIFY SNAPSHOTS TABLE (Keep last 3 snapshots per guild)
CREATE TABLE IF NOT EXISTS public.permify_snapshots (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    data JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permify_snapshots_guild ON public.permify_snapshots(guild_id, created_at DESC);

-- 2. GUILD ROLES TABLE (Central shared role classifications for staff, member, and owner)
CREATE TABLE IF NOT EXISTS public.guild_roles (
    guild_id TEXT PRIMARY KEY REFERENCES public.guild_settings(guild_id) ON DELETE CASCADE,
    staff_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    member_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    owner_role_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_guild_roles_guild ON public.guild_roles(guild_id);

-- 3. EXTEND GUILD SETTINGS FOR MULTI-ROLE AUTOROLE
ALTER TABLE public.guild_settings 
ADD COLUMN IF NOT EXISTS autorole_member_role_ids TEXT[] DEFAULT '{}'::TEXT[];

-- Safe migration: copy existing single autorole_member_role_id into autorole_member_role_ids array if present
UPDATE public.guild_settings
SET autorole_member_role_ids = ARRAY[autorole_member_role_id]
WHERE autorole_member_role_id IS NOT NULL 
  AND (autorole_member_role_ids IS NULL OR cardinality(autorole_member_role_ids) = 0);

-- 4. EXTEND TICKET SETTINGS FOR ALLOWED MEMBER ROLES
ALTER TABLE public.ticket_settings 
ADD COLUMN IF NOT EXISTS allowed_role_ids TEXT[] DEFAULT '{}'::TEXT[];

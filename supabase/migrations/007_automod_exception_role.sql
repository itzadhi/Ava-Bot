-- Migration 007: AutoMod Exception Role and Whitelist
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_exception_role_id TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS automod_ignored_role_ids TEXT[] DEFAULT '{}'::TEXT[];

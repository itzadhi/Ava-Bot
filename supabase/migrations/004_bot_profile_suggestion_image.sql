-- Migration 004: Bot Profile Customization per Guild and Suggestion Image Support

-- 1. Add image_url to suggestions table
ALTER TABLE public.suggestions ADD COLUMN IF NOT EXISTS image_url TEXT;

-- 2. Add per-guild bot profile customizations to guild_settings table
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_nickname TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_avatar_url TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_banner_url TEXT;
ALTER TABLE public.guild_settings ADD COLUMN IF NOT EXISTS bot_bio TEXT;

-- ============================================================================
-- Migration: 20261023_antinuke_automod.sql
-- Description: Complete Anti-Nuke Engine & Persistent AutoMod Architecture
-- ============================================================================

-- 1. Anti-Nuke Settings (One row per guild)
CREATE TABLE IF NOT EXISTS public.antinuke_settings (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    thresholds JSONB NOT NULL DEFAULT '{
        "channel_delete_limit": 3,
        "channel_delete_window_seconds": 10,
        "restore_single_deletions": false,
        "mass_role_delete_limit": 3,
        "mass_role_delete_window_seconds": 10,
        "mass_ban_limit": 5,
        "mass_ban_window_seconds": 15,
        "mass_kick_limit": 5,
        "mass_kick_window_seconds": 15,
        "bot_add_protection": true,
        "webhook_spam_limit": 3,
        "webhook_spam_window_seconds": 10,
        "dangerous_perm_grant": true,
        "raid_distinct_users": 5,
        "raid_messages_per_user": 4,
        "raid_window_seconds": 5,
        "raid_identical_content_users": 3,
        "raid_join_burst_count": 8,
        "raid_join_window_seconds": 10,
        "lockdown_calm_seconds": 60,
        "lockdown_max_duration_seconds": 900
    }'::jsonb,
    punishment TEXT NOT NULL DEFAULT 'ban', -- 'ban', 'kick', 'strip_roles', 'timeout'
    lockdown_punishment TEXT NOT NULL DEFAULT 'ban',
    log_channel_id TEXT,
    alert_channel_id TEXT,
    ping_role_id TEXT,
    extra_owners TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_antinuke_settings_guild ON public.antinuke_settings(guild_id);

-- 2. Anti-Nuke Trusted Entities (Roles, Users, Extra Owners)
CREATE TABLE IF NOT EXISTS public.antinuke_trusted (
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL, -- 'role', 'user', 'extra_owner'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_antinuke_trusted_lookup ON public.antinuke_trusted(guild_id, target_type);

-- 3. Anti-Nuke Exempt Categories & Channels
CREATE TABLE IF NOT EXISTS public.antinuke_exempt (
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'category', 'channel'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_antinuke_exempt_lookup ON public.antinuke_exempt(guild_id, type);

-- 4. Live Channel Snapshots for Instant Restoration
CREATE TABLE IF NOT EXISTS public.channel_snapshots (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_snapshots_guild ON public.channel_snapshots(guild_id);

-- 5. Anti-Nuke Incidents & Action Log
CREATE TABLE IF NOT EXISTS public.antinuke_incidents (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'mass_channel_delete', 'mass_role_delete', 'raid_lockdown', etc.
    executor_id TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_antinuke_incidents_guild ON public.antinuke_incidents(guild_id, created_at DESC);

-- 6. Persistent Lockdown State (Survives bot restarts)
CREATE TABLE IF NOT EXISTS public.lockdown_state (
    guild_id TEXT PRIMARY KEY,
    active BOOLEAN NOT NULL DEFAULT FALSE,
    started_at TIMESTAMPTZ,
    reason TEXT,
    saved_overwrites JSONB NOT NULL DEFAULT '{}'::jsonb,
    offenders JSONB NOT NULL DEFAULT '[]'::jsonb,
    calm_until TIMESTAMPTZ,
    max_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lockdown_state_active ON public.lockdown_state(active) WHERE active = TRUE;

-- 7. Dedicated AutoMod Settings (One row per guild)
CREATE TABLE IF NOT EXISTS public.automod_settings (
    guild_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB NOT NULL DEFAULT '{
        "anti_invites": false,
        "anti_links": false,
        "anti_spam": false,
        "anti_mentions": false,
        "anti_caps": false,
        "word_filter": false,
        "action": "delete",
        "log_channel_id": null,
        "dm_user_on_action": true,
        "slurs_category_enabled": true,
        "slurs_severity": "severe",
        "profanity_category_enabled": true,
        "profanity_severity": "mild",
        "custom_category_enabled": true,
        "custom_severity": "medium",
        "allowed_domains": ["discord.gg", "youtube.com", "youtu.be", "tenor.com", "giphy.com"],
        "denied_domains": [],
        "strike_threshold_timeout": 3,
        "strike_threshold_kick": 5,
        "strike_threshold_ban": 7,
        "strike_expiry_hours": 24,
        "ticket_category_exempt": true
    }'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automod_settings_guild ON public.automod_settings(guild_id);

-- 8. AutoMod Word Filter (Slurs, Profanity, Custom)
CREATE TABLE IF NOT EXISTS public.automod_words (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    word TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'custom', -- 'slurs', 'profanity', 'custom'
    severity TEXT NOT NULL DEFAULT 'medium',  -- 'mild', 'medium', 'severe'
    match_type TEXT NOT NULL DEFAULT 'word',  -- 'word', 'substring', 'wildcard'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (guild_id, word)
);

CREATE INDEX IF NOT EXISTS idx_automod_words_lookup ON public.automod_words(guild_id, category);

-- 9. AutoMod Allowlist (False-Positive Protection)
CREATE TABLE IF NOT EXISTS public.automod_allowlist (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    word TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (guild_id, word)
);

CREATE INDEX IF NOT EXISTS idx_automod_allowlist_guild ON public.automod_allowlist(guild_id);

-- 10. AutoMod Custom Regex Rules (Max 50 per guild, Safe Re2 / Guarded)
CREATE TABLE IF NOT EXISTS public.automod_regex (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    pattern TEXT NOT NULL,
    flags TEXT NOT NULL DEFAULT 'i',
    severity TEXT NOT NULL DEFAULT 'medium',
    action TEXT NOT NULL DEFAULT 'delete', -- 'delete', 'warn', 'timeout', 'kick', 'ban'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automod_regex_guild ON public.automod_regex(guild_id, enabled);

-- 11. AutoMod Exemptions (Roles, Channels, Categories, Users)
CREATE TABLE IF NOT EXISTS public.automod_exemptions (
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL, -- 'role', 'channel', 'category', 'user'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_automod_exemptions_lookup ON public.automod_exemptions(guild_id, type);

-- 12. AutoMod Strikes & Offender Tracking
CREATE TABLE IF NOT EXISTS public.automod_strikes (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    last_rule TEXT,
    last_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_automod_strikes_expiry ON public.automod_strikes(expires_at);

-- 13. Data Migration from legacy guild_settings if existing
DO $$
BEGIN
    -- Check if guild_settings has legacy automod columns
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'guild_settings' 
          AND column_name = 'automod_enabled'
    ) THEN
        -- Migrate basic settings into automod_settings
        INSERT INTO public.automod_settings (guild_id, enabled, config, updated_at)
        SELECT 
            gs.guild_id,
            COALESCE(gs.automod_enabled, TRUE),
            jsonb_build_object(
                'anti_invites', COALESCE(gs.automod_anti_invites, FALSE),
                'anti_links', COALESCE(gs.automod_anti_links, FALSE),
                'anti_spam', COALESCE(gs.automod_anti_spam, FALSE),
                'anti_mentions', COALESCE(gs.automod_anti_mentions, FALSE),
                'anti_caps', COALESCE(gs.automod_anti_caps, FALSE),
                'word_filter', COALESCE(gs.automod_word_filter, FALSE),
                'action', COALESCE(gs.automod_action, 'delete'),
                'log_channel_id', COALESCE(gs.automod_log_channel_id, gs.log_channel_id),
                'dm_user_on_action', TRUE,
                'slurs_category_enabled', TRUE,
                'slurs_severity', 'severe',
                'profanity_category_enabled', TRUE,
                'profanity_severity', 'mild',
                'custom_category_enabled', TRUE,
                'custom_severity', 'medium',
                'allowed_domains', '["discord.gg", "youtube.com", "youtu.be", "tenor.com", "giphy.com"]'::jsonb,
                'denied_domains', '[]'::jsonb,
                'strike_threshold_timeout', 3,
                'strike_threshold_kick', 5,
                'strike_threshold_ban', 7,
                'strike_expiry_hours', 24,
                'ticket_category_exempt', TRUE
            ),
            NOW()
        FROM public.guild_settings gs
        ON CONFLICT (guild_id) DO NOTHING;

        -- Migrate banned words if present
        INSERT INTO public.automod_words (guild_id, word, category, severity, match_type)
        SELECT 
            gs.guild_id,
            LOWER(TRIM(w)),
            'custom',
            'medium',
            'word'
        FROM public.guild_settings gs,
        UNNEST(gs.automod_banned_words) AS w
        WHERE w IS NOT NULL AND TRIM(w) <> ''
        ON CONFLICT (guild_id, word) DO NOTHING;

        -- Migrate exception roles if present
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'guild_settings' 
              AND column_name = 'automod_exception_role_id'
        ) THEN
            INSERT INTO public.automod_exemptions (guild_id, target_id, type)
            SELECT gs.guild_id, gs.automod_exception_role_id, 'role'
            FROM public.guild_settings gs
            WHERE gs.automod_exception_role_id IS NOT NULL AND gs.automod_exception_role_id <> ''
            ON CONFLICT (guild_id, target_id, type) DO NOTHING;
        END IF;

        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' 
              AND table_name = 'guild_settings' 
              AND column_name = 'automod_ignored_role_ids'
        ) THEN
            INSERT INTO public.automod_exemptions (guild_id, target_id, type)
            SELECT gs.guild_id, r, 'role'
            FROM public.guild_settings gs,
            UNNEST(gs.automod_ignored_role_ids) AS r
            WHERE r IS NOT NULL AND TRIM(r) <> ''
            ON CONFLICT (guild_id, target_id, type) DO NOTHING;
        END IF;
    END IF;
END $$;

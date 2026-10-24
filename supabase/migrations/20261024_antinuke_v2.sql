-- ============================================================================
-- AVA Antinuke V2 Architecture & Optimistic Concurrency Engine
-- Migration: 20261024_antinuke_v2.sql
-- NOTICE: DO NOT RUN AUTOMATICALLY. Run manually in Supabase SQL Editor.
-- Zero data loss: Preserves all existing tables and copies records with schema validation.
-- ============================================================================

-- 1. Ensure pgcrypto extension for UUIDs
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Add versioning column and schema_version to antinuke_settings
ALTER TABLE IF EXISTS public.antinuke_settings 
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 2;

-- 3. Unified Antinuke Snapshots (replaces raw channel_snapshots with content-hashing & versioning)
CREATE TABLE IF NOT EXISTS public.antinuke_snapshots (
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'channel', -- 'channel', 'role', 'category'
    content_hash TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (guild_id, target_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_antinuke_snapshots_lookup 
    ON public.antinuke_snapshots(guild_id, target_type, content_hash);

-- 4. Idempotent Action Log (tracks every automated ban, role strip, restore action with undo state)
CREATE TABLE IF NOT EXISTS public.antinuke_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    action_type TEXT NOT NULL, -- 'ban', 'kick', 'strip_roles', 'restore_channel', 'restore_role'
    target_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'executed', -- 'executed', 'failed', 'undone'
    undo_state JSONB NOT NULL DEFAULT '{}'::jsonb, -- saved role IDs, permissions, etc.
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_antinuke_actions_incident 
    ON public.antinuke_actions(incident_id);
CREATE INDEX IF NOT EXISTS idx_antinuke_actions_guild_time 
    ON public.antinuke_actions(guild_id, created_at DESC);

-- 5. Enhanced Lockdown State with locked_channels array to prevent permanent mutes
ALTER TABLE IF EXISTS public.lockdown_state
    ADD COLUMN IF NOT EXISTS locked_channels JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- 6. Optimistic Concurrency Locking RPC Function for Settings
-- Prevents stale in-memory cache from overwriting newer database state
CREATE OR REPLACE FUNCTION public.update_antinuke_settings_optimistic(
    p_guild_id TEXT,
    p_expected_version INT,
    p_settings JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_current_version INT;
    v_updated_row RECORD;
BEGIN
    -- Check current version
    SELECT version INTO v_current_version 
    FROM public.antinuke_settings 
    WHERE guild_id = p_guild_id;

    -- If row does not exist, insert with version 1
    IF NOT FOUND THEN
        INSERT INTO public.antinuke_settings (
            guild_id,
            enabled,
            dry_run,
            thresholds,
            punishment,
            lockdown_punishment,
            log_channel_id,
            alert_channel_id,
            ping_role_id,
            extra_owners,
            version,
            schema_version,
            updated_at
        ) VALUES (
            p_guild_id,
            COALESCE((p_settings->>'enabled')::boolean, false),
            COALESCE((p_settings->>'dry_run')::boolean, false),
            COALESCE(p_settings->'thresholds', '{}'::jsonb),
            COALESCE(p_settings->>'punishment', 'ban'),
            COALESCE(p_settings->>'lockdown_punishment', 'ban'),
            p_settings->>'log_channel_id',
            p_settings->>'alert_channel_id',
            p_settings->>'ping_role_id',
            ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_settings->'extra_owners', '[]'::jsonb))),
            1,
            2,
            NOW()
        )
        RETURNING * INTO v_updated_row;

        RETURN jsonb_build_object(
            'success', true,
            'version', 1,
            'data', row_to_json(v_updated_row)
        );
    END IF;

    -- If version does not match, reject update (concurrent writer collision)
    IF v_current_version != p_expected_version THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'OPTIMISTIC_LOCK_CONFLICT',
            'current_version', v_current_version,
            'expected_version', p_expected_version
        );
    END IF;

    -- Atomically update with incremented version
    UPDATE public.antinuke_settings
    SET 
        enabled = COALESCE((p_settings->>'enabled')::boolean, enabled),
        dry_run = COALESCE((p_settings->>'dry_run')::boolean, dry_run),
        thresholds = COALESCE(p_settings->'thresholds', thresholds),
        punishment = COALESCE(p_settings->>'punishment', punishment),
        lockdown_punishment = COALESCE(p_settings->>'lockdown_punishment', lockdown_punishment),
        log_channel_id = p_settings->>'log_channel_id',
        alert_channel_id = p_settings->>'alert_channel_id',
        ping_role_id = p_settings->>'ping_role_id',
        extra_owners = ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_settings->'extra_owners', '[]'::jsonb))),
        version = version + 1,
        schema_version = 2,
        updated_at = NOW()
    WHERE guild_id = p_guild_id AND version = p_expected_version
    RETURNING * INTO v_updated_row;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'OPTIMISTIC_LOCK_RACE',
            'current_version', v_current_version
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'version', v_updated_row.version,
        'data', row_to_json(v_updated_row)
    );
END;
$$;

-- 7. Data Migration: Copy old channel_snapshots into antinuke_snapshots with content_hash
DO $$
DECLARE
    r RECORD;
    v_hash TEXT;
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'channel_snapshots') THEN
        FOR r IN SELECT guild_id, channel_id, data, updated_at FROM public.channel_snapshots LOOP
            v_hash := md5(r.data::text);
            INSERT INTO public.antinuke_snapshots (
                guild_id,
                target_id,
                target_type,
                content_hash,
                version,
                data,
                created_at,
                updated_at
            ) VALUES (
                r.guild_id,
                r.channel_id,
                'channel',
                v_hash,
                1,
                r.data,
                COALESCE(r.updated_at, NOW()),
                COALESCE(r.updated_at, NOW())
            )
            ON CONFLICT (guild_id, target_id, target_type) DO UPDATE
            SET content_hash = EXCLUDED.content_hash,
                data = EXCLUDED.data,
                updated_at = EXCLUDED.updated_at;
        END LOOP;
    END IF;
END $$;

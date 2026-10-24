-- ==============================================================================
-- AVA MIGRATION: Permission Guard, Write Log, Bot Leases, and Resumable Lockdown
-- Created: 2026-10-25
-- Purpose:
--   1. Central audit table permission_write_log (30-day retention)
--   2. Single-instance lease table bot_leases with generation fencing
--   3. Resumable write-ahead lockdown tables (lockdown_plans, lockdown_items)
--   4. Atomic RPCs for lease acquisition and lockdown orchestration
-- ==============================================================================

-- 1. PERMISSION WRITE LOG
CREATE TABLE IF NOT EXISTS public.permission_write_log (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    feature TEXT NOT NULL,
    job_id TEXT,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL, -- 'role', 'channel', 'guild'
    op TEXT NOT NULL,          -- 'set_permissions', 'edit_overwrite', 'delete_overwrite', etc.
    field TEXT NOT NULL,       -- 'permissions', 'permissionOverwrites', 'verificationLevel', etc.
    old_value TEXT,
    new_value TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perm_write_log_guild ON public.permission_write_log(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perm_write_log_retention ON public.permission_write_log(created_at);

-- 30-Day retention cleanup function
CREATE OR REPLACE FUNCTION public.ava_prune_permission_write_log()
RETURNS integer AS $$
DECLARE
    pruned_count integer;
BEGIN
    DELETE FROM public.permission_write_log
    WHERE created_at < NOW() - INTERVAL '30 days';
    GET DIAGNOSTICS pruned_count = ROW_COUNT;
    RETURN pruned_count;
END;
$$ LANGUAGE plpgsql;

-- 2. BOT LEASES (Single-instance coordination with generation fencing)
CREATE TABLE IF NOT EXISTS public.bot_leases (
    lease_key TEXT PRIMARY KEY,
    holder_id TEXT NOT NULL,
    holder_host TEXT NOT NULL,
    holder_pid INT NOT NULL,
    holder_role TEXT NOT NULL DEFAULT 'prod', -- 'prod' or 'dev'
    generation BIGINT NOT NULL DEFAULT 1,
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    renewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- RPC: Acquire lease if expired or held by same holder
CREATE OR REPLACE FUNCTION public.ava_acquire_lease(
    p_lease_key TEXT,
    p_holder_id TEXT,
    p_holder_host TEXT,
    p_holder_pid INT,
    p_holder_role TEXT,
    p_ttl_seconds INT DEFAULT 30
)
RETURNS TABLE (
    acquired BOOLEAN,
    current_holder TEXT,
    current_host TEXT,
    current_pid INT,
    current_role TEXT,
    generation BIGINT,
    expires_at TIMESTAMPTZ
) AS $$
DECLARE
    v_row public.bot_leases%ROWTYPE;
    v_now TIMESTAMPTZ := NOW();
    v_new_expires TIMESTAMPTZ := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
BEGIN
    SELECT * INTO v_row FROM public.bot_leases WHERE lease_key = p_lease_key FOR UPDATE;

    IF NOT FOUND THEN
        INSERT INTO public.bot_leases (
            lease_key, holder_id, holder_host, holder_pid, holder_role, generation, acquired_at, renewed_at, expires_at
        ) VALUES (
            p_lease_key, p_holder_id, p_holder_host, p_holder_pid, p_holder_role, 1, v_now, v_now, v_new_expires
        ) RETURNING * INTO v_row;

        RETURN QUERY SELECT TRUE, v_row.holder_id, v_row.holder_host, v_row.holder_pid, v_row.holder_role, v_row.generation, v_row.expires_at;
        RETURN;
    END IF;

    -- If lease is expired OR held by the exact same instance ID
    IF v_row.expires_at < v_now OR v_row.holder_id = p_holder_id THEN
        UPDATE public.bot_leases
        SET holder_id = p_holder_id,
            holder_host = p_holder_host,
            holder_pid = p_holder_pid,
            holder_role = p_holder_role,
            generation = v_row.generation + 1,
            renewed_at = v_now,
            expires_at = v_new_expires
        WHERE lease_key = p_lease_key
        RETURNING * INTO v_row;

        RETURN QUERY SELECT TRUE, v_row.holder_id, v_row.holder_host, v_row.holder_pid, v_row.holder_role, v_row.generation, v_row.expires_at;
        RETURN;
    END IF;

    -- Another instance is currently holding an active lease
    RETURN QUERY SELECT FALSE, v_row.holder_id, v_row.holder_host, v_row.holder_pid, v_row.holder_role, v_row.generation, v_row.expires_at;
END;
$$ LANGUAGE plpgsql;

-- RPC: Renew active lease
CREATE OR REPLACE FUNCTION public.ava_renew_lease(
    p_lease_key TEXT,
    p_holder_id TEXT,
    p_generation BIGINT,
    p_ttl_seconds INT DEFAULT 30
)
RETURNS BOOLEAN AS $$
DECLARE
    v_now TIMESTAMPTZ := NOW();
    v_rows_updated INT;
BEGIN
    UPDATE public.bot_leases
    SET renewed_at = v_now,
        expires_at = v_now + (p_ttl_seconds || ' seconds')::INTERVAL
    WHERE lease_key = p_lease_key
      AND holder_id = p_holder_id
      AND generation = p_generation;

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
    RETURN v_rows_updated > 0;
END;
$$ LANGUAGE plpgsql;

-- RPC: Release active lease
CREATE OR REPLACE FUNCTION public.ava_release_lease(
    p_lease_key TEXT,
    p_holder_id TEXT,
    p_generation BIGINT
)
RETURNS BOOLEAN AS $$
DECLARE
    v_rows_deleted INT;
BEGIN
    DELETE FROM public.bot_leases
    WHERE lease_key = p_lease_key
      AND holder_id = p_holder_id
      AND generation = p_generation;

    GET DIAGNOSTICS v_rows_deleted = ROW_COUNT;
    RETURN v_rows_deleted > 0;
END;
$$ LANGUAGE plpgsql;

-- 3. LOCKDOWN WRITE-AHEAD PLANS & ITEMS
CREATE TABLE IF NOT EXISTS public.lockdown_plans (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    mode TEXT NOT NULL,                       -- 'soft', 'standard', 'full'
    reason TEXT,
    duration_minutes INT NOT NULL DEFAULT 15,
    unlock_at TIMESTAMPTZ NOT NULL,
    state TEXT NOT NULL DEFAULT 'planned',    -- 'planned', 'active', 'reverting', 'restored', 'aborted', 'failed'
    plan_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    checksum TEXT NOT NULL,
    version INT NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lockdown_plans_guild ON public.lockdown_plans(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lockdown_plans_state ON public.lockdown_plans(state);

CREATE TABLE IF NOT EXISTS public.lockdown_items (
    id BIGSERIAL PRIMARY KEY,
    plan_id BIGINT NOT NULL REFERENCES public.lockdown_plans(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,                -- 'role', 'channel'
    op TEXT NOT NULL,                         -- 'role_permissions', 'channel_overwrite'
    original_value TEXT,
    changed_to TEXT,
    state TEXT NOT NULL DEFAULT 'pending',    -- 'pending', 'done', 'skipped', 'failed', 'changed_by_other', 'reverted'
    attempts INT NOT NULL DEFAULT 0,
    error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lockdown_items_plan ON public.lockdown_items(plan_id, state);
CREATE INDEX IF NOT EXISTS idx_lockdown_items_target ON public.lockdown_items(guild_id, target_id);

-- Ensure lockdown_state table has all required columns
CREATE TABLE IF NOT EXISTS public.lockdown_state (
    guild_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'idle',
    mode TEXT NOT NULL DEFAULT 'standard',
    plan_id BIGINT,
    owner_token TEXT,
    heartbeat_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 1,
    locked_channels JSONB DEFAULT '[]'::jsonb,
    unlock_at TIMESTAMPTZ,
    reason TEXT,
    initiated_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

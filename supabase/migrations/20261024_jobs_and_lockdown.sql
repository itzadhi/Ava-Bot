-- ============================================================================
-- AVA RELIABILITY OVERHAUL: PERSISTED BACKGROUND JOBS & LOCKDOWN STATE MACHINE
-- Migration: 20261024_jobs_and_lockdown.sql
-- ============================================================================

-- 1. Persisted Background Jobs Table
CREATE TABLE IF NOT EXISTS public.ava_jobs (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress JSONB NOT NULL DEFAULT '{"total":0,"done":0,"failed":0,"percentage":0}'::jsonb,
    attempts INT NOT NULL DEFAULT 0,
    last_error TEXT,
    locked_by TEXT,
    heartbeat_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

ALTER TABLE IF EXISTS public.ava_jobs
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'queued',
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{"total":0,"done":0,"failed":0,"percentage":0}'::jsonb,
    ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_error TEXT,
    ADD COLUMN IF NOT EXISTS locked_by TEXT,
    ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_ava_jobs_guild_state ON public.ava_jobs (guild_id, state);
CREATE INDEX IF NOT EXISTS idx_ava_jobs_heartbeat ON public.ava_jobs (state, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_ava_jobs_created ON public.ava_jobs (created_at DESC);

-- 2. Resumable Lockdown State Machine Table
CREATE TABLE IF NOT EXISTS public.lockdown_state (
    guild_id TEXT PRIMARY KEY,
    state TEXT NOT NULL DEFAULT 'idle', -- 'idle' | 'locking' | 'locked' | 'unlocking' | 'partial'
    started_by TEXT,
    reason TEXT,
    plan JSONB NOT NULL DEFAULT '{}'::jsonb,
    item_statuses JSONB NOT NULL DEFAULT '{}'::jsonb,
    counters JSONB NOT NULL DEFAULT '{"total":0,"locked":0,"unlocked":0,"failed":0,"skipped":0}'::jsonb,
    version INT NOT NULL DEFAULT 1,
    unlock_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Upgrade existing lockdown_state table if it was created under the legacy schema
ALTER TABLE IF EXISTS public.lockdown_state
    ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'idle',
    ADD COLUMN IF NOT EXISTS started_by TEXT,
    ADD COLUMN IF NOT EXISTS plan JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS item_statuses JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS counters JSONB NOT NULL DEFAULT '{"total":0,"locked":0,"unlocked":0,"failed":0,"skipped":0}'::jsonb,
    ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unlock_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Safely migrate legacy active boolean to state enum if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'lockdown_state' 
          AND column_name = 'active'
    ) THEN
        UPDATE public.lockdown_state 
        SET state = 'locked' 
        WHERE active = TRUE AND (state IS NULL OR state = 'idle');
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lockdown_state_status ON public.lockdown_state (state);
CREATE INDEX IF NOT EXISTS idx_lockdown_state_unlock ON public.lockdown_state (state, unlock_at);

-- 3. Composite Indexes for Anti-Nuke Channel Snapshots & Incidents
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_snapshots') THEN
        CREATE INDEX IF NOT EXISTS idx_channel_snapshots_lookup ON public.channel_snapshots (guild_id, channel_id);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'antinuke_incidents') THEN
        CREATE INDEX IF NOT EXISTS idx_antinuke_incidents_guild_time ON public.antinuke_incidents (guild_id, created_at DESC);
    END IF;
END $$;

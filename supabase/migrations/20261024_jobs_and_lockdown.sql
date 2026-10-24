-- ============================================================================
-- AVA RELIABILITY OVERHAUL: PERSISTED BACKGROUND JOBS & LOCKDOWN STATE MACHINE
-- Migration: 20261024_jobs_and_lockdown.sql
-- ============================================================================

-- 1. Persisted Background Jobs Table
CREATE TABLE IF NOT EXISTS ava_jobs (
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

CREATE INDEX IF NOT EXISTS idx_ava_jobs_guild_state ON ava_jobs (guild_id, state);
CREATE INDEX IF NOT EXISTS idx_ava_jobs_heartbeat ON ava_jobs (state, heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_ava_jobs_created ON ava_jobs (created_at DESC);

-- 2. Resumable Lockdown State Machine Table
CREATE TABLE IF NOT EXISTS lockdown_state (
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

CREATE INDEX IF NOT EXISTS idx_lockdown_state_status ON lockdown_state (state);
CREATE INDEX IF NOT EXISTS idx_lockdown_state_unlock ON lockdown_state (state, unlock_at);

-- 3. Composite Indexes for Anti-Nuke Channel Snapshots & Incidents
CREATE INDEX IF NOT EXISTS idx_channel_snapshots_lookup ON channel_snapshots (guild_id, channel_id);
CREATE INDEX IF NOT EXISTS idx_antinuke_incidents_guild_time ON antinuke_incidents (guild_id, created_at DESC);

-- Argoni Module Data Storage
-- Generic JSON store allowing any feature module to persist data without custom migrations

CREATE TABLE IF NOT EXISTS public.module_data (
    id BIGSERIAL PRIMARY KEY,
    module_name TEXT NOT NULL,
    guild_id TEXT NOT NULL DEFAULT 'global',
    key TEXT NOT NULL,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_module_data_composite 
    ON public.module_data (module_name, guild_id, key);

CREATE INDEX IF NOT EXISTS idx_module_data_lookup 
    ON public.module_data (module_name, guild_id);

-- Enable RLS
ALTER TABLE public.module_data ENABLE ROW LEVEL SECURITY;

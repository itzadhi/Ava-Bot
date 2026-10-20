-- Argoni Database Schema: Temporary Voice (JTC), Suggestions, Feedback & Central Staff Panel
-- Protected by Row Level Security (RLS) - service_role access only

-- 1. ADD JTC & FEATURE CONFIGURATION TO GUILD SETTINGS
ALTER TABLE public.guild_settings 
  ADD COLUMN IF NOT EXISTS jtc_trigger_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS jtc_category_id TEXT,
  ADD COLUMN IF NOT EXISTS jtc_name_template TEXT NOT NULL DEFAULT '{username}''s room',
  ADD COLUMN IF NOT EXISTS jtc_default_limit INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS jtc_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS tts_announce BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suggestion_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS suggestions_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS suggestion_cooldown INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS suggestion_thread_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS suggestion_thread_slowmode INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feedback_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS feedback_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS staff_role_id TEXT;

-- 2. SUGGESTIONS TABLE
CREATE TABLE IF NOT EXISTS public.suggestions (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    author_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_avatar TEXT,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied' | 'implemented'
    moderator_id TEXT,
    moderator_tag TEXT,
    moderator_reason TEXT,
    upvotes_count INT NOT NULL DEFAULT 0,
    downvotes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_suggestions_guild_id ON public.suggestions(guild_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON public.suggestions(status);
CREATE INDEX IF NOT EXISTS idx_suggestions_author_id ON public.suggestions(author_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_created_at ON public.suggestions(created_at);

-- 3. SUGGESTION VOTES TABLE
CREATE TABLE IF NOT EXISTS public.suggestion_votes (
    id BIGSERIAL PRIMARY KEY,
    suggestion_id TEXT NOT NULL REFERENCES public.suggestions(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    vote_type TEXT NOT NULL, -- 'up' | 'down'
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_suggestion_user_vote UNIQUE (suggestion_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_suggestion_votes_lookup ON public.suggestion_votes(suggestion_id, user_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_votes_guild ON public.suggestion_votes(guild_id);

-- 4. FEEDBACK TABLE
CREATE TABLE IF NOT EXISTS public.feedback (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    author_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_avatar TEXT,
    category TEXT NOT NULL DEFAULT 'Other', -- 'Bug' | 'Feature' | 'Voice' | 'TTS' | 'Other'
    message TEXT NOT NULL,
    rating INT,
    status TEXT NOT NULL DEFAULT 'unread', -- 'unread' | 'read' | 'resolved'
    context JSONB NOT NULL DEFAULT '{}'::jsonb, -- { channel_id, owner_id, member_count, tts_state }
    reply TEXT,
    replied_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_feedback_guild_id ON public.feedback(guild_id);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON public.feedback(status);
CREATE INDEX IF NOT EXISTS idx_feedback_category ON public.feedback(category);

-- 5. PANEL STATE TABLE (Persistent centralized staff panel)
CREATE TABLE IF NOT EXISTS public.panel_state (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT,
    message_id TEXT,
    active_tab TEXT NOT NULL DEFAULT 'sug', -- 'sug' | 'fbk' | 'voice' | 'settings'
    filter_status TEXT,
    page INT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.panel_state ALTER COLUMN channel_id DROP NOT NULL;
ALTER TABLE public.panel_state ALTER COLUMN message_id DROP NOT NULL;

-- 6. TEMP CHANNELS TABLE (Active join-to-create voice channels)
CREATE TABLE IF NOT EXISTS public.temp_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    control_message_id TEXT,
    control_channel_id TEXT,
    name TEXT NOT NULL,
    user_limit INT NOT NULL DEFAULT 0,
    bitrate INT NOT NULL DEFAULT 64000,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
    tts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_temp_channels_guild ON public.temp_channels(guild_id);
CREATE INDEX IF NOT EXISTS idx_temp_channels_owner ON public.temp_channels(owner_id);

-- 7. USER VOICE PREFS TABLE
CREATE TABLE IF NOT EXISTS public.user_voice_prefs (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    preferred_name TEXT,
    preferred_limit INT,
    preferred_bitrate INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, guild_id)
);

-- 8. TTS PREFS TABLE
CREATE TABLE IF NOT EXISTS public.tts_prefs (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    opt_out BOOLEAN NOT NULL DEFAULT FALSE,
    language TEXT NOT NULL DEFAULT 'en',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    PRIMARY KEY (user_id, guild_id)
);

-- ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestion_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.panel_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.temp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_voice_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tts_prefs ENABLE ROW LEVEL SECURITY;

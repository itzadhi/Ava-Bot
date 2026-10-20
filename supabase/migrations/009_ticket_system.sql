-- Argoni Database Schema: Complete Production-Grade Ticket System
-- Migration: 009_ticket_system.sql
-- Protected by Row Level Security (RLS) - service_role access only

-- 1. GUILD TICKET COUNTERS (Atomic guild-scoped ticket numbers)
CREATE TABLE IF NOT EXISTS public.ticket_counters (
    guild_id TEXT PRIMARY KEY,
    last_number INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- RPC Function for Atomic Number Generation
CREATE OR REPLACE FUNCTION public.next_ticket_number(p_guild_id TEXT)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_next INT;
BEGIN
    INSERT INTO public.ticket_counters (guild_id, last_number, updated_at)
    VALUES (p_guild_id, 1, timezone('utc'::text, now()))
    ON CONFLICT (guild_id)
    DO UPDATE SET 
        last_number = public.ticket_counters.last_number + 1,
        updated_at = timezone('utc'::text, now())
    RETURNING last_number INTO v_next;

    RETURN v_next;
END;
$$;

-- 2. TICKET SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.ticket_settings (
    guild_id TEXT PRIMARY KEY REFERENCES public.guild_settings(guild_id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ticket_type TEXT NOT NULL DEFAULT 'channel', -- 'channel' | 'thread'
    channel_category_id TEXT, -- Fallback category channel for ticket channels
    name_format TEXT NOT NULL DEFAULT 'ticket-{number}',
    max_open_per_user INT NOT NULL DEFAULT 3,
    cooldown_seconds INT NOT NULL DEFAULT 30,
    min_account_age_days INT NOT NULL DEFAULT 0,
    min_server_age_days INT NOT NULL DEFAULT 0,
    support_role_ids TEXT[] NOT NULL DEFAULT '{}',
    admin_role_ids TEXT[] NOT NULL DEFAULT '{}',
    log_channel_id TEXT,
    transcript_channel_id TEXT,
    autoclose_hours INT NOT NULL DEFAULT 0, -- 0 = disabled
    autoclose_warning_hours INT NOT NULL DEFAULT 0,
    autodelete_delay_seconds INT NOT NULL DEFAULT 10,
    rating_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    claim_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    welcome_message TEXT NOT NULL DEFAULT 'Thank you for reaching out to support! A staff member will assist you shortly.',
    close_message TEXT NOT NULL DEFAULT 'This ticket has been closed by {staff}.',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_settings_enabled ON public.ticket_settings(enabled);

-- 3. TICKET PANELS TABLE (Multiple panels per server)
CREATE TABLE IF NOT EXISTS public.ticket_panels (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    title TEXT NOT NULL DEFAULT 'Support Tickets',
    description TEXT NOT NULL DEFAULT 'Need assistance? Open a ticket below to contact our support team.',
    banner_url TEXT,
    thumbnail_url TEXT,
    style TEXT NOT NULL DEFAULT 'select', -- 'buttons' | 'select' | 'single'
    button_label TEXT DEFAULT 'Open Ticket',
    button_emoji TEXT DEFAULT '🎫',
    category_ids TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild ON public.ticket_panels(guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_panels_channel ON public.ticket_panels(channel_id);

-- 4. TICKET CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS public.ticket_categories (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🎫',
    description TEXT DEFAULT 'General inquiries and support',
    banner_url TEXT,
    thumbnail_url TEXT,
    channel_category_id TEXT, -- Discord category to create tickets in
    support_role_ids TEXT[] NOT NULL DEFAULT '{}',
    ping_role_ids TEXT[] NOT NULL DEFAULT '{}',
    required_role_ids TEXT[] NOT NULL DEFAULT '{}',
    blocked_role_ids TEXT[] NOT NULL DEFAULT '{}',
    max_open_per_user INT NOT NULL DEFAULT 1,
    claim_required BOOLEAN NOT NULL DEFAULT FALSE,
    welcome_template TEXT,
    name_format TEXT DEFAULT 'ticket-{number}',
    position INT NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_categories_guild ON public.ticket_categories(guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_categories_pos ON public.ticket_categories(guild_id, position);

-- 5. TICKET CUSTOM QUESTIONS (Modals per category)
CREATE TABLE IF NOT EXISTS public.ticket_questions (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES public.ticket_categories(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    label TEXT NOT NULL,
    placeholder TEXT,
    style TEXT NOT NULL DEFAULT 'paragraph', -- 'short' | 'paragraph'
    required BOOLEAN NOT NULL DEFAULT TRUE,
    position INT NOT NULL DEFAULT 0,
    min_length INT DEFAULT 0,
    max_length INT DEFAULT 1000
);

CREATE INDEX IF NOT EXISTS idx_ticket_questions_cat ON public.ticket_questions(category_id, position);

-- 6. TICKETS TABLE
CREATE TABLE IF NOT EXISTS public.tickets (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    ticket_number INT NOT NULL,
    category_id TEXT REFERENCES public.ticket_categories(id) ON DELETE SET NULL,
    category_name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    owner_username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open', -- 'open' | 'claimed' | 'closed' | 'locked'
    priority TEXT NOT NULL DEFAULT 'normal', -- 'low' | 'normal' | 'high' | 'urgent'
    claimed_by TEXT, -- user ID of staff
    claimed_at TIMESTAMPTZ,
    closed_by TEXT,
    closed_at TIMESTAMPTZ,
    close_reason TEXT,
    close_request_from TEXT,
    close_request_at TIMESTAMPTZ,
    control_message_id TEXT,
    question_answers JSONB NOT NULL DEFAULT '{}'::jsonb,
    banner_url TEXT,
    thumbnail_url TEXT,
    transcript_url TEXT,
    rating INT,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    warning_sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild ON public.tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_channel ON public.tickets(channel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_owner ON public.tickets(guild_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_last_msg ON public.tickets(status, last_message_at);

-- 7. INTERNAL STAFF NOTES TABLE
CREATE TABLE IF NOT EXISTS public.ticket_notes (
    id BIGSERIAL PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_username TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_notes_ticket ON public.ticket_notes(ticket_id);

-- 8. TICKET RATINGS & REVIEWS TABLE
CREATE TABLE IF NOT EXISTS public.ticket_ratings (
    id BIGSERIAL PRIMARY KEY,
    ticket_id TEXT NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    staff_id TEXT,
    rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    feedback TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_ratings_guild ON public.ticket_ratings(guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_staff ON public.ticket_ratings(guild_id, staff_id);

-- 9. TICKET BLACKLIST TABLE
CREATE TABLE IF NOT EXISTS public.ticket_blacklist (
    id BIGSERIAL PRIMARY KEY,
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'user', -- 'user' | 'role'
    reason TEXT NOT NULL DEFAULT 'No reason provided',
    moderator_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_ticket_blacklist UNIQUE (guild_id, target_id)
);

CREATE INDEX IF NOT EXISTS idx_ticket_blacklist_lookup ON public.ticket_blacklist(guild_id, target_id);

-- 10. TICKET CANNED MACROS TABLE
CREATE TABLE IF NOT EXISTS public.ticket_macros (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_ticket_macro_name UNIQUE (guild_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ticket_macros_lookup ON public.ticket_macros(guild_id, name);

-- 11. TICKET TRANSCRIPTS TABLE
CREATE TABLE IF NOT EXISTS public.ticket_transcripts (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    ticket_number INT NOT NULL,
    owner_id TEXT NOT NULL,
    html_url TEXT,
    storage_path TEXT,
    message_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_guild ON public.ticket_transcripts(guild_id);
CREATE INDEX IF NOT EXISTS idx_ticket_transcripts_ticket ON public.ticket_transcripts(ticket_id);

-- 12. ENABLE ROW LEVEL SECURITY (RLS) FOR ALL TABLES
ALTER TABLE public.ticket_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_transcripts ENABLE ROW LEVEL SECURITY;

-- Note on Row Level Security: The bot connects exclusively via the Supabase Service Role Key,
-- bypassing RLS server-side while safeguarding all tables against unauthorized public access.

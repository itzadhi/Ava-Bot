-- ==============================================================================
-- ARGONI HIGH-PERFORMANCE DATABASE INDEXES MIGRATION (100% FAIL-SAFE & DYNAMIC)
-- Date: 2026-10-23
-- Purpose: Accelerate hot-path queries, eliminate sequential scans, and protect
--          interaction handlers from timeouts. Dynamically checks table existence
--          so it NEVER fails even if some feature tables have not been migrated yet.
-- INSTRUCTION: Run this script directly in your Supabase SQL Editor.
-- ==============================================================================

DO $$
BEGIN
  -- 1. TICKETS SYSTEM
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tickets') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tickets_guild_status ON public.tickets(guild_id, status)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tickets_guild_channel ON public.tickets(guild_id, channel_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_tickets_guild_owner ON public.tickets(guild_id, owner_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_panels') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild_msg ON public.ticket_panels(guild_id, message_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ticket_counters') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ticket_counters_guild ON public.ticket_counters(guild_id)';
  END IF;

  -- 2. ANTI-NUKE PROTECTION SYSTEM
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'antinuke_trusted') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_antinuke_trusted_lookup ON public.antinuke_trusted(guild_id, target_id, target_type)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'antinuke_exempt') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_antinuke_exempt_lookup ON public.antinuke_exempt(guild_id, target_id, type)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_snapshots') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_channel_snapshots_lookup ON public.channel_snapshots(guild_id, channel_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'antinuke_incidents') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_antinuke_incidents_guild_time ON public.antinuke_incidents(guild_id, created_at DESC)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'lockdown_state') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_lockdown_state_guild ON public.lockdown_state(guild_id)';
  END IF;

  -- 3. AUTOMOD FILTERING SYSTEM
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automod_words') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_automod_words_lookup ON public.automod_words(guild_id, word)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automod_allowlist') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_automod_allowlist_lookup ON public.automod_allowlist(guild_id, word)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automod_regex') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_automod_regex_guild ON public.automod_regex(guild_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automod_exemptions') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_automod_exemptions_lookup ON public.automod_exemptions(guild_id, target_id, type)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'automod_strikes') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_automod_strikes_lookup ON public.automod_strikes(guild_id, user_id)';
  END IF;

  -- 4. PERMIFY ACCESS CONTROL & ROLES
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'permify_snapshots') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_permify_snapshots_guild_time ON public.permify_snapshots(guild_id, created_at DESC)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'guild_roles') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_guild_roles_guild_lookup ON public.guild_roles(guild_id)';
  END IF;

  -- 5. VOICE, SUGGESTIONS, FEEDBACK & STICKY
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'temp_channels') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_temp_channels_guild_owner ON public.temp_channels(guild_id, owner_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'suggestions') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_suggestions_guild_status ON public.suggestions(guild_id, status, created_at DESC)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feedback') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_feedback_guild_status ON public.feedback(guild_id, status, created_at DESC)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sticky_notes') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sticky_notes_guild_chan ON public.sticky_notes(guild_id, channel_id)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'sticky_roles') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_sticky_roles_guild_user ON public.sticky_roles(guild_id, user_id)';
  END IF;

  -- 6. SYSTEM LOGS & AUDIT TIMELINES
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_created ON public.audit_logs(guild_id, created_at DESC)';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'error_logs') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs(created_at DESC)';
  END IF;

END $$;

-- Dynamically analyze all existing tables in public schema
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name IN (
        'guild_settings', 'tickets', 'ticket_panels', 'ticket_counters',
        'antinuke_settings', 'antinuke_trusted', 'channel_snapshots', 
        'automod_settings', 'automod_words', 'temp_channels', 
        'suggestions', 'feedback', 'sticky_notes', 'sticky_roles', 
        'permify_snapshots', 'guild_roles', 'audit_logs', 'error_logs'
      )
  LOOP
    EXECUTE 'ANALYZE public.' || quote_ident(tbl);
  END LOOP;
END $$;

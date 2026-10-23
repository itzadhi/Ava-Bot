-- ==============================================================================
-- ARGONI HIGH-PERFORMANCE DATABASE INDEXES MIGRATION
-- Date: 2026-10-23
-- Purpose: Accelerate hot-path queries, eliminate sequential scans, and protect
--          interaction handlers from timeouts on high-volume tables.
-- INSTRUCTION: Run this script directly in your Supabase SQL Editor.
-- ==============================================================================

-- 1. TICKETS SYSTEM
CREATE INDEX IF NOT EXISTS idx_tickets_guild_status 
  ON public.tickets(guild_id, status);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_channel 
  ON public.tickets(guild_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_tickets_guild_owner 
  ON public.tickets(guild_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild_msg 
  ON public.ticket_panels(guild_id, message_id);

CREATE INDEX IF NOT EXISTS idx_ticket_counters_guild 
  ON public.ticket_counters(guild_id);

-- 2. ANTI-NUKE PROTECTION SYSTEM
CREATE INDEX IF NOT EXISTS idx_antinuke_trusted_lookup 
  ON public.antinuke_trusted(guild_id, target_id, target_type);

CREATE INDEX IF NOT EXISTS idx_antinuke_exempt_lookup 
  ON public.antinuke_exempt(guild_id, target_id, type);

CREATE INDEX IF NOT EXISTS idx_channel_snapshots_lookup 
  ON public.channel_snapshots(guild_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_channel_snapshots_parent 
  ON public.channel_snapshots(guild_id, parent_id);

CREATE INDEX IF NOT EXISTS idx_antinuke_incidents_guild_time 
  ON public.antinuke_incidents(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lockdown_state_guild 
  ON public.lockdown_state(guild_id);

-- 3. AUTOMOD FILTERING SYSTEM
CREATE INDEX IF NOT EXISTS idx_automod_words_lookup 
  ON public.automod_words(guild_id, word);

CREATE INDEX IF NOT EXISTS idx_automod_allowlist_lookup 
  ON public.automod_allowlist(guild_id, word);

CREATE INDEX IF NOT EXISTS idx_automod_regex_guild 
  ON public.automod_regex(guild_id);

CREATE INDEX IF NOT EXISTS idx_automod_exemptions_lookup 
  ON public.automod_exemptions(guild_id, target_id, type);

CREATE INDEX IF NOT EXISTS idx_automod_strikes_lookup 
  ON public.automod_strikes(guild_id, user_id);

-- 4. PERMIFY ACCESS CONTROL SYSTEM
CREATE INDEX IF NOT EXISTS idx_permify_role_groups_guild 
  ON public.permify_role_groups(guild_id);

CREATE INDEX IF NOT EXISTS idx_permify_channel_overrides_lookup 
  ON public.permify_channel_overrides(guild_id, channel_id);

-- 5. VOICE, SUGGESTIONS & FEEDBACK
CREATE INDEX IF NOT EXISTS idx_voice_channels_guild_owner 
  ON public.voice_channels(guild_id, owner_id);

CREATE INDEX IF NOT EXISTS idx_voice_channels_guild_chan 
  ON public.voice_channels(guild_id, channel_id);

CREATE INDEX IF NOT EXISTS idx_suggestions_guild_status 
  ON public.suggestions(guild_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_reviews_guild_status 
  ON public.feedback_reviews(guild_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sticky_messages_guild_chan 
  ON public.sticky_messages(guild_id, channel_id);

-- 6. SYSTEM LOGS & AUDIT TIMELINES
CREATE INDEX IF NOT EXISTS idx_audit_logs_guild_created 
  ON public.audit_logs(guild_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at 
  ON public.error_logs(created_at DESC);

-- Analyze statistics to optimize PostgreSQL query planner
ANALYZE public.guild_settings;
ANALYZE public.tickets;
ANALYZE public.ticket_panels;
ANALYZE public.antinuke_settings;
ANALYZE public.antinuke_trusted;
ANALYZE public.channel_snapshots;
ANALYZE public.automod_settings;
ANALYZE public.automod_words;
ANALYZE public.permify_role_groups;
ANALYZE public.voice_channels;
ANALYZE public.suggestions;
ANALYZE public.feedback_reviews;

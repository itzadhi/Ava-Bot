-- Migration: Create atomic bot data reset function
-- File: supabase/migrations/20261024_reset_all.sql
-- Run this in your Supabase SQL editor to enable the atomic reset RPC.

CREATE OR REPLACE FUNCTION public.ava_reset_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_bot_tables text[] := ARRAY[
    'antinuke_actions', 'antinuke_exempt', 'antinuke_incidents', 'antinuke_settings',
    'antinuke_snapshots', 'antinuke_trusted', 'audit_logs', 'automod_allowlist',
    'automod_exemptions', 'automod_incidents', 'automod_regex', 'automod_settings',
    'automod_strikes', 'automod_words', 'ava_jobs', 'backup_intervals', 'backups',
    'blacklist', 'boost_history', 'bot_instances', 'bot_state', 'channel_snapshots',
    'chatlogs', 'error_logs', 'feedback', 'guild_roles', 'guild_settings',
    'lockdown_state', 'module_data', 'panel_state', 'permify_snapshots',
    'premium_codes', 'shop_blacklist', 'shop_categories', 'shop_coupon_uses',
    'shop_coupons', 'shop_order_events', 'shop_order_sequences', 'shop_orders',
    'shop_products', 'shop_reviews', 'shop_settings', 'shop_stock_items',
    'shop_waitlist', 'sticky_messages', 'sticky_notes', 'sticky_roles',
    'suggestion_votes', 'suggestions', 'synced_messages', 'syncs',
    'temp_channels', 'templates', 'ticket_blacklist', 'ticket_categories',
    'ticket_counters', 'ticket_macros', 'ticket_notes', 'ticket_panels',
    'ticket_questions', 'ticket_ratings', 'ticket_settings', 'ticket_transcripts',
    'tickets', 'transcripts', 'tts_prefs', 'user_voice_prefs'
  ];
  v_sql text;
  v_existing_tables text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_table IN ARRAY v_bot_tables LOOP
    IF to_regclass('public.' || quote_ident(v_table)) IS NOT NULL THEN
      v_existing_tables := array_append(v_existing_tables, 'public.' || quote_ident(v_table));
    END IF;
  END LOOP;

  IF array_length(v_existing_tables, 1) > 0 THEN
    v_sql := 'TRUNCATE TABLE ' || array_to_string(v_existing_tables, ', ') || ' RESTART IDENTITY CASCADE';
    EXECUTE v_sql;
  END IF;

  RETURN jsonb_build_object(
    'status', 'success',
    'truncated_count', coalesce(array_length(v_existing_tables, 1), 0),
    'tables', v_existing_tables,
    'timestamp', now()
  );
END;
$$;

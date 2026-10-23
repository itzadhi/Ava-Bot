-- ============================================================================
-- ARGONI SHOP SYSTEM & INSTANCE TELEMETRY SCHEMA
-- Migration: 20261023_shop.sql
-- Description: Production schema for complete Argoni Shop system & bot instances
-- DO NOT RUN AUTOMATICALLY: Run in Supabase SQL Editor manually.
-- ============================================================================

-- Enable pgcrypto / uuid-ossp for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. BOT INSTANCES (Dual-instance heartbeat detection)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.bot_instances (
    instance_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    pid INTEGER NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_instances_last_seen ON public.bot_instances (last_seen);

-- ============================================================================
-- 2. SHOP SETTINGS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_settings (
    guild_id TEXT PRIMARY KEY,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    currency TEXT NOT NULL DEFAULT 'INR',
    currency_symbol TEXT NOT NULL DEFAULT '₹',
    locale TEXT NOT NULL DEFAULT 'en-IN',
    payment_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
    ticket_category_id TEXT DEFAULT NULL,
    support_role_ids TEXT[] NOT NULL DEFAULT '{}',
    manager_role_ids TEXT[] NOT NULL DEFAULT '{}',
    buyer_role_id TEXT DEFAULT NULL,
    max_open_orders_per_user INTEGER NOT NULL DEFAULT 3,
    orders_channel_id TEXT DEFAULT NULL,
    delivery_channel_id TEXT DEFAULT NULL,
    vouch_channel_id TEXT DEFAULT NULL,
    restock_channel_id TEXT DEFAULT NULL,
    restock_ping_role_id TEXT DEFAULT NULL,
    banner_theme TEXT NOT NULL DEFAULT 'dark',
    banner_font TEXT NOT NULL DEFAULT 'Inter',
    default_accent_color TEXT NOT NULL DEFAULT '#6366F1',
    stock_display_mode TEXT NOT NULL DEFAULT 'exact', -- 'exact' | 'threshold' | 'hidden'
    low_stock_threshold INTEGER NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_settings_guild_id ON public.shop_settings (guild_id);

-- ============================================================================
-- 3. SHOP CATEGORIES (Discord category mappings)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    discord_category_id TEXT DEFAULT NULL,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📦',
    accent_color TEXT NOT NULL DEFAULT '#6366F1',
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_categories_guild_id ON public.shop_categories (guild_id);
CREATE INDEX IF NOT EXISTS idx_shop_categories_discord ON public.shop_categories (discord_category_id);

-- ============================================================================
-- 4. SHOP PRODUCTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    category_id UUID REFERENCES public.shop_categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    price_minor BIGINT NOT NULL DEFAULT 0,
    compare_at_minor BIGINT DEFAULT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    stock_type TEXT NOT NULL DEFAULT 'unlimited', -- 'unlimited' | 'quantity' | 'items'
    stock_count INTEGER NOT NULL DEFAULT 0,
    low_stock_threshold INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'paused' | 'archived'
    channel_id TEXT DEFAULT NULL,
    message_id TEXT DEFAULT NULL,
    banner_path TEXT DEFAULT NULL,
    banner_hash TEXT DEFAULT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    sale_start TIMESTAMPTZ DEFAULT NULL,
    sale_end TIMESTAMPTZ DEFAULT NULL,
    max_per_order INTEGER NOT NULL DEFAULT 1,
    per_user_limit INTEGER DEFAULT NULL,
    delivery_mode TEXT NOT NULL DEFAULT 'automatic', -- 'automatic' | 'manual'
    warranty_text TEXT DEFAULT '24 Hours Warranty',
    delivery_time_text TEXT DEFAULT 'Instant Delivery',
    notes TEXT DEFAULT '',
    needs_sync BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_product_slug UNIQUE (guild_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_shop_products_guild ON public.shop_products (guild_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_category ON public.shop_products (category_id);
CREATE INDEX IF NOT EXISTS idx_shop_products_status ON public.shop_products (status);
CREATE INDEX IF NOT EXISTS idx_shop_products_channel ON public.shop_products (channel_id);

-- ============================================================================
-- 5. SHOP STOCK ITEMS (Encrypted deliverables like keys/accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_stock_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    tag TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available', -- 'available' | 'reserved' | 'sold' | 'faulty'
    reserved_order_id UUID DEFAULT NULL,
    reserved_until TIMESTAMPTZ DEFAULT NULL,
    sold_order_id UUID DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_stock_items_product ON public.shop_stock_items (product_id);
CREATE INDEX IF NOT EXISTS idx_shop_stock_items_status ON public.shop_stock_items (status);
CREATE INDEX IF NOT EXISTS idx_shop_stock_items_reservation ON public.shop_stock_items (reserved_order_id, reserved_until);

-- ============================================================================
-- 6. SHOP ORDERS & PER-GUILD SEQUENTIAL COUNTER
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_order_sequences (
    guild_id TEXT PRIMARY KEY,
    last_number BIGINT NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS public.shop_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    number BIGINT NOT NULL,
    user_id TEXT NOT NULL,
    product_id UUID NOT NULL REFERENCES public.shop_products(id),
    product_name_snapshot TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_minor BIGINT NOT NULL,
    total_minor BIGINT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    coupon_id UUID DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'awaiting_payment' | 'paid' | 'delivered' | 'completed' | 'cancelled' | 'expired' | 'refunded' | 'disputed'
    ticket_channel_id TEXT DEFAULT NULL,
    reserved_until TIMESTAMPTZ DEFAULT NULL,
    notes TEXT DEFAULT NULL,
    delivered_payload JSONB DEFAULT NULL, -- masked deliverable logs or metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_guild ON public.shop_orders (guild_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user ON public.shop_orders (guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status ON public.shop_orders (status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_product ON public.shop_orders (product_id);
CREATE INDEX IF NOT EXISTS idx_shop_orders_ticket ON public.shop_orders (ticket_channel_id);

-- ============================================================================
-- 7. SHOP ORDER EVENTS (Audit timeline)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_order_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_order_events_order ON public.shop_order_events (order_id);

-- ============================================================================
-- 8. SHOP COUPONS & COUPON USES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    code TEXT NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'percent', -- 'percent' | 'fixed'
    value_minor BIGINT NOT NULL,
    min_order_minor BIGINT DEFAULT 0,
    max_uses INTEGER DEFAULT NULL,
    uses_count INTEGER NOT NULL DEFAULT 0,
    per_user_limit INTEGER DEFAULT 1,
    expires_at TIMESTAMPTZ DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    product_ids TEXT[] NOT NULL DEFAULT '{}',
    category_ids TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_coupon_code UNIQUE (guild_id, code)
);

CREATE INDEX IF NOT EXISTS idx_shop_coupons_guild ON public.shop_coupons (guild_id, code);

CREATE TABLE IF NOT EXISTS public.shop_coupon_uses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    coupon_id UUID NOT NULL REFERENCES public.shop_coupons(id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    order_id UUID NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_coupon_uses_user ON public.shop_coupon_uses (coupon_id, user_id);

-- ============================================================================
-- 9. SHOP WAITLIST (Out-of-stock notification queue)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_waitlist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    product_id UUID NOT NULL REFERENCES public.shop_products(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_waitlist_user UNIQUE (product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_waitlist_product ON public.shop_waitlist (product_id);

-- ============================================================================
-- 10. SHOP BLACKLIST
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_blacklist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'Blacklisted from shop',
    expires_at TIMESTAMPTZ DEFAULT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_shop_blacklist_user UNIQUE (guild_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_blacklist_lookup ON public.shop_blacklist (guild_id, user_id);

-- ============================================================================
-- 11. SHOP REVIEWS & VOUCHES
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shop_reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    guild_id TEXT NOT NULL,
    order_id UUID REFERENCES public.shop_orders(id) ON DELETE SET NULL,
    product_id UUID REFERENCES public.shop_products(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL,
    stars INTEGER NOT NULL CHECK (stars >= 1 AND stars <= 5),
    comment TEXT DEFAULT '',
    vouch_message_id TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shop_reviews_guild ON public.shop_reviews (guild_id);
CREATE INDEX IF NOT EXISTS idx_shop_reviews_product ON public.shop_reviews (product_id);

-- ============================================================================
-- 12. RPC FUNCTIONS (Atomic stock reservation & order management)
-- ============================================================================

-- Function: Atomic order number allocation per guild
CREATE OR REPLACE FUNCTION public.shop_next_order_number(p_guild_id TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_next BIGINT;
BEGIN
    INSERT INTO public.shop_order_sequences (guild_id, last_number)
    VALUES (p_guild_id, 1001)
    ON CONFLICT (guild_id)
    DO UPDATE SET last_number = public.shop_order_sequences.last_number + 1
    RETURNING last_number INTO v_next;

    RETURN v_next;
END;
$$;

-- Function: Atomic stock reservation with row locking
CREATE OR REPLACE FUNCTION public.shop_reserve_stock(
    p_product_id UUID,
    p_order_id UUID,
    p_quantity INTEGER,
    p_ttl_minutes INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_product public.shop_products%ROWTYPE;
    v_reserved_count INTEGER := 0;
    v_item_ids UUID[];
    v_expiry TIMESTAMPTZ;
BEGIN
    v_expiry := NOW() + (p_ttl_minutes || ' minutes')::interval;

    -- Lock product row
    SELECT * INTO v_product
    FROM public.shop_products
    WHERE id = p_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
    END IF;

    IF v_product.status != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_ACTIVE');
    END IF;

    -- Case 1: Unlimited stock
    IF v_product.stock_type = 'unlimited' THEN
        RETURN jsonb_build_object(
            'success', true,
            'stock_type', 'unlimited',
            'quantity', p_quantity,
            'reserved_until', v_expiry
        );
    END IF;

    -- Case 2: Quantity numeric stock
    IF v_product.stock_type = 'quantity' THEN
        IF v_product.stock_count < p_quantity THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUT_OF_STOCK',
                'available', v_product.stock_count
            );
        END IF;

        -- Decrement product stock atomically
        UPDATE public.shop_products
        SET stock_count = stock_count - p_quantity,
            updated_at = NOW()
        WHERE id = p_product_id;

        RETURN jsonb_build_object(
            'success', true,
            'stock_type', 'quantity',
            'quantity', p_quantity,
            'remaining_stock', v_product.stock_count - p_quantity,
            'reserved_until', v_expiry
        );
    END IF;

    -- Case 3: Items based unique deliverables (select FOR UPDATE SKIP LOCKED)
    IF v_product.stock_type = 'items' THEN
        SELECT ARRAY_AGG(sub.id) INTO v_item_ids
        FROM (
            SELECT id
            FROM public.shop_stock_items
            WHERE product_id = p_product_id
              AND status = 'available'
            ORDER BY created_at ASC
            LIMIT p_quantity
            FOR UPDATE SKIP LOCKED
        ) sub;

        IF v_item_ids IS NULL OR ARRAY_LENGTH(v_item_ids, 1) < p_quantity THEN
            RETURN jsonb_build_object(
                'success', false,
                'error', 'OUT_OF_STOCK',
                'available', COALESCE(ARRAY_LENGTH(v_item_ids, 1), 0)
            );
        END IF;

        -- Reserve item rows
        UPDATE public.shop_stock_items
        SET status = 'reserved',
            reserved_order_id = p_order_id,
            reserved_until = v_expiry,
            updated_at = NOW()
        WHERE id = ANY(v_item_ids);

        -- Update product stock count
        UPDATE public.shop_products
        SET stock_count = (
            SELECT COUNT(*)
            FROM public.shop_stock_items
            WHERE product_id = p_product_id AND status = 'available'
        ),
        updated_at = NOW()
        WHERE id = p_product_id;

        RETURN jsonb_build_object(
            'success', true,
            'stock_type', 'items',
            'quantity', p_quantity,
            'item_ids', v_item_ids,
            'reserved_until', v_expiry
        );
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'INVALID_STOCK_TYPE');
END;
$$;

-- Function: Release expired order reservations
CREATE OR REPLACE FUNCTION public.shop_release_expired()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order RECORD;
    v_released_count INTEGER := 0;
    v_product RECORD;
BEGIN
    FOR v_order IN
        SELECT id, product_id, quantity
        FROM public.shop_orders
        WHERE status IN ('pending', 'awaiting_payment')
          AND reserved_until IS NOT NULL
          AND reserved_until < NOW()
        FOR UPDATE
    LOOP
        -- Release reserved items
        UPDATE public.shop_stock_items
        SET status = 'available',
            reserved_order_id = NULL,
            reserved_until = NULL,
            updated_at = NOW()
        WHERE reserved_order_id = v_order.id
          AND status = 'reserved';

        -- If quantity stock, restore stock count
        SELECT stock_type INTO v_product FROM public.shop_products WHERE id = v_order.product_id;
        IF v_product.stock_type = 'quantity' THEN
            UPDATE public.shop_products
            SET stock_count = stock_count + v_order.quantity,
                updated_at = NOW()
            WHERE id = v_order.product_id;
        ELSIF v_product.stock_type = 'items' THEN
            UPDATE public.shop_products
            SET stock_count = (
                SELECT COUNT(*) FROM public.shop_stock_items
                WHERE product_id = v_order.product_id AND status = 'available'
            ),
            updated_at = NOW()
            WHERE id = v_order.product_id;
        END IF;

        -- Update order status
        UPDATE public.shop_orders
        SET status = 'expired',
            updated_at = NOW()
        WHERE id = v_order.id;

        v_released_count := v_released_count + 1;
    END LOOP;

    RETURN jsonb_build_object('released_orders', v_released_count);
END;
$$;

-- Function: Complete order and mark deliverables sold
CREATE OR REPLACE FUNCTION public.shop_complete_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_order public.shop_orders%ROWTYPE;
BEGIN
    SELECT * INTO v_order FROM public.shop_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'ORDER_NOT_FOUND');
    END IF;

    -- Mark items sold
    UPDATE public.shop_stock_items
    SET status = 'sold',
        sold_order_id = p_order_id,
        reserved_order_id = NULL,
        reserved_until = NULL,
        updated_at = NOW()
    WHERE reserved_order_id = p_order_id;

    -- Update order status
    UPDATE public.shop_orders
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 13. STORAGE BUCKET: shop-banners
-- ============================================================================
-- NOTE: In Supabase dashboard:
-- 1. Go to Storage -> New Bucket
-- 2. Name: "shop-banners"
-- 3. Public bucket: TRUE (allows Discord CDN attachment / banner fetching)
-- 4. File size limit: 5MB
-- 5. Allowed MIME types: image/png, image/jpeg, image/webp

-- ============================================================================
-- 14. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Argoni runs exclusively with the Supabase Service Role Key on the server-side,
-- which bypasses RLS by default. Enable RLS on all shop tables for defense in depth.
ALTER TABLE public.bot_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_stock_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_coupon_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_reviews ENABLE ROW LEVEL SECURITY;

-- Service role full access policies
DO $$
BEGIN
    EXECUTE 'CREATE POLICY "Service role full access bot_instances" ON public.bot_instances FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_settings" ON public.shop_settings FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_categories" ON public.shop_categories FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_products" ON public.shop_products FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_stock_items" ON public.shop_stock_items FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_orders" ON public.shop_orders FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_order_events" ON public.shop_order_events FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_coupons" ON public.shop_coupons FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_coupon_uses" ON public.shop_coupon_uses FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_waitlist" ON public.shop_waitlist FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_blacklist" ON public.shop_blacklist FOR ALL TO service_role USING (true) WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "Service role full access shop_reviews" ON public.shop_reviews FOR ALL TO service_role USING (true) WITH CHECK (true)';
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

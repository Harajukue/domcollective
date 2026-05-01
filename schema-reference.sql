-- DoM Collective - Supabase Schema Reference
-- Last updated: Apr 2 2026 (rebuilt from live schema introspection)
-- Supabase Project: lnoixeskupzydjjpbvyu
-- URL: https://lnoixeskupzydjjpbvyu.supabase.co
-- DO NOT RUN THIS FILE — reference only.

-- ============================================================
-- TABLE: profiles
-- ============================================================
CREATE TABLE profiles (
    id uuid NOT NULL PRIMARY KEY,               -- links to auth.users.id
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    bio text,
    skills text[],
    website text,
    portfolio text,
    social text,
    contact text,
    avatar text,
    user_status text DEFAULT 'member',          -- 'unverified'|'verified'|'member'|'contributor'|'admin'
    projects jsonb DEFAULT '[]'::jsonb,         -- [{title, description, image, tags}]
    youtube_url text,
    instagram_url text,
    twitter_url text,
    linkedin_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    theme text DEFAULT 'default',
    profile_gallery text[] DEFAULT '{}',
    avatar_gallery text[] DEFAULT '{}',
    subscription_tier text DEFAULT 'visitor',   -- 'visitor'|'member'|'contributor'|'admin'
    phone text
);
-- RLS: Public profiles are viewable by everyone (SELECT, public)
--      Users can insert their own profile (INSERT, public, WITH CHECK auth.uid()=id)
--      Users can update their own profile (UPDATE, public, USING auth.uid()=id)
--      Users can delete their own profile (DELETE, public, USING auth.uid()=id)

-- ============================================================
-- TABLE: check_ins
-- ============================================================
CREATE TABLE check_ins (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    status text NOT NULL,                       -- 'in' | 'out'
    "timestamp" timestamptz DEFAULT now(),
    manually_set_by uuid,
    notes text
);
-- RLS: Anyone can view check-ins (SELECT, public)
--      Authenticated users can check in/out (INSERT, authenticated)
--      Admins can manually set check-ins (INSERT, public)

-- ============================================================
-- TABLE: current_check_in_status
-- ============================================================
CREATE TABLE current_check_in_status (
    user_id uuid,
    status text,                                -- 'in' | 'out'
    "timestamp" timestamptz,
    manually_set_by uuid,
    notes text
);
-- RLS: (inherits from check_ins pattern — see code)

-- ============================================================
-- TABLE: events
-- ============================================================
CREATE TABLE events (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    title text NOT NULL,
    description text,
    date date NOT NULL,
    time text,
    location text,
    type text DEFAULT 'Other',
    organizer_id uuid,
    google_calendar_id text,
    google_calendar_link text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
-- RLS: Events are viewable by everyone (SELECT, public)
--      Admins can insert events (INSERT, public)
--      Admins can update events (UPDATE, public)
--      Admins can delete events (DELETE, public)
--      Admins can manage events (ALL, public)
-- NOTE: App primarily reads events from Google Calendar API, not this table.

-- ============================================================
-- TABLE: event_settings
-- ============================================================
-- Stores admin-configurable metadata per Google Calendar event ID.
-- RLS: NOT ENABLED (table is accessible to all via anon key)
CREATE TABLE event_settings (
    event_id text NOT NULL UNIQUE,              -- Google Calendar event ID (conflict key for upsert)
    event_title text,
    extra_info text,                            -- Admin-added extra info shown in event detail
    image_url text,                             -- Hero image URL for event detail modal
    is_private boolean DEFAULT false,           -- Hides event from non-members
    tickets_enabled boolean DEFAULT false,      -- Whether paid tickets are active
    ticket_price numeric DEFAULT 0,             -- Ticket price in USD
    updated_at timestamptz,
    updated_by uuid                             -- profiles.id of admin who last saved
);
-- To create from scratch:
-- CREATE TABLE event_settings (
--     event_id text NOT NULL UNIQUE,
--     event_title text,
--     extra_info text,
--     image_url text,
--     is_private boolean DEFAULT false,
--     tickets_enabled boolean DEFAULT false,
--     ticket_price numeric DEFAULT 0,
--     updated_at timestamptz,
--     updated_by uuid
-- );
-- To add any missing columns to existing table:
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS event_title text;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS extra_info text;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS image_url text;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS is_private boolean DEFAULT false;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS tickets_enabled boolean DEFAULT false;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS ticket_price numeric DEFAULT 0;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS updated_at timestamptz;
-- ALTER TABLE event_settings ADD COLUMN IF NOT EXISTS updated_by uuid;

-- ============================================================
-- TABLE: event_rsvps
-- ============================================================
CREATE TABLE event_rsvps (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    google_event_id text NOT NULL,
    event_title text,
    event_date text,
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,   -- null for guests
    guest_name text,                            -- name for unauthenticated guest RSVPs
    created_at timestamptz DEFAULT now(),
    UNIQUE(google_event_id, user_id)
);
-- RLS: Users manage own RSVPs (ALL, authenticated, USING auth.uid()=user_id)
--      Admins view all RSVPs (SELECT, authenticated, EXISTS admin check on profiles)

-- ============================================================
-- TABLE: messages
-- ============================================================
CREATE TABLE messages (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    from_id uuid,
    to_id uuid,
    subject text NOT NULL,
    content text NOT NULL,
    sent_date timestamptz DEFAULT now(),
    read boolean DEFAULT false
);
-- RLS: Users can send messages / Verified members can send messages (INSERT)
--      Users can view their messages (SELECT, USING auth.uid()=from_id OR auth.uid()=to_id)
--      Users can update messages they received (UPDATE, USING auth.uid()=to_id)

-- ============================================================
-- TABLE: missions
-- ============================================================
CREATE TABLE missions (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    title text NOT NULL,
    description text NOT NULL,
    skills text[],
    budget text,
    author_id uuid,
    posted_date timestamptz DEFAULT now(),
    status text DEFAULT 'open',
    assigned_members uuid[] DEFAULT '{}',
    deadline date,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
-- RLS: Missions are viewable by everyone / Missions viewable by verified members (SELECT)
--      Verified members can create missions (INSERT)
--      Users can update/delete their own missions (UPDATE/DELETE, USING auth.uid()=author_id)

-- ============================================================
-- TABLE: mission_applications
-- ============================================================
CREATE TABLE mission_applications (
    id uuid NOT NULL DEFAULT uuid_generate_v4() PRIMARY KEY,
    mission_id uuid,
    applicant_id uuid,
    message text,
    status text DEFAULT 'pending',
    applied_at timestamptz DEFAULT now()
);
-- RLS: Applications viewable by mission author and applicant (SELECT)
--      Verified members can apply to missions (INSERT)

-- ============================================================
-- TABLE: paintings
-- ============================================================
CREATE TABLE paintings (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    title text NOT NULL,
    description text,
    artist_name text NOT NULL,
    artist_credit text,
    price numeric NOT NULL,
    image_url text NOT NULL,
    available boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    created_by uuid,
    updated_at timestamptz DEFAULT now()
);
-- RLS: Paintings viewable by everyone (SELECT, public)
--      Admins can insert/update/delete paintings

-- ============================================================
-- TABLE: painting_purchases
-- ============================================================
CREATE TABLE painting_purchases (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    painting_id uuid,
    buyer_id uuid,
    buyer_email text NOT NULL,
    buyer_name text NOT NULL,
    purchase_price numeric NOT NULL,
    stripe_payment_intent_id text,
    stripe_session_id text,
    status text DEFAULT 'pending',
    purchased_at timestamptz DEFAULT now()
);
-- RLS: Authenticated users can purchase (INSERT)
--      Users view own purchases (SELECT)
--      Admins can update purchases (UPDATE)

-- ============================================================
-- TABLE: payment_history
-- ============================================================
CREATE TABLE payment_history (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    subscription_id uuid,
    stripe_payment_intent_id text,
    amount numeric NOT NULL,
    currency text DEFAULT 'usd',
    status text NOT NULL,
    description text,
    created_at timestamptz DEFAULT now()
);
-- RLS: Authenticated users can insert payment history (INSERT)
--      Users can view own payment history (SELECT)

-- ============================================================
-- TABLE: subscription_tiers
-- ============================================================
CREATE TABLE subscription_tiers (
    id text NOT NULL PRIMARY KEY,
    name text NOT NULL,
    price numeric NOT NULL,
    stripe_price_id text,
    description text,
    features jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now()
);
-- RLS: Subscription tiers viewable by everyone (SELECT, public)

-- ============================================================
-- TABLE: user_subscriptions
-- ============================================================
CREATE TABLE user_subscriptions (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid UNIQUE,
    tier_id text,
    stripe_customer_id text,
    stripe_subscription_id text,
    status text DEFAULT 'active',
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
-- RLS: Users can insert/update/view own subscription

-- ============================================================
-- TABLE: space_requests
-- ============================================================
CREATE TABLE space_requests (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    user_name text,
    user_email text,
    use_types text[],                           -- e.g. ['Photography', 'Event']
    title text,
    date date,
    start_time text,
    end_time text,
    headcount integer,
    equipment text,
    description text,
    special_needs text,
    contact text,
    contribution integer,                       -- suggested dollar amount ($10–$300)
    status text DEFAULT 'pending',              -- 'pending'|'approved'|'declined'
    created_at timestamptz DEFAULT now()
);
-- RLS: Users can insert own requests (INSERT, authenticated)
--      Users can view own requests (SELECT, authenticated, USING auth.uid()=user_id)
--      Admins can view all requests (SELECT, authenticated)
--      Admins can update request status (UPDATE, authenticated)

-- ============================================================
-- TABLE: space_status
-- ============================================================
-- Single-row table (id=1). Tracks whether the physical space is open.
CREATE TABLE space_status (
    id integer PRIMARY KEY,                     -- always 1, single row
    is_open boolean DEFAULT false,
    manual_override boolean DEFAULT NULL,       -- NULL = auto (schedule), true/false = admin forced
    updated_at timestamptz,
    updated_by uuid
);
-- RLS: Anyone can view space status (SELECT, public)
--      Admins can update space status (UPDATE, authenticated)
-- Seed: INSERT INTO space_status (id, is_open) VALUES (1, false);
-- Migration: ALTER TABLE space_status ADD COLUMN IF NOT EXISTS manual_override boolean DEFAULT NULL;

-- ============================================================
-- TABLE: feedback
-- ============================================================
CREATE TABLE feedback (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name text,
    type text,                                  -- e.g. 'general', 'bug', 'feature'
    message text NOT NULL,
    user_id uuid,                               -- null if submitted anonymously
    created_at timestamptz DEFAULT now()
);
-- RLS: Anyone can insert feedback (INSERT, public)
--      Admins can read feedback (SELECT, public — scoped by admin check in code)

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
-- painting-images   — paintings gallery
-- project-images    — user project portfolio images
-- profile-galleries — user profile gallery images
-- avatars           — user avatar images

-- ============================================================
-- NOTES
-- ============================================================
-- Auth: Supabase Auth, PKCE flow, Google OAuth + Email/Password
-- Session key: 'dom-collective-auth' in localStorage
-- profiles.id links to auth.users.id
-- user_status values: 'unverified'|'verified'|'member'|'contributor'|'admin'
-- Display name mapping: visitor→Creator, member→Contributor, contributor→Catalist, admin→Catalist
-- Google Calendar ID: d392dc35dbd1a2f8807f396fcc095f16fe662aaabce1ac6df94e2100aae3378c@group.calendar.google.com
-- event_settings has NO RLS — accessible via anon key without policies

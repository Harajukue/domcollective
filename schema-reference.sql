-- DoM Collective - Supabase Schema Reference (Feb 10, 2026)
-- Machine-eyes-only reference file. DO NOT run this file.
-- Supabase Project: lnoixeskupzydjjpbvyu
-- URL: https://lnoixeskupzydjjpbvyu.supabase.co

-- ============================================================
-- TABLE: profiles
-- ============================================================
CREATE TABLE profiles (
    id uuid NOT NULL PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    bio text,
    skills text[],                          -- Array of skill tags
    website text,
    portfolio text,                         -- Portfolio website URL
    social text,
    contact text,
    avatar text,                            -- Avatar image URL
    user_status text DEFAULT 'member',      -- 'unverified' | 'verified' | 'admin' | 'member'
    projects jsonb DEFAULT '[]'::jsonb,     -- Array of {title, description, image, tags}
    youtube_url text,
    instagram_url text,
    twitter_url text,
    linkedin_url text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    theme text DEFAULT 'default',
    profile_gallery text[] DEFAULT '{}',
    avatar_gallery text[] DEFAULT '{}',
    subscription_tier text DEFAULT 'visitor',
    phone text                              -- ADDED Feb 10 2026
);
-- Indexes: profiles_pkey, profiles_email_key (unique), idx_profiles_user_status, idx_profiles_email, idx_profiles_status, idx_profiles_subscription_tier

-- ============================================================
-- TABLE: check_ins
-- ============================================================
CREATE TABLE check_ins (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    status text NOT NULL,                   -- 'in' | 'out'
    "timestamp" timestamptz DEFAULT now(),
    manually_set_by uuid,
    notes text
);
-- Indexes: check_ins_pkey, idx_check_ins_timestamp, idx_check_ins_user_id

-- ============================================================
-- TABLE: current_check_in_status
-- ============================================================
CREATE TABLE current_check_in_status (
    user_id uuid,
    status text,                            -- 'in' | 'out'
    "timestamp" timestamptz,
    manually_set_by uuid,
    notes text
);

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
-- Indexes: events_pkey, idx_events_date

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
-- Indexes: messages_pkey, idx_messages_to_id, idx_messages_from_id, idx_messages_from, idx_messages_to

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
-- Indexes: missions_pkey, idx_missions_status, idx_missions_posted_date

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
-- Indexes: paintings_pkey, idx_paintings_created_at, idx_paintings_available

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
-- Indexes: painting_purchases_pkey, idx_painting_purchases_buyer, idx_painting_purchases_painting, idx_painting_purchases_status

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
-- Indexes: idx_payment_history_user_id

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
-- Indexes: subscription_tiers_pkey

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
-- Indexes: user_subscriptions_pkey, user_subscriptions_user_id_key (unique), idx_user_subscriptions_user_id, idx_user_subscriptions_status, idx_user_subscriptions_stripe_customer

-- ============================================================
-- STORAGE BUCKETS (from Supabase Storage)
-- ============================================================
-- painting-images: paintings gallery
-- project-images: user project portfolio images
-- profile-galleries: user profile gallery images
-- avatars: user avatar images (inferred from code)

-- ============================================================
-- NOTES
-- ============================================================
-- Auth: Supabase Auth with PKCE flow, Google OAuth + Email/Password
-- Session key: 'dom-collective-auth' in localStorage
-- profiles.id links to auth.users.id
-- projects jsonb format: [{title, description, image, tags}]
-- phone column added Feb 10 2026 via: ALTER TABLE profiles ADD COLUMN phone text;

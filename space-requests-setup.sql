-- ============================================================
-- DōM Collective — Space Requests Table Setup
-- Run this once in your Supabase SQL Editor
-- Created: Feb 27 2026
-- ============================================================

-- 1. CREATE TABLE
CREATE TABLE space_requests (
    id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid,
    user_name text NOT NULL,
    user_email text NOT NULL,
    use_types text[] NOT NULL,                  -- e.g. {'Photography','Filming'}
    title text NOT NULL,
    date date NOT NULL,
    start_time text NOT NULL,
    end_time text NOT NULL,
    headcount integer NOT NULL,
    equipment text,
    description text NOT NULL,
    special_needs text,
    contact text NOT NULL,
    contribution integer NOT NULL DEFAULT 25,   -- $ amount from slider
    status text NOT NULL DEFAULT 'pending',     -- 'pending' | 'approved' | 'declined'
    created_at timestamptz DEFAULT now()
);

-- 2. INDEXES
CREATE INDEX idx_space_requests_user_id ON space_requests(user_id);
CREATE INDEX idx_space_requests_date ON space_requests(date);
CREATE INDEX idx_space_requests_status ON space_requests(status);

-- 3. ROW LEVEL SECURITY
ALTER TABLE space_requests ENABLE ROW LEVEL SECURITY;

-- Logged-in users can submit requests
CREATE POLICY "Users can insert own requests"
    ON space_requests FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = user_id);

-- Users can view their own requests
CREATE POLICY "Users can view own requests"
    ON space_requests FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- Admins can view all requests
CREATE POLICY "Admins can view all requests"
    ON space_requests FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_status = 'admin'
        )
    );

-- Admins can update request status
CREATE POLICY "Admins can update request status"
    ON space_requests FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.user_status = 'admin'
        )
    );

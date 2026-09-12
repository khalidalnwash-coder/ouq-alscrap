-- سوق السكراب — Phase 1 MVP schema
-- Scope: single country (SA), single listing category (spare_part).
-- Enums are kept general (per the full spec) so Phase 2 can widen scope
-- without a schema rewrite; the API layer is what restricts Phase 1.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('trader','individual')),
  phone_country_code TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  age INTEGER,
  country TEXT NOT NULL DEFAULT 'SA' CHECK (country IN ('SA','AE','KW','QA','BH','OM')),

  otp_verified_channel TEXT CHECK (otp_verified_channel IN ('whatsapp','email')),
  otp_code TEXT,
  otp_channel TEXT CHECK (otp_channel IN ('whatsapp','email')),
  otp_expires_at TIMESTAMPTZ,

  verified_at TIMESTAMPTZ,
  pledge_accepted_at TIMESTAMPTZ,
  terms_accepted_at TIMESTAMPTZ,
  notifications_enabled BOOLEAN NOT NULL DEFAULT false,

  is_verified_trader BOOLEAN NOT NULL DEFAULT false,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  rating_avg NUMERIC(2,1) NOT NULL DEFAULT 0,
  completed_deals_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'spare_part' CHECK (category IN ('full_car','truck','heavy_equipment','spare_part','motorcycle')),
  title TEXT NOT NULL,
  description TEXT,
  country TEXT NOT NULL DEFAULT 'SA' CHECK (country IN ('SA','AE','KW','QA','BH','OM')),
  city TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency IN ('SAR','AED','KWD','QAR','BHD','OMR')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','sold','removed')),

  -- spare_part fields (also reused by category='motorcycle', listing_type='part')
  part_category TEXT,
  compatible_make TEXT,
  compatible_model TEXT,
  compatible_year_from INTEGER,
  compatible_year_to INTEGER,

  -- whole-vehicle fields (category='motorcycle', listing_type='whole' — reuses
  -- compatible_make/compatible_model/compatible_year_from as the vehicle's own
  -- make/model/year rather than a "compatible with" reference)
  listing_type TEXT NOT NULL DEFAULT 'part' CHECK (listing_type IN ('part','whole')),
  damage_severity TEXT CHECK (damage_severity IN ('light','medium','severe')),

  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent upgrade path for a listings table created before the motorcycle
-- category was added (ALTER ... ADD COLUMN IF NOT EXISTS is safe to re-run).
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_category_check;
ALTER TABLE listings ADD CONSTRAINT listings_category_check
  CHECK (category IN ('full_car','truck','heavy_equipment','spare_part','motorcycle'));
ALTER TABLE listings ADD COLUMN IF NOT EXISTS listing_type TEXT NOT NULL DEFAULT 'part'
  CHECK (listing_type IN ('part','whole'));
ALTER TABLE listings ADD COLUMN IF NOT EXISTS damage_severity TEXT
  CHECK (damage_severity IN ('light','medium','severe'));

CREATE INDEX IF NOT EXISTS idx_listings_status_updated ON listings (status, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_part_category ON listings (part_category);
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings (seller_id);
CREATE INDEX IF NOT EXISTS idx_listings_category_type_make ON listings (category, listing_type, compatible_make);

CREATE TABLE IF NOT EXISTS listing_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('image','video')),
  original_url TEXT NOT NULL,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  order_index INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_listing_media_listing ON listing_media (listing_id, order_index);

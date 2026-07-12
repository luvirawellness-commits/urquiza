-- tenant_type already exists in production (added out-of-band, never checked
-- in). This migration documents it so local/CI schemas match prod, and
-- backfills existing rows so the wellness-app tenant filter has a value to
-- match against.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS tenant_type TEXT NOT NULL DEFAULT 'wellness';

-- Track which environment (TEST/PROD) the cached WSAA token was generated for.
-- Also add wsaa columns if they were created only via dashboard and don't exist yet.
ALTER TABLE tenant_arca_config
  ADD COLUMN IF NOT EXISTS wsaa_token      TEXT,
  ADD COLUMN IF NOT EXISTS wsaa_sign       TEXT,
  ADD COLUMN IF NOT EXISTS wsaa_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS wsaa_token_env  TEXT; -- 'TEST' or 'PROD'

-- ─── MercadoPago OAuth Connect config per tenant ────────────────────────────
-- Stage B.1: connection infrastructure only. access_token/refresh_token are
-- populated by mp-oauth-callback once a tenant's owner completes the OAuth
-- flow; oauth_state/code_verifier/oauth_state_expires_at hold PKCE/CSRF state
-- only during the authorize→callback round trip and are cleared right after.
CREATE TABLE IF NOT EXISTS tenant_mp_config (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  access_token           TEXT,
  refresh_token          TEXT,
  token_expires_at       TIMESTAMPTZ,
  mp_user_id             TEXT,
  public_key             TEXT,
  oauth_state            TEXT,
  code_verifier          TEXT,
  oauth_state_expires_at TIMESTAMPTZ,
  is_test_mode           BOOLEAN     DEFAULT true,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

ALTER TABLE tenant_mp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_mp_config_policy ON tenant_mp_config
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

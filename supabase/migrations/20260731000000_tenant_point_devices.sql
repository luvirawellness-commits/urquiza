-- ─── MercadoPago Point device registry per tenant ──────────────────────────
-- Stage C.1: registration infrastructure only — no order creation (C.2) or
-- webhook handling (C.3) here. A tenant can register 0..N physical Point
-- terminals (e.g. a single studio has one, a multi-till Gastro location may
-- have several), each identified by MP's own composite terminal id
-- (BRAND_MODEL__SERIAL, e.g. "NEWLAND_N950__N950NCB801293324") — distinct
-- from tenant_mp_config, which holds the one OAuth-connected access_token a
-- tenant's devices all share.
CREATE TABLE IF NOT EXISTS tenant_point_devices (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id    TEXT        NOT NULL,
  label          TEXT,
  store_id       TEXT,
  pos_id         INTEGER,
  operating_mode TEXT,
  is_active      BOOLEAN     DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tenant_id, terminal_id)
);

ALTER TABLE tenant_point_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_point_devices_policy ON tenant_point_devices
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

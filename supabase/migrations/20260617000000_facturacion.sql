-- ─── ARCA config per tenant ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_arca_config (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cuit            TEXT        NOT NULL,
  razon_social    TEXT        NOT NULL,
  punto_venta     INTEGER     NOT NULL DEFAULT 1,
  certificate     TEXT,
  private_key     TEXT,
  is_test_mode    BOOLEAN     DEFAULT true,
  iva_condition   TEXT        DEFAULT 'monotributo',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id)
);

ALTER TABLE tenant_arca_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY arca_config_policy ON tenant_arca_config
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

-- ─── Electronic invoices ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id),
  appointment_id      UUID        REFERENCES appointments(id),
  transaction_id      UUID        REFERENCES transactions(id),
  client_id           UUID        REFERENCES clients(id),

  invoice_type        TEXT        NOT NULL,
  invoice_number      INTEGER,
  punto_venta         INTEGER,
  cae                 TEXT,
  cae_expires_at      DATE,

  subtotal            NUMERIC(12,2) NOT NULL,
  iva_amount          NUMERIC(12,2) DEFAULT 0,
  total               NUMERIC(12,2) NOT NULL,

  client_name         TEXT        NOT NULL,
  client_cuit         TEXT,
  client_iva_condition TEXT       DEFAULT 'consumidor_final',
  client_address      TEXT,

  status              TEXT        DEFAULT 'pending',
  arca_response       JSONB,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoices_policy ON invoices
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

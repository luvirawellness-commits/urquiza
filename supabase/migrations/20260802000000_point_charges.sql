-- Stage C.2 follow-up — CRITICAL fix for a duplicate-charge risk found after
-- shipping: an in-flight Point order previously existed only in the
-- frontend's local component state (a useRef inside PointChargeControl).
-- If the CerrarSesionStep modal closed for ANY reason while a charge was
-- in flight (X button, backdrop click, Escape, or the appointment simply
-- being reopened as a different React tree), polling died with it and the
-- order became completely untracked — nothing prevented starting a second,
-- independent Point charge for the same session, and if BOTH later
-- succeeded on MP's side the customer would be charged twice.
--
-- point_charges is the durable fix: every order gets a row before its
-- order_id is ever handed back to the frontend, so "does this appointment
-- already have a charge in flight" is a server-side question, not something
-- that lives and dies with a browser tab.
CREATE TABLE IF NOT EXISTS point_charges (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  appointment_id  UUID        REFERENCES appointments(id) ON DELETE CASCADE,
  terminal_id     TEXT        NOT NULL,
  mp_order_id     TEXT        NOT NULL,
  amount          NUMERIC     NOT NULL,
  payment_method  TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'created',
  transaction_id  UUID        REFERENCES transactions(id),
  created_by      UUID,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mp_order_id)
);

ALTER TABLE point_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY point_charges_policy ON point_charges
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

-- status is one of: 'created' (not yet resolved — covers MP's own
-- transient "created"/"at_terminal" states alike, see mp-point-check-order),
-- 'processed', 'failed', 'canceled', 'expired'. The partial unique index
-- below is the actual duplicate-charge guard: only one row per appointment
-- may sit in the unresolved 'created' bucket at a time. A second
-- mp-point-create-order call for the same appointment while one is still
-- unresolved fails this constraint and is rejected — see Part 2's defense
-- there (the frontend's own check-before-create in Part 4 is meant to make
-- this path rare, not the only thing preventing it).
CREATE UNIQUE INDEX IF NOT EXISTS point_charges_one_active_per_appointment
  ON point_charges (appointment_id)
  WHERE status = 'created' AND appointment_id IS NOT NULL;

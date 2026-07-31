-- Automatic commission + IVA + IIBB expense generation, triggered by a
-- nightly cron catch-up scan (settlement-expenses-cron edge function) once
-- a card/qr transaction's settlement date has passed.
--
-- transactions.amount stays gross everywhere (Movimientos de Caja,
-- invoicing, wallet balances / computeBolsillos) — this migration never
-- touches an existing row's amount. It only adds two NEW expense
-- transaction rows per settled card/qr sale, dated at the settlement date,
-- linked back to the original via source_transaction_id.
--
-- settlement_expenses_generated_at is the idempotency guard: NULL means
-- "not yet processed", set once (and only once) the pair of expense rows
-- has been inserted for that sale. Combined with FOR UPDATE row locking in
-- generate_settlement_expenses(), a concurrent or re-run cron invocation
-- can never double-generate — same discipline as close_appointments_combined
-- (20260804000000).

ALTER TABLE tenant_payment_settings
  ADD COLUMN IF NOT EXISTS debit_commission_pct  NUMERIC NOT NULL DEFAULT 0 CHECK (debit_commission_pct  >= 0 AND debit_commission_pct  <= 100),
  ADD COLUMN IF NOT EXISTS credit_commission_pct NUMERIC NOT NULL DEFAULT 0 CHECK (credit_commission_pct >= 0 AND credit_commission_pct <= 100),
  ADD COLUMN IF NOT EXISTS qr_commission_pct     NUMERIC NOT NULL DEFAULT 0 CHECK (qr_commission_pct     >= 0 AND qr_commission_pct     <= 100),
  ADD COLUMN IF NOT EXISTS iibb_pct               NUMERIC NOT NULL DEFAULT 0 CHECK (iibb_pct               >= 0 AND iibb_pct               <= 100);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS settlement_expenses_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL;

-- Speeds up the cron's scan for unprocessed settleable sales.
CREATE INDEX IF NOT EXISTS idx_txn_settlement_pending ON transactions (tenant_id, payment_method)
  WHERE type = 'income' AND payment_method IN ('debit', 'credit', 'qr', 'mp') AND settlement_expenses_generated_at IS NULL;

-- Mirrors the existing idx_txn_appointment partial-index convention.
CREATE INDEX IF NOT EXISTS idx_txn_source_transaction ON transactions (source_transaction_id)
  WHERE source_transaction_id IS NOT NULL;

-- Backfill seed: every settled card/qr sale that already exists as of this
-- migration is marked "already handled" rather than left NULL. Without
-- this, the first cron run would treat the entire historical backlog as
-- newly-settleable and retroactively inject months of backdated commission/
-- IIBB expense rows in one batch, silently rewriting past P&L the moment
-- this feature ships. Only sales that settle AFTER this migration runs are
-- ever swept by generate_settlement_expenses().
UPDATE transactions
SET settlement_expenses_generated_at = now()
WHERE type = 'income'
  AND payment_method IN ('debit', 'credit', 'qr', 'mp')
  AND settlement_expenses_generated_at IS NULL;

-- New auto-generated expense categories (bank_commission_auto, iibb_auto)
-- plus the new manual "Impuesto" category shared by Proveedores and Gastos
-- del día (EXPENSE_CATEGORIES_CAJA) — value 'tax' to match this array's
-- existing English-token convention (bank_fees, marketing, management, ...).
ALTER TABLE transactions
DROP CONSTRAINT txn_expense_category_valid;

ALTER TABLE transactions
ADD CONSTRAINT txn_expense_category_valid CHECK (
  (type <> 'expense') OR (category = ANY (ARRAY[
    'supplies', 'rent', 'utilities', 'salary_operativo',
    'salary_admin', 'salary', 'social_charges', 'marketing',
    'management', 'bank_fees', 'maintenance', 'depreciation',
    'withdrawal', 'royalty', 'cash_transfer', 'other',
    'aguinaldo', 'vacaciones', 'internal_transfer',
    'salary_advance_operativo', 'salary_advance_admin',
    'bank_commission_auto', 'iibb_auto', 'tax'
  ]))
);

-- ── Settlement-date helpers (ported from src/utils/settlementUtils.ts) ─────
-- Pure date math, no data access — kept separate from the RPC below so the
-- weekend/holiday-skipping logic isn't duplicated inline in the scan loop.

CREATE OR REPLACE FUNCTION add_business_days(p_start DATE, p_days INTEGER, p_holidays DATE[])
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result DATE := p_start;
  v_added  INTEGER := 0;
BEGIN
  WHILE v_added < p_days LOOP
    v_result := v_result + 1;
    -- EXTRACT(DOW ...): 0 = Sunday, 6 = Saturday — same convention as the
    -- frontend's isWeekend() (Date.getDay()).
    IF EXTRACT(DOW FROM v_result) NOT IN (0, 6) AND NOT (v_result = ANY(p_holidays)) THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION compute_settlement_date(
  p_tx_date DATE,
  p_payment_method TEXT,
  p_settings tenant_payment_settings,
  p_holidays DATE[]
)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_method TEXT;
  v_days   INTEGER;
  v_type   TEXT;
BEGIN
  -- Same-day methods (cash/transfer/safe never reach this function via the
  -- RPC's own payment_method filter, but kept here so this helper matches
  -- getSettlementDate's behavior exactly if ever called more broadly).
  IF p_payment_method IN ('cash', 'transfer', 'safe') THEN
    RETURN p_tx_date;
  END IF;

  -- 'mp' settles under the same config as 'qr' — mirrors resolveMethod() in
  -- settlementUtils.ts, which maps both to the 'qr' settlement key.
  v_method := CASE p_payment_method
    WHEN 'debit'  THEN 'debit'
    WHEN 'credit' THEN 'credit'
    WHEN 'qr'     THEN 'qr'
    WHEN 'mp'     THEN 'qr'
    ELSE NULL
  END;

  IF v_method IS NULL THEN
    RETURN p_tx_date;
  END IF;

  v_days := CASE v_method
    WHEN 'debit'  THEN p_settings.debit_settlement_days
    WHEN 'credit' THEN p_settings.credit_settlement_days
    WHEN 'qr'     THEN p_settings.qr_settlement_days
  END;
  v_type := CASE v_method
    WHEN 'debit'  THEN p_settings.debit_settlement_type
    WHEN 'credit' THEN p_settings.credit_settlement_type
    WHEN 'qr'     THEN p_settings.qr_settlement_type
  END;

  IF v_days = 0 THEN
    RETURN p_tx_date;
  END IF;

  IF v_type = 'habiles' THEN
    RETURN add_business_days(p_tx_date, v_days, p_holidays);
  ELSE
    RETURN p_tx_date + v_days;
  END IF;
END;
$$;

-- ── The catch-up scan ───────────────────────────────────────────────────────
-- Called exclusively by settlement-expenses-cron (service_role only — see
-- GRANT below). Not tenant-scoped by design: it sweeps every tenant in one
-- pass, since it's meant to run as a single nightly job, not per-request.
CREATE OR REPLACE FUNCTION generate_settlement_expenses()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tx               RECORD;
  v_settings         tenant_payment_settings;
  v_holidays         DATE[];
  v_settlement_date  DATE;
  v_commission_pct   NUMERIC;
  v_commission       NUMERIC;
  v_iva              NUMERIC;
  v_iibb             NUMERIC;
  v_short_id         TEXT;
  v_processed        INTEGER := 0;
  v_skipped_no_settings INTEGER := 0;
BEGIN
  FOR v_tx IN
    SELECT *
    FROM transactions
    WHERE type = 'income'
      AND payment_method IN ('debit', 'credit', 'qr', 'mp')
      AND settlement_expenses_generated_at IS NULL
    ORDER BY id
    FOR UPDATE
  LOOP
    SELECT * INTO v_settings FROM tenant_payment_settings WHERE tenant_id = v_tx.tenant_id;
    IF v_settings IS NULL THEN
      -- No config yet for this tenant — leave settlement_expenses_generated_at
      -- NULL so it's picked up automatically once the tenant configures
      -- Tesorería, instead of being silently skipped forever.
      v_skipped_no_settings := v_skipped_no_settings + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(array_agg(date), '{}') INTO v_holidays FROM holidays WHERE tenant_id = v_tx.tenant_id;

    v_settlement_date := compute_settlement_date(v_tx.date, v_tx.payment_method, v_settings, v_holidays);
    IF v_settlement_date > CURRENT_DATE THEN
      CONTINUE; -- not settled yet — revisited by tomorrow's run
    END IF;

    v_commission_pct := CASE v_tx.payment_method
      WHEN 'debit'  THEN v_settings.debit_commission_pct
      WHEN 'credit' THEN v_settings.credit_commission_pct
      ELSE v_settings.qr_commission_pct -- covers 'qr' and 'mp'
    END;
    v_commission := round(v_tx.amount * v_commission_pct / 100, 2);
    v_iva        := round(v_commission * 0.21, 2);
    v_iibb       := round(v_tx.amount * v_settings.iibb_pct / 100, 2);
    v_short_id   := left(v_tx.id::text, 8);

    -- transactions.amount has a CHECK (amount > 0) — tenants with unconfigured
    -- (0%) rates must not attempt a zero-amount insert, which would abort
    -- this whole loop. The marker is still set below so a zero-rate sale is
    -- never rescanned once its settlement date has passed.
    IF v_commission + v_iva > 0 THEN
      INSERT INTO transactions (
        tenant_id, type, category, amount, date, description,
        payment_method, user_id, status, source_transaction_id
      ) VALUES (
        v_tx.tenant_id, 'expense', 'bank_commission_auto', v_commission + v_iva, v_settlement_date,
        'Comisión + IVA - Venta #' || v_short_id,
        v_tx.payment_method, v_tx.user_id, 'paid', v_tx.id
      );
    END IF;

    IF v_iibb > 0 THEN
      INSERT INTO transactions (
        tenant_id, type, category, amount, date, description,
        payment_method, user_id, status, source_transaction_id
      ) VALUES (
        v_tx.tenant_id, 'expense', 'iibb_auto', v_iibb, v_settlement_date,
        'IIBB - Venta #' || v_short_id,
        v_tx.payment_method, v_tx.user_id, 'paid', v_tx.id
      );
    END IF;

    UPDATE transactions SET settlement_expenses_generated_at = now() WHERE id = v_tx.id;
    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object('processed', v_processed, 'skipped_no_settings', v_skipped_no_settings);
END;
$$;

-- Cross-tenant, unscoped by auth_tenant_id() — must never be callable by a
-- regular authenticated user, only by the cron edge function via the
-- service_role key (see settlement-expenses-cron).
REVOKE ALL ON FUNCTION generate_settlement_expenses() FROM PUBLIC;
REVOKE ALL ON FUNCTION generate_settlement_expenses() FROM authenticated;
GRANT EXECUTE ON FUNCTION generate_settlement_expenses() TO service_role;

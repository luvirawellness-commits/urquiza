-- Combined multi-appointment checkout: lets staff select 2+ appointments
-- from the SAME day (any client combination — one client's back-to-back
-- sessions, or two different clients like a couple) and close/pay them
-- together as ONE transaction group, instead of closing each separately.
--
-- close_appointment_with_payment (singular) is left completely untouched —
-- this is a new, parallel RPC, not a modification. Looping the singular RPC
-- was considered and rejected: it would insert N separate transaction rows
-- (one set per appointment), which defeats "one combined charge for the
-- total" — the whole point of this feature. Scoped to cash/card
-- (efectivo_digital) only: membership consumption and gift-card redemption
-- are inherently single-client/single-service (a membership only covers its
-- owner's sessions; gift card validation is scoped to one service+duration),
-- so neither generalizes to a combined group — no p_client_membership_id or
-- p_gift_card_id params here, unlike the singular RPC.

-- transaction_appointments links one combined transaction to all N
-- appointments it covers. transactions.appointment_id (the existing scalar
-- FK) is still set — to the FIRST selected appointment — so every existing
-- report/join that expects exactly one appointment per transaction keeps
-- working unchanged; this table is the additive, full-fidelity link for
-- anything that needs the whole group later.
--
-- tenant_id is denormalized onto this table (not just reachable via a join
-- to transactions) to match this codebase's established RLS pattern
-- (tenant_id column + auth_tenant_id(), as used by point_charges,
-- tenant_arca_config, membership_beneficiaries, etc.) rather than a slower,
-- less consistent EXISTS-subquery policy.
CREATE TABLE IF NOT EXISTS transaction_appointments (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (transaction_id, appointment_id)
);

ALTER TABLE transaction_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY transaction_appointments_policy ON transaction_appointments
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

CREATE FUNCTION close_appointments_combined(
  p_appointment_ids       uuid[],
  p_tenant_id             uuid,
  p_date                  date,
  p_description           text,
  p_user_id               uuid,
  p_amounts               numeric[]  DEFAULT '{}',
  p_payment_methods       text[]     DEFAULT '{}',
  p_collected_via_point   boolean[]  DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count             integer;
  v_matched_count     integer;
  v_distinct_days     integer;
  v_open_count        integer;
  v_client_ids        uuid[];
  v_shared_client_id  uuid;
  v_transaction_ids   uuid[] := '{}';
  v_tx_id             uuid;
  v_appt_id           uuid;
  i                   integer;
BEGIN
  IF p_appointment_ids IS NULL OR array_length(p_appointment_ids, 1) IS NULL
     OR array_length(p_appointment_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Se requieren al menos 2 turnos para un cobro combinado';
  END IF;
  v_count := array_length(p_appointment_ids, 1);

  -- Lock all N rows up front, before any validation reads them, so a
  -- concurrent close of one of these appointments can't race past the
  -- checks below.
  PERFORM 1
  FROM appointments
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id
  ORDER BY id
  FOR UPDATE;

  -- Every id must exist, belong to this tenant, and appear only once —
  -- a mismatch here also catches duplicate ids in p_appointment_ids, since
  -- id = ANY(...) can only ever match one row per distinct id regardless of
  -- how many times it's repeated in the array.
  SELECT count(*) INTO v_matched_count
  FROM appointments
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id;

  IF v_matched_count <> v_count THEN
    RAISE EXCEPTION 'Uno o más turnos no existen, no pertenecen a este local, o están repetidos';
  END IF;

  -- All must share the same Argentina-local calendar day — same convention
  -- the frontend already groups DayView by (getArgentinaDateString /
  -- dateKey), so this should never actually fire from the real UI; it's the
  -- server-side backstop, not the primary defense.
  SELECT count(DISTINCT (scheduled_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
  INTO v_distinct_days
  FROM appointments
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id;

  IF v_distinct_days <> 1 THEN
    RAISE EXCEPTION 'Los turnos seleccionados deben ser del mismo día';
  END IF;

  -- None may already be closed out.
  SELECT count(*) INTO v_open_count
  FROM appointments
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id
    AND status NOT IN ('completed', 'cancelled');

  IF v_open_count <> v_count THEN
    RAISE EXCEPTION 'Uno o más turnos ya están cerrados o cancelados';
  END IF;

  -- Attribute the transaction to a shared client only when every selected
  -- appointment belongs to the same client — NULL (Consumidor Final)
  -- otherwise, same fallback used everywhere else in the app when there's
  -- no single unambiguous client.
  SELECT array_agg(DISTINCT client_id) INTO v_client_ids
  FROM appointments
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id;

  IF array_length(v_client_ids, 1) = 1 THEN
    v_shared_client_id := v_client_ids[1];
  ELSE
    v_shared_client_id := NULL;
  END IF;

  -- Insert one transaction row per split-payment entry, exactly like
  -- close_appointment_with_payment does. appointment_id is set to the
  -- FIRST selected appointment (backward-compat scalar FK — see header);
  -- transaction_appointments below carries the full group.
  IF array_length(p_amounts, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(p_amounts, 1) LOOP
      IF p_amounts[i] > 0 THEN
        INSERT INTO transactions (
          tenant_id, type, category, amount, date,
          description, payment_method, appointment_id,
          user_id, status, is_recurring, client_id, collected_via_point
        ) VALUES (
          p_tenant_id, 'income', 'session', p_amounts[i], p_date,
          p_description, p_payment_methods[i], p_appointment_ids[1],
          p_user_id, 'paid', false, v_shared_client_id,
          COALESCE(p_collected_via_point[i], false)
        )
        RETURNING id INTO v_tx_id;
        v_transaction_ids := array_append(v_transaction_ids, v_tx_id);

        FOREACH v_appt_id IN ARRAY p_appointment_ids LOOP
          INSERT INTO transaction_appointments (tenant_id, transaction_id, appointment_id)
          VALUES (p_tenant_id, v_tx_id, v_appt_id);
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  -- Anchor write: only reached if all prior steps in this transaction
  -- succeeded.
  UPDATE appointments
  SET status = 'completed'
  WHERE id = ANY(p_appointment_ids) AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'appointment_ids', p_appointment_ids,
    'transaction_ids', v_transaction_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION close_appointments_combined(
  uuid[], uuid, date, text, uuid, numeric[], text[], boolean[]
) TO authenticated;

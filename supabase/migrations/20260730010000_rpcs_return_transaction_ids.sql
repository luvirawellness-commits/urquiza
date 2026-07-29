-- Fixes a silent-failure bug in auto-invoicing: the frontend used to find the
-- transaction(s) a sale RPC had just created by querying
-- "created_at >= beforeIso", where beforeIso was captured on the CLIENT's own
-- clock before calling the RPC. Any clock skew between the device and the DB
-- server (client ahead of server) could make that filter match zero rows even
-- though the transaction was genuinely created — auto-invoicing then silently
-- never triggered, with no error shown anywhere.
--
-- Fix: each of these RPCs now returns the id(s) of the transaction row(s) it
-- creates directly in its response (RETURNING ... INTO, merged into the
-- existing return value via jsonb). The frontend fetches those rows by exact
-- id afterward — no time-based guessing, so no race condition is possible.
--
-- Return type changes require DROP + CREATE (CREATE OR REPLACE cannot change
-- a function's return type). Verified via pg_depend that nothing else in the
-- database depends on these three functions before dropping them.

-- ─── close_appointment_with_payment ────────────────────────────────────────
-- Can insert multiple transaction rows (one per split-payment entry), so it
-- returns transaction_ids (an array) merged into the appointment row.

DROP FUNCTION IF EXISTS close_appointment_with_payment(
  uuid, uuid, date, text, uuid, numeric[], text[], uuid, uuid
);

CREATE FUNCTION close_appointment_with_payment(
  p_appointment_id        uuid,
  p_tenant_id             uuid,
  p_date                  date,
  p_description           text,
  p_user_id               uuid,
  p_amounts               numeric[]  DEFAULT '{}',
  p_payment_methods       text[]     DEFAULT '{}',
  p_client_membership_id  uuid       DEFAULT NULL,
  p_gift_card_id          uuid       DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result            appointments;
  v_client_id       uuid;
  v_transaction_ids uuid[] := '{}';
  v_tx_id           uuid;
  i                 integer;
BEGIN
  -- Lock appointment row + grab client_id; prevents concurrent double-close
  SELECT client_id INTO v_client_id
  FROM appointments
  WHERE id = p_appointment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turno no encontrado';
  END IF;

  -- efectivo_digital: insert one transaction row per split-payment entry
  IF array_length(p_amounts, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(p_amounts, 1) LOOP
      IF p_amounts[i] > 0 THEN
        INSERT INTO transactions (
          tenant_id, type, category, amount, date,
          description, payment_method, appointment_id,
          user_id, status, is_recurring, client_id
        ) VALUES (
          p_tenant_id, 'income', 'session', p_amounts[i], p_date,
          p_description, p_payment_methods[i], p_appointment_id,
          p_user_id, 'paid', false, v_client_id
        )
        RETURNING id INTO v_tx_id;
        v_transaction_ids := array_append(v_transaction_ids, v_tx_id);
      END IF;
    END LOOP;
  END IF;

  -- gift_card: atomic status flip + full metadata (WHERE status='active' prevents double-redemption)
  IF p_gift_card_id IS NOT NULL THEN
    UPDATE gift_cards
    SET status                 = 'used',
        used_at                = now(),
        updated_at             = now(),
        used_by_client_id      = v_client_id,
        used_in_appointment_id = p_appointment_id
    WHERE id        = p_gift_card_id
      AND tenant_id = p_tenant_id
      AND status    = 'active';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gift card ya utilizada o no está activa';
    END IF;
  END IF;

  -- Anchor write: only reached if all prior steps in this transaction succeeded
  UPDATE appointments
  SET status               = 'completed',
      client_membership_id = p_client_membership_id
  WHERE id        = p_appointment_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'No se pudo actualizar el turno';
  END IF;

  RETURN to_jsonb(result) || jsonb_build_object('transaction_ids', v_transaction_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION close_appointment_with_payment(
  uuid, uuid, date, text, uuid, numeric[], text[], uuid, uuid
) TO authenticated;

-- ─── sell_membership ────────────────────────────────────────────────────────
-- Inserts at most one transaction row (only when amount_paid > 0), so it
-- returns a single nullable transaction_id merged into the membership row.

DROP FUNCTION IF EXISTS sell_membership(
  uuid, uuid, uuid, text, numeric, text, uuid, date, date, uuid[], uuid
);

CREATE FUNCTION sell_membership(
  p_tenant_id uuid, p_client_id uuid, p_membership_id uuid, p_plan_name text,
  p_amount_paid numeric, p_payment_method text, p_sold_by uuid, p_date date,
  p_expires_at date, p_beneficiary_ids uuid[], p_appointment_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result         client_memberships;
  v_sessions_qty integer;
  v_ben_id       uuid;
  v_tx_id        uuid;
BEGIN
  SELECT sessions_qty INTO v_sessions_qty
  FROM memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;
  IF v_sessions_qty IS NULL THEN
    RAISE EXCEPTION 'Plan de membresía no encontrado';
  END IF;
  INSERT INTO client_memberships (
    tenant_id, client_id, membership_id,
    sessions_used, sessions_total, status,
    purchased_at, expires_at,
    payment_method, amount_paid, sold_by
  ) VALUES (
    p_tenant_id, p_client_id, p_membership_id,
    0, v_sessions_qty, 'active',
    now(), p_expires_at,
    p_payment_method, p_amount_paid, p_sold_by
  )
  RETURNING * INTO result;
  FOREACH v_ben_id IN ARRAY p_beneficiary_ids LOOP
    INSERT INTO membership_beneficiaries (
      tenant_id, client_membership_id, client_id, added_by
    ) VALUES (
      p_tenant_id, result.id, v_ben_id, p_sold_by
    );
  END LOOP;
  IF p_amount_paid > 0 THEN
    INSERT INTO transactions (
      tenant_id, type, category, amount, payment_method,
      description, date, user_id, status, is_recurring, client_id
    ) VALUES (
      p_tenant_id, 'income', 'membership', p_amount_paid, p_payment_method,
      'Membresía ' || p_plan_name, p_date, p_sold_by, 'paid', false, p_client_id
    )
    RETURNING id INTO v_tx_id;
  END IF;
  IF p_appointment_id IS NOT NULL THEN
    UPDATE appointments
    SET client_membership_id = result.id
    WHERE id        = p_appointment_id
      AND tenant_id = p_tenant_id;
  END IF;
  RETURN to_jsonb(result) || jsonb_build_object('transaction_id', v_tx_id);
END;
$$;

GRANT EXECUTE ON FUNCTION sell_membership(
  uuid, uuid, uuid, text, numeric, text, uuid, date, date, uuid[], uuid
) TO authenticated;

-- ─── create_gift_card ───────────────────────────────────────────────────────
-- Always inserts exactly one transaction row; returns its id merged into the
-- gift card row. Body otherwise unchanged (still has no client_id concept).

DROP FUNCTION IF EXISTS create_gift_card(
  uuid, uuid, integer, numeric, text, uuid, uuid, date, date, text, text, text, text
);

CREATE FUNCTION create_gift_card(
  p_tenant_id uuid, p_service_id uuid, p_duration_minutes integer, p_amount numeric,
  p_payment_method text, p_sold_by uuid, p_user_id uuid, p_date date,
  p_expires_at date DEFAULT NULL::date, p_notes text DEFAULT NULL::text,
  p_recipient_name text DEFAULT NULL::text, p_sender_name text DEFAULT NULL::text,
  p_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result    gift_cards;
  v_code    text;
  v_attempt integer := 0;
  v_tx_id   uuid;
  chars     constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
BEGIN
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 5 THEN
      RAISE EXCEPTION 'No se pudo generar un código único. Intentá de nuevo.';
    END IF;
    v_code := 'LUV-' ||
      (SELECT string_agg(substr(chars, (floor(random() * 36))::int + 1, 1), '')
       FROM generate_series(1, 4)) ||
      '-' ||
      (SELECT string_agg(substr(chars, (floor(random() * 36))::int + 1, 1), '')
       FROM generate_series(1, 4));

    PERFORM 1 FROM gift_cards WHERE code = v_code;
    CONTINUE WHEN FOUND;

    INSERT INTO gift_cards (
      tenant_id, code, service_id, duration_minutes, amount,
      status, sold_by, expires_at, notes,
      recipient_name, sender_name, message
    ) VALUES (
      p_tenant_id, v_code, p_service_id, p_duration_minutes, p_amount,
      'active', p_sold_by, p_expires_at, p_notes,
      p_recipient_name, p_sender_name, p_message
    )
    RETURNING * INTO result;
    EXIT;
  END LOOP;

  INSERT INTO transactions (
    tenant_id, type, category, amount, payment_method,
    description, date, user_id, status, is_recurring
  ) VALUES (
    p_tenant_id, 'income', 'gift_card', p_amount, p_payment_method,
    'Gift Card #' || v_code, p_date, p_user_id, 'paid', false
  )
  RETURNING id INTO v_tx_id;

  RETURN to_jsonb(result) || jsonb_build_object('transaction_id', v_tx_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_gift_card(
  uuid, uuid, integer, numeric, text, uuid, uuid, date, date, text, text, text, text
) TO authenticated;

-- Stage C.2: Point is NOT a new payment_method — the transaction's stored
-- payment_method must stay the real one the customer paid with (debit,
-- credit, or qr), so reports by payment method stay accurate. This column
-- is the tag that still lets later screens tell which of those were
-- actually collected through the physical Point reader vs. entered manually.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS collected_via_point BOOLEAN NOT NULL DEFAULT false;

-- close_appointment_with_payment gets a new optional parallel array,
-- p_collected_via_point, mirroring p_amounts/p_payment_methods positionally.
-- Verified directly against this database (BEGIN/ROLLBACK dry run) that
-- CREATE OR REPLACE with a new trailing parameter does NOT replace the
-- existing function — Postgres treats a changed parameter-type list as a
-- distinct overload and creates a second, ambiguity-prone version alongside
-- the original 9-arg one. DROP + CREATE avoids that, same as the return-type
-- change in 20260730010000. Every existing caller that omits the new named
-- parameter keeps working unchanged (defaults to '{}', collected_via_point
-- lands false).
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
  p_gift_card_id          uuid       DEFAULT NULL,
  p_collected_via_point   boolean[]  DEFAULT '{}'
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
          user_id, status, is_recurring, client_id, collected_via_point
        ) VALUES (
          p_tenant_id, 'income', 'session', p_amounts[i], p_date,
          p_description, p_payment_methods[i], p_appointment_id,
          p_user_id, 'paid', false, v_client_id,
          COALESCE(p_collected_via_point[i], false)
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
  uuid, uuid, date, text, uuid, numeric[], text[], uuid, uuid, boolean[]
) TO authenticated;

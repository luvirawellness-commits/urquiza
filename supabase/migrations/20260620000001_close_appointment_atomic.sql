-- Atomic appointment close: payment transactions + status update in one PG transaction.
-- Fixes C-04: previously insertTx and updateStatus were separate calls — if updateStatus
-- failed, money was recorded but the appointment stayed pending.
--
-- Split payments (efectivo_digital): pass parallel arrays p_amounts / p_payment_methods.
-- Gift card: pass p_gift_card_id — status flip + full metadata are atomic (no double-redemption).
-- Membership: pass p_client_membership_id — sets FK on appointment, no transaction row.

CREATE OR REPLACE FUNCTION close_appointment_with_payment(
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
RETURNS appointments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result      appointments;
  v_client_id uuid;
  i           integer;
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
          user_id, status, is_recurring
        ) VALUES (
          p_tenant_id, 'income', 'session', p_amounts[i], p_date,
          p_description, p_payment_methods[i], p_appointment_id,
          p_user_id, 'paid', false
        );
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

  RETURN result;
END;
$$;

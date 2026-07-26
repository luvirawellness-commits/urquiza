-- Adds client_id to the transactions rows inserted by close_appointment_with_payment
-- and sell_membership — both already have the client id available internally
-- (v_client_id / p_client_id respectively) but weren't writing it to the
-- transaction row, which auto-invoicing needs to identify who to invoice.
--
-- Both CREATE OR REPLACE FUNCTION calls below use the exact same signature
-- (same param names/types/order/defaults, same return type) as the live
-- functions — this is a body-only change, safe for every existing caller.
-- create_gift_card is intentionally NOT touched: gift cards have no client_id
-- concept by design (recipient_name/sender_name are free text).

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
          user_id, status, is_recurring, client_id
        ) VALUES (
          p_tenant_id, 'income', 'session', p_amounts[i], p_date,
          p_description, p_payment_methods[i], p_appointment_id,
          p_user_id, 'paid', false, v_client_id
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

CREATE OR REPLACE FUNCTION public.sell_membership(p_tenant_id uuid, p_client_id uuid, p_membership_id uuid, p_plan_name text, p_amount_paid numeric, p_payment_method text, p_sold_by uuid, p_date date, p_expires_at date, p_beneficiary_ids uuid[], p_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS client_memberships
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  result         client_memberships;
  v_sessions_qty integer;
  v_ben_id       uuid;
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
    );
  END IF;
  IF p_appointment_id IS NOT NULL THEN
    UPDATE appointments
    SET client_membership_id = result.id
    WHERE id        = p_appointment_id
      AND tenant_id = p_tenant_id;
  END IF;
  RETURN result;
END;
$function$;

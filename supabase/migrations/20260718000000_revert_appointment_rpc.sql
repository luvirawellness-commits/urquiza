-- Reverts a completed appointment back to pending: deletes its income
-- transactions, restores any gift card used, clears price/membership link.
-- Membership sessions_used is intentionally NOT touched here: closing a
-- session today never increments it (increment_membership_session exists
-- but its only caller, useUseMembershipSession, is unused/dead code), so
-- decrementing on revert would push counts negative. Revisit together if
-- that forward-flow gap ever gets fixed.

CREATE OR REPLACE FUNCTION revert_appointment(
  p_appointment_id uuid,
  p_tenant_id      uuid,
  p_user_id        uuid
)
RETURNS appointments
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result appointments;
BEGIN
  -- Only owners may revert a completed session
  IF NOT EXISTS (
    SELECT 1 FROM user_tenants
    WHERE user_id = p_user_id
      AND tenant_id = p_tenant_id
      AND role = 'owner'
      AND active = true
  ) THEN
    RAISE EXCEPTION 'No autorizado para revertir sesiones';
  END IF;

  -- Lock appointment row; only revert if currently completed
  PERFORM 1 FROM appointments
  WHERE id = p_appointment_id
    AND tenant_id = p_tenant_id
    AND status = 'completed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El turno no está completado o no existe';
  END IF;

  -- a. Remove the income transaction(s) recorded when the session was closed
  DELETE FROM transactions
  WHERE appointment_id = p_appointment_id
    AND tenant_id = p_tenant_id
    AND type = 'income';

  -- b. Restore the gift card, if one was redeemed for this appointment
  UPDATE gift_cards
  SET status                 = 'active',
      used_at                = NULL,
      used_by_client_id      = NULL,
      used_in_appointment_id = NULL,
      updated_at             = now()
  WHERE used_in_appointment_id = p_appointment_id
    AND tenant_id              = p_tenant_id;

  -- d. Reset the appointment itself (no final_payment_method/final_amount
  -- columns exist; price_charged + client_membership_id are what close sets)
  UPDATE appointments
  SET status               = 'pending',
      price_charged         = NULL,
      client_membership_id  = NULL
  WHERE id        = p_appointment_id
    AND tenant_id = p_tenant_id
  RETURNING * INTO result;

  RETURN result;
END;
$$;

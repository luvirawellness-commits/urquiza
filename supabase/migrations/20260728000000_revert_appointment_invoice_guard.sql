-- Blocks reverting a session whose transaction already has an ARCA invoice.
-- Previously this hit a raw foreign-key-violation error at the DELETE FROM
-- transactions step below (invoices.transaction_id REFERENCES transactions(id)
-- has no ON DELETE clause) — safe (the whole function rolls back on
-- exception) but confusing, with no path forward for the owner. Automatic
-- credit notes (nota de crédito) are a deliberate non-goal here — this just
-- blocks with a clear message instead, same RAISE EXCEPTION pattern already
-- used by the other guards in this function.
--
-- Same signature as before (same params/types/order/defaults, same return
-- type) — body-only change, safe for the existing call site in Agenda.tsx.

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

  -- Block if any income transaction for this appointment already has an
  -- invoice — deleting it would otherwise fail on the FK below anyway, but
  -- with a raw constraint-violation error instead of an explanation.
  IF EXISTS (
    SELECT 1
    FROM transactions t
    JOIN invoices i ON i.transaction_id = t.id
    WHERE t.appointment_id = p_appointment_id
      AND t.tenant_id      = p_tenant_id
      AND t.type           = 'income'
  ) THEN
    RAISE EXCEPTION 'No se puede revertir esta sesión porque ya tiene una factura electrónica emitida. Contactá a tu contador para gestionar la anulación ante ARCA antes de continuar.';
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

  IF result IS NULL THEN
    RAISE EXCEPTION 'No se pudo actualizar el turno';
  END IF;

  RETURN result;
END;
$$;

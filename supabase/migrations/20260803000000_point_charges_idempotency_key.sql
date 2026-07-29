-- Extends point_charges' duplicate-charge guard (see 20260802000000) beyond
-- appointment-based session closing. Gift card sales and membership sales
-- also need to force Point for debit/credit/qr when a device is active, but
-- neither has an appointment_id to key the dedup guard off of — gift cards
-- have no appointment concept at all, and membership sales' appointment_id
-- is optional (NULL for standalone counter sales, which are the common
-- case). Reusing appointment_id for these would be a no-op protection
-- (a NULL appointment_id row falls outside point_charges_one_active_per_appointment
-- entirely — see that index's WHERE clause), so this adds a parallel,
-- independent dedup key instead of overloading the existing one.
--
-- idempotency_key is generated client-side (crypto.randomUUID()) once per
-- sale attempt, before the Point order is created, and persisted to
-- localStorage so a reload/crash mid-charge can resume against it — the
-- same protection appt.id gives the appointment flow for free, replicated
-- here since gift cards/memberships don't exist as a DB row to resume
-- against until after the charge succeeds.
ALTER TABLE point_charges ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS point_charges_one_active_per_idempotency_key
  ON point_charges (idempotency_key)
  WHERE status = 'created' AND idempotency_key IS NOT NULL;

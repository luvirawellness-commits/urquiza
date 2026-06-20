-- ─── Atomic membership session decrement ─────────────────────────────────────
-- Replaces the race-prone read-then-write in useUseMembershipSession.
-- Guards: session quota not exceeded, membership not expired, status = active.
-- The status flip to 'expired' happens inside the same UPDATE, eliminating the
-- gap that existed between the old separate update calls.

CREATE OR REPLACE FUNCTION increment_membership_session(
  p_membership_id uuid,
  p_tenant_id     uuid
)
RETURNS client_memberships
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result         client_memberships;
  v_sessions_qty integer;
BEGIN
  SELECT m.sessions_qty INTO v_sessions_qty
  FROM client_memberships cm
  JOIN memberships m ON m.id = cm.membership_id
  WHERE cm.id = p_membership_id AND cm.tenant_id = p_tenant_id;

  IF v_sessions_qty IS NULL THEN
    RAISE EXCEPTION 'Membresía no encontrada';
  END IF;

  UPDATE client_memberships
  SET sessions_used = sessions_used + 1,
      status        = CASE
                        WHEN sessions_used + 1 >= v_sessions_qty THEN 'expired'
                        ELSE status
                      END,
      updated_at    = now()
  WHERE id          = p_membership_id
    AND tenant_id   = p_tenant_id
    AND sessions_used < v_sessions_qty
    AND expires_at  >= CURRENT_DATE
    AND status      = 'active'
  RETURNING * INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Membresía sin sesiones disponibles o vencida';
  END IF;

  RETURN result;
END;
$$;

-- ─── Atomic gift card redemption ─────────────────────────────────────────────
-- Replaces the unguarded UPDATE in useRedeemGiftCard.
-- The WHERE status = 'active' guard makes concurrent double-redemption impossible:
-- only one concurrent transaction can match and flip the status.

CREATE OR REPLACE FUNCTION redeem_gift_card(
  p_gift_card_id uuid,
  p_tenant_id    uuid
)
RETURNS gift_cards
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result gift_cards;
BEGIN
  UPDATE gift_cards
  SET status      = 'used',
      redeemed_at = now(),
      updated_at  = now()
  WHERE id        = p_gift_card_id
    AND tenant_id = p_tenant_id
    AND status    = 'active'
  RETURNING * INTO result;

  IF result IS NULL THEN
    RAISE EXCEPTION 'Gift card ya fue utilizada o no está activa';
  END IF;

  RETURN result;
END;
$$;

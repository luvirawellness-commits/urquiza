-- Stage D.2 — the real client_profiles ↔ clients link, replacing the
-- placeholder email-matching client-my-appointments/client-my-tenants used
-- ad hoc in Stage D.1. Standalone/additive, same posture as D.1: does not
-- touch public-booking/index.ts or anything in the real booking flow.

-- Nullable — most existing clients rows (691 today, only ~68% with any
-- email at all) will never link, and that's fine; this column is populated
-- lazily by resolve_or_create_client_link() the first time a client
-- actually interacts with that tenant, not backfilled speculatively.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_profile_id UUID REFERENCES client_profiles(id) ON DELETE SET NULL;

-- A single global identity may link to at most one clients row per tenant —
-- enforced here (not just in resolve_or_create_client_link's own logic) so
-- a bug or a future direct write can never silently create two linked rows
-- for the same person in the same tenant.
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_client_profile_unique
  ON clients (tenant_id, client_profile_id)
  WHERE client_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clients_client_profile ON clients (client_profile_id)
  WHERE client_profile_id IS NOT NULL;

-- Minimal viable record of the 2+-match (ambiguous) case: resolve_or_create_
-- client_link() never guesses which existing row to link, so nothing about
-- the ambiguity would otherwise be discoverable later. This is deliberately
-- just an append-only log, not a merge UI — resolved_at exists so a future
-- manual-merge feature has somewhere to mark a case as handled, but nothing
-- in this stage sets it.
CREATE TABLE client_link_ambiguities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_profile_id   UUID NOT NULL REFERENCES client_profiles(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  matched_client_ids  UUID[] NOT NULL,
  -- The fresh row created instead of guessing — nullable only because the
  -- column exists before that insert completes within resolve_or_create_
  -- client_link(); always set by the time the function returns.
  new_client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);

ALTER TABLE client_link_ambiguities ENABLE ROW LEVEL SECURITY;

-- Same tenant-scoped convention as every other tenant-owned table in this
-- app, even though no UI reads this yet — a tenant's own admins (and
-- super_admin) are the natural eventual audience for reviewing these.
CREATE POLICY client_link_ambiguities_policy ON client_link_ambiguities
  FOR ALL
  USING    (is_super_admin() OR tenant_id = auth_tenant_id())
  WITH CHECK (is_super_admin() OR tenant_id = auth_tenant_id());

-- ── resolve_or_create_client_link ────────────────────────────────────────────
-- Implements the confirmed matching rules exactly:
--   1 match  → link client_profile_id onto that existing row (full history
--              becomes theirs).
--   0 matches (including every row in this tenant having a NULL email, which
--              simply never matches) → create a fresh row.
--   2+ matches → ambiguous; never guess — create a fresh row (same as the
--              0-match case) and log the ambiguity for later manual review.
-- Idempotent: if this client_profile is already linked in this tenant, the
-- existing row is returned immediately with no re-matching — matters
-- because Stage D.4's booking flow is expected to call this on every visit
-- to a tenant, not just the first.
CREATE OR REPLACE FUNCTION resolve_or_create_client_link(
  p_client_profile_id UUID,
  p_tenant_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email       TEXT;
  v_first_name  TEXT;
  v_last_name   TEXT;
  v_phone       TEXT;
  v_existing    UUID;
  v_matched_ids UUID[];
  v_match_count INTEGER;
  v_client_id   UUID;
BEGIN
  SELECT id INTO v_existing
  FROM clients
  WHERE tenant_id = p_tenant_id AND client_profile_id = p_client_profile_id
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT email, first_name, last_name, phone
  INTO v_email, v_first_name, v_last_name, v_phone
  FROM client_profiles
  WHERE id = p_client_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_profiles no encontrado: %', p_client_profile_id;
  END IF;

  -- Lock every candidate row in this tenant sharing this email (case-
  -- insensitive) up front, so a concurrent call linking the same person
  -- into the same tenant can't race past this check. FOR UPDATE can't be
  -- combined directly with array_agg, hence the subquery.
  SELECT COALESCE(array_agg(id), '{}') INTO v_matched_ids
  FROM (
    SELECT id
    FROM clients
    WHERE tenant_id = p_tenant_id
      AND email IS NOT NULL
      AND lower(email) = lower(v_email)
    FOR UPDATE
  ) locked_candidates;

  v_match_count := COALESCE(array_length(v_matched_ids, 1), 0);

  IF v_match_count = 1 THEN
    v_client_id := v_matched_ids[1];
    UPDATE clients SET client_profile_id = p_client_profile_id WHERE id = v_client_id;
    RETURN v_client_id;
  END IF;

  -- 0 matches, or 2+ ambiguous matches: create a fresh row either way.
  -- source stays 'other' — 'web' (used by public-booking's own client
  -- creation) specifically means "created via the anonymous booking form,"
  -- which this isn't.
  INSERT INTO clients (tenant_id, first_name, last_name, phone, email, client_profile_id, status, source)
  VALUES (p_tenant_id, v_first_name, v_last_name, v_phone, v_email, p_client_profile_id, 'active', 'other')
  RETURNING id INTO v_client_id;

  IF v_match_count >= 2 THEN
    INSERT INTO client_link_ambiguities (tenant_id, client_profile_id, email, matched_client_ids, new_client_id)
    VALUES (p_tenant_id, p_client_profile_id, v_email, v_matched_ids, v_client_id);
  END IF;

  RETURN v_client_id;
END;
$$;

-- Unscoped by auth_tenant_id() and takes an arbitrary client_profile_id —
-- must only ever be called by client-link-tenant (service_role), which is
-- responsible for deriving p_client_profile_id from the caller's OWN
-- verified session, never from a request body. A directly-callable RPC
-- would let any authenticated caller link an arbitrary identity to an
-- arbitrary tenant's clients row.
REVOKE ALL ON FUNCTION resolve_or_create_client_link(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_or_create_client_link(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION resolve_or_create_client_link(UUID, UUID) TO service_role;

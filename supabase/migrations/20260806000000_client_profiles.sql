-- Stage D.1 — Layer 1 global client identity ("client_profiles"), the
-- foundation for client-facing login. Standalone/additive: does not touch
-- the existing per-tenant `clients` table, `users`/`user_tenants` (staff
-- auth), or public-booking/index.ts in any way. Not yet wired into the real
-- booking flow — that's Stage D.4, only after D.1-D.3 are manually verified.
--
-- One row per real person, keyed 1:1 to an auth.users row via id (same
-- pattern as public.users). Client accounts are distinguished from staff by
-- app_metadata.role = 'client' on the auth.users row (set by client-register),
-- with NO app_metadata.tenant_id claim — unlike staff, a person can later
-- link to `clients` rows in many different tenants (Stage D.2), so there is
-- no single tenant to bake into the JWT. This is why every existing
-- tenant-scoped RLS policy in this app (built on auth_tenant_id()/auth_role())
-- naturally excludes client accounts without needing to touch a single one
-- of them: a client's JWT never satisfies tenant_id = auth_tenant_id() for
-- any tenant, and auth_role() = 'client' never matches any staff-role check.
CREATE TABLE client_profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  phone               TEXT NOT NULL,
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  birth_date          DATE,
  -- Same category set as the existing clients.source enum, for consistency —
  -- "how did you hear about us" at the platform level rather than per-tenant.
  referral_channel    TEXT CHECK (referral_channel IS NULL OR referral_channel = ANY (ARRAY[
                         'instagram', 'google', 'referral', 'whatsapp', 'in_person', 'other'
                       ])),
  marketing_consent   BOOLEAN NOT NULL DEFAULT false,
  -- Always false — the WhatsApp OTP verification flow once planned as
  -- Stage D.3 was cancelled in favor of trusting user-entered phone
  -- numbers, same as the existing anonymous booking form already does.
  -- Column kept rather than migrated out since nothing reads it as true.
  phone_verified      BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_profiles_email_unique UNIQUE (email),
  CONSTRAINT client_profiles_phone_unique UNIQUE (phone)
);

CREATE OR REPLACE FUNCTION set_client_profiles_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_profiles_upd
BEFORE UPDATE ON client_profiles
FOR EACH ROW EXECUTE FUNCTION set_client_profiles_updated_at();

ALTER TABLE client_profiles ENABLE ROW LEVEL SECURITY;

-- Structurally different from every other RLS policy in this app: not
-- tenant-scoped (there's no tenant here), just row-ownership by the
-- authenticated identity itself, plus a super_admin bypass — confirmed
-- deliberately narrower than this app's usual tenant-scoped convention:
-- only the platform's super_admin (never owner/partner_admin at any
-- tenant) may view/manage the global identity layer, since it spans every
-- tenant and isn't tenant data itself. No INSERT/DELETE policy for
-- `authenticated` is defined on purpose — row creation only ever happens
-- via client-register using the service-role key (bypasses RLS entirely),
-- and no self-serve delete flow exists in this stage.
CREATE POLICY client_profiles_select ON client_profiles
  FOR SELECT USING (auth.uid() = id OR is_super_admin());

CREATE POLICY client_profiles_update ON client_profiles
  FOR UPDATE USING (auth.uid() = id OR is_super_admin()) WITH CHECK (auth.uid() = id OR is_super_admin());

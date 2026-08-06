-- Lets client-register distinguish "this email belongs to a staff account"
-- from "this email belongs to an existing client account" when Supabase
-- Auth rejects a signup as already-registered, so it can return the right
-- error message for each case instead of one generic message for both.
--
-- Existing helper functions (auth_role(), is_super_admin()) only read the
-- CALLER's own JWT via auth.jwt() — there's no existing way to look up an
-- arbitrary OTHER user's role by email, which is what's needed here (the
-- caller isn't authenticated yet, they're mid-registration). service_role
-- only, never anon/authenticated — this would otherwise be an email
-- enumeration oracle (confirms whether any given email is registered at all).
CREATE OR REPLACE FUNCTION public.get_auth_user_role_by_email(p_email TEXT)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE email = p_email LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_auth_user_role_by_email(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_role_by_email(TEXT) TO service_role;

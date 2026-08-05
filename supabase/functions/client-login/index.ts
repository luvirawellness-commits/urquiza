import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.1 — password login for the Layer 1 client identity. Google OAuth
// login itself is NOT reimplemented here — that's Supabase Auth's built-in
// signInWithOAuth({ provider: 'google' }) flow, called directly client-side.
// This endpoint exists on top of the plain signInWithPassword() call (which
// the frontend could call directly) for two reasons: reject a staff account
// that mistakenly hits the client login form, and return the client_profiles
// row in the same round trip instead of a separate profile-get call.
//
// `identifier` accepts either the account's email or its phone (exactly 10
// digits, per validateArgentinePhone's format — same detection rule used
// here). Supabase Auth only knows email, so a digits-only identifier is
// first resolved to its email via a service-role client_profiles lookup
// (pre-auth, so RLS would otherwise hide every row) before the actual
// sign-in — which still runs through the anon client, same as before.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  try {
    const { identifier, password } = await req.json()
    if (!identifier || !password) return err('identifier y password son requeridos')

    const trimmedIdentifier = String(identifier).trim()
    const isPhone = /^\d+$/.test(trimmedIdentifier)

    let resolvedEmail: string
    if (isPhone) {
      // Pre-auth lookup — client_profiles' RLS (auth.uid() = id) would hide
      // every row from an unauthenticated caller, so this one step needs
      // the service-role key. Same generic error as bad credentials below,
      // so a nonexistent phone isn't distinguishable from a wrong password.
      const supabaseAdmin = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        { auth: { autoRefreshToken: false, persistSession: false } },
      )
      const { data: profile, error: lookupErr } = await supabaseAdmin
        .from('client_profiles')
        .select('email')
        .eq('phone', trimmedIdentifier)
        .maybeSingle()
      if (lookupErr) throw lookupErr
      if (!profile) return err('Email/teléfono o contraseña incorrectos.', 401)
      resolvedEmail = profile.email
    } else {
      resolvedEmail = trimmedIdentifier.toLowerCase()
    }

    // A real (non-admin) client, exactly like a browser would use — the
    // resulting session is the same one the frontend would get calling
    // signInWithPassword() itself.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password: String(password),
    })
    if (signInError || !signInData.session) {
      return err('Email/teléfono o contraseña incorrectos.', 401)
    }

    const role = signInData.user.app_metadata?.role as string | undefined
    if (role !== 'client') {
      await supabase.auth.signOut()
      return err('Esta cuenta no es una cuenta de cliente.', 403)
    }

    const { data: profile, error: profileErr } = await supabase
      .from('client_profiles')
      .select('*')
      .eq('id', signInData.user.id)
      .maybeSingle()
    if (profileErr) throw profileErr

    return json({ session: signInData.session, profile })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

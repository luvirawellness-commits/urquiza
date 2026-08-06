import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateArgentinePhone } from '../_shared/phoneValidation.ts'

// Stage D.1 — Layer 1 global client identity registration. Standalone,
// not wired into the real booking flow yet (that's Stage D.4) and does not
// touch public-booking/index.ts or any staff-auth path.
//
// Two modes:
// - 'password': fresh email/password signup. Creates the auth.users row here
//   via the admin API (app_metadata.role='client'), then the client_profiles
//   row. The frontend still needs to call supabase.auth.signInWithPassword()
//   afterward to get a session — this endpoint only creates the account,
//   mirroring how create-user (staff) leaves sign-in to a separate step.
// - 'google': called AFTER the browser has already completed Supabase's
//   built-in Google OAuth flow client-side (which creates the auth.users row
//   automatically, with no custom app_metadata). This call must carry that
//   session's access token so we can verify who's calling, stamp
//   app_metadata.role='client' on their now-existing auth.users row, and
//   create their client_profiles row.

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

const REFERRAL_CHANNELS = ['instagram', 'google', 'referral', 'whatsapp', 'in_person', 'other']

// One person can't hold both a staff role and a client identity under the
// same email — auth.users.email is globally unique regardless of role, and
// app_metadata.role is a single value. When Supabase Auth rejects a signup
// as already-registered, distinguish "that email is a staff login" (a
// deliberate collision the person needs a different email to work around)
// from "that email is already a client account" (the ordinary generic
// case — e.g. someone re-registering by mistake instead of logging in).
const STAFF_ROLES = ['owner', 'partner_admin', 'receptionist', 'super_admin', 'therapist']

// deno-lint-ignore no-explicit-any
async function emailCollisionMessage(supabaseAdmin: any, email: string): Promise<string> {
  const { data: existingRole } = await supabaseAdmin.rpc('get_auth_user_role_by_email', { p_email: email })
  if (existingRole && STAFF_ROLES.includes(existingRole)) {
    return 'Este email ya está registrado como personal de un local. Para reservar como cliente, usá un email diferente.'
  }
  return 'Ya existe una cuenta con ese email.'
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const body = await req.json()
    const {
      mode,
      email, password,
      first_name, last_name, phone,
      birth_date, referral_channel, marketing_consent,
    } = body

    if (mode !== 'password' && mode !== 'google') {
      return err("mode debe ser 'password' o 'google'")
    }
    if (!first_name || !last_name || !phone) {
      return err('first_name, last_name y phone son requeridos')
    }
    if (referral_channel && !REFERRAL_CHANNELS.includes(referral_channel)) {
      return err('referral_channel inválido')
    }

    const cleanFirstName = String(first_name).trim()
    const cleanLastName = String(last_name).trim()
    const cleanPhone = String(phone).trim()

    const phoneError = validateArgentinePhone(cleanPhone)
    if (phoneError) return err(phoneError)

    let userId: string
    let userEmail: string
    let createdAuthUser = false

    if (mode === 'password') {
      if (!email || !password) return err('email y password son requeridos')
      userEmail = String(email).trim().toLowerCase()

      // Auto-confirmed for now, since this stage isn't wired to a real
      // signup surface yet and there's no confirmation-email template
      // decided on — revisit before Stage D.4 wires this to real users.
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        password: String(password),
        email_confirm: true,
        app_metadata: { role: 'client' },
      })
      if (authError) {
        if (authError.message?.toLowerCase().includes('already been registered')) {
          return err(await emailCollisionMessage(supabaseAdmin, userEmail))
        }
        throw authError
      }
      userId = authData.user.id
      createdAuthUser = true
    } else {
      // Google mode: the auth.users row already exists (created by Supabase's
      // OAuth flow the moment the browser completed sign-in) — we only
      // identify who's calling via their own access token, never trust a
      // client-supplied id.
      const authHeader = req.headers.get('Authorization')
      if (!authHeader) return err('Falta el token de sesión de Google', 401)
      const token = authHeader.replace('Bearer ', '')

      const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
      if (callerError || !callerData.user) return err('Token inválido', 401)

      userId = callerData.user.id
      userEmail = (callerData.user.email ?? '').trim().toLowerCase()
      if (!userEmail) return err('La cuenta de Google no tiene email disponible', 400)

      await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: { ...callerData.user.app_metadata, role: 'client' },
      })
    }

    try {
      const { data: profile, error: profileErr } = await supabaseAdmin
        .from('client_profiles')
        .insert({
          id: userId,
          email: userEmail,
          phone: cleanPhone,
          first_name: cleanFirstName,
          last_name: cleanLastName,
          birth_date: birth_date || null,
          referral_channel: referral_channel || null,
          marketing_consent: marketing_consent === true,
        })
        .select()
        .single()

      if (profileErr) {
        if (profileErr.code === '23505') {
          // Distinguish which unique constraint fired for a clearer message.
          const msg = profileErr.message?.includes('phone')
            ? 'Ya existe una cuenta con ese teléfono.'
            : 'Ya existe una cuenta con ese email.'
          throw new Error(msg)
        }
        throw profileErr
      }

      return json({ user_id: userId, profile })
    } catch (innerError) {
      // Only roll back the auth user we created ourselves — in google mode
      // the auth.users row predates this call (owned by Supabase's OAuth
      // flow) and must never be deleted here.
      if (createdAuthUser) {
        await supabaseAdmin.auth.admin.deleteUser(userId)
      }
      throw innerError
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.1 addition — lets the platform super_admin directly set a new
// password for a Layer 1 client account, from the new SuperAdmin.tsx
// "Clientes globales" section. super_admin only (not owner/partner_admin at
// any tenant — per the confirmed narrower access than the usual
// tenant-scoped convention, matching client_profiles' RLS bypass).
//
// Same caller-verification shape as create-user/index.ts (verify token,
// check role), applied to admin.updateUserById({ password }) instead of
// admin.createUser — the direct-password-set path that ResetPasswordModal
// explicitly deferred to "usá el panel de Supabase" for staff accounts.

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

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('No autorizado', 401)
    const token = authHeader.replace('Bearer ', '')

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
    if (callerError || !callerData.user) return err('Token inválido', 401)

    const callerRole = callerData.user.app_metadata?.role as string | undefined
    if (callerRole !== 'super_admin') {
      return err('No tenés permiso para realizar esta acción', 403)
    }

    const { client_user_id, new_password } = await req.json()
    if (!client_user_id || !new_password) {
      return err('client_user_id y new_password son requeridos')
    }
    if (String(new_password).length < 8) {
      return err('La contraseña debe tener al menos 8 caracteres')
    }

    // Defense in depth: confirm the target is actually a client account, not
    // a staff account — this endpoint must never become a backdoor to reset
    // staff passwords outside the existing admin flow.
    const { data: targetProfile, error: targetErr } = await supabaseAdmin
      .from('client_profiles')
      .select('id')
      .eq('id', client_user_id)
      .maybeSingle()
    if (targetErr) throw targetErr
    if (!targetProfile) return err('Cuenta de cliente no encontrada', 404)

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(client_user_id, {
      password: String(new_password),
    })
    if (updateErr) throw updateErr

    return json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

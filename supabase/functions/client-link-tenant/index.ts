import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.2 — the real client_profiles ↔ clients link. Thin wrapper around
// resolve_or_create_client_link(): verifies the caller is a real logged-in
// client account and derives client_profile_id from THEIR OWN verified
// session — never from the request body — before calling the RPC. This is
// the only thing allowed to call that RPC (see its REVOKE/GRANT in
// 20260807000000_client_tenant_linking.sql); trusting a body-supplied
// client_profile_id here would let any client link an arbitrary identity
// into an arbitrary tenant's clients row.
//
// Not wired into any real flow yet — Stage D.4's booking integration will
// call this the moment a logged-in client starts interacting with a
// specific tenant. Safe to call repeatedly: the RPC is idempotent once a
// link exists.

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
    if (callerRole !== 'client') return err('Esta cuenta no es una cuenta de cliente.', 403)

    const { tenant_id } = await req.json()
    if (!tenant_id) return err('tenant_id es requerido')

    const { data: clientId, error: rpcErr } = await supabaseAdmin.rpc('resolve_or_create_client_link', {
      p_client_profile_id: callerData.user.id,
      p_tenant_id: tenant_id,
    })
    if (rpcErr) throw rpcErr

    return json({ client_id: clientId })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

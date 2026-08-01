import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.1 — lists every tenant where the logged-in client has ANY
// matching clients row, so a future portal UI can show "you have activity
// at: X" and let them pick which tenant's history to view (client-my-
// appointments). Same service-role + code-enforced-isolation reasoning as
// client-my-appointments — a client's JWT can never pass tenant-scoped RLS
// on `clients`, so this has to run as service role and do its own scoping,
// which here is deliberately NOT tenant-scoped (that's the whole point:
// this is the one endpoint in Stage D.1 that intentionally searches across
// every tenant, to discover which ones apply).
//
// Same placeholder email-matching strategy as client-my-appointments —
// replaced by Stage D.2's real linking mechanism once it lands.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

    const { data: clientProfile, error: profileErr } = await supabaseAdmin
      .from('client_profiles')
      .select('email')
      .eq('id', callerData.user.id)
      .maybeSingle()
    if (profileErr) throw profileErr
    if (!clientProfile) return err('Perfil no encontrado', 404)

    const { data: matches, error: matchesErr } = await supabaseAdmin
      .from('clients')
      .select('tenant:tenants!fk_clients_tenant (id, name, slug)')
      .ilike('email', clientProfile.email)
    if (matchesErr) throw matchesErr

    // A client can have more than one clients row in the same tenant (a
    // known pre-existing duplicate-email case) — dedupe so each tenant
    // appears once regardless of how many rows matched inside it.
    const seen = new Set<string>()
    // deno-lint-ignore no-explicit-any
    const tenants = (matches ?? [])
      .map((m) => m.tenant as { id: string; name: string; slug: string } | null)
      .filter((t): t is { id: string; name: string; slug: string } => {
        if (!t || seen.has(t.id)) return false
        seen.add(t.id)
        return true
      })

    return json({ tenants })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.2 — lists every tenant where the logged-in client has a REAL link
// (clients.client_profile_id, set by client-link-tenant), so a future
// portal UI can show "you have activity at: X" and let them pick which
// tenant's history to view (client-my-appointments). Same service-role +
// code-enforced-isolation reasoning as client-my-appointments — a client's
// JWT can never pass tenant-scoped RLS on `clients`, so this has to run as
// service role, deliberately searching across every tenant (that's the
// whole point of this one endpoint: discover which tenants apply).
//
// Behavior change from Stage D.1's placeholder: this now reflects only
// CONFIRMED links, not every tenant where the client's email happens to
// match a clients row. A tenant the client has activity at but has never
// actually interacted with as a logged-in client (i.e., client-link-tenant
// was never called for it) won't appear here until they do — which is the
// intended, more correct behavior now that a real link exists to check.

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

    // The unique index on (tenant_id, client_profile_id) guarantees at most
    // one linked row per tenant, so no dedup step is needed here anymore.
    const { data: links, error: linksErr } = await supabaseAdmin
      .from('clients')
      .select('tenant:tenants!fk_clients_tenant (id, name, slug)')
      .eq('client_profile_id', callerData.user.id)
    if (linksErr) throw linksErr

    const tenants = (links ?? [])
      .map((l) => l.tenant as { id: string; name: string; slug: string } | null)
      .filter((t): t is { id: string; name: string; slug: string } => !!t)

    return json({ tenants })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

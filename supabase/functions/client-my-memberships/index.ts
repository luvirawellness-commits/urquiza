import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.5.1 — a logged-in client's ACTIVE membership status across every
// tenant they have a real link in (clients.client_profile_id, set by
// client-link-tenant), so "Mi cuenta" can show "you have N sesiones left at
// X" without the client picking a tenant first. Same service-role +
// code-enforced per-tenant isolation as client-my-appointments/
// client-my-tenants — a client's JWT can never pass tenant-scoped RLS on
// `clients`/`client_memberships`, and a membership from one tenant must
// never be attributed to another.

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

    // Every tenant this client has a real link in — same source of truth as
    // client-my-tenants.
    const { data: links, error: linksErr } = await supabaseAdmin
      .from('clients')
      .select('id, tenant:tenants!fk_clients_tenant (id, name, slug)')
      .eq('client_profile_id', callerData.user.id)
    if (linksErr) throw linksErr
    if (!links || links.length === 0) return json({ memberships: [] })

    // One query per linked tenant, each explicitly scoped to that tenant's
    // own client_id — mirrors client-my-appointments' belt-and-suspenders
    // double filter (tenant_id + client_id together) rather than a single
    // cross-tenant .in() query, so a membership can never be attributed to
    // the wrong tenant even in theory.
    const results = await Promise.all(
      links.map(async (link) => {
        const tenant = link.tenant as { id: string; name: string; slug: string } | null
        if (!tenant) return []

        const { data: memberships, error: memErr } = await supabaseAdmin
          .from('client_memberships')
          .select('id, plan:memberships(id, name), sessions_total, sessions_used, expires_at')
          .eq('tenant_id', tenant.id)
          .eq('client_id', link.id)
          .eq('status', 'active')
        if (memErr) throw memErr

        return (memberships ?? []).map((m) => ({ ...m, tenant }))
      }),
    )

    return json({ memberships: results.flat() })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

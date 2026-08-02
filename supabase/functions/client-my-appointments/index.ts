import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.2 — a logged-in client's appointment history for ONE specific
// tenant, resolved via the REAL client_profiles ↔ clients link
// (clients.client_profile_id, set by client-link-tenant) rather than Stage
// D.1's placeholder email-matching. Uses the service-role key deliberately
// (unlike client-profile-get/update): a client's JWT carries no
// app_metadata.tenant_id, so it can never satisfy any tenant-scoped RLS
// policy on `clients`/`appointments` — the forwarded-JWT approach those two
// endpoints use simply wouldn't return anything here. Isolation is instead
// enforced in code: every query below is explicitly scoped to the one
// tenant_id the caller asked for, mirroring why public-booking already uses
// the service-role key for its own cross-tenant-unaware, code-enforced
// isolation.
//
// This does NOT trigger linking itself — if the caller was never linked
// into this tenant (client-link-tenant was never called for it), this
// simply returns an empty list, not an error. Linking only happens when the
// client actually initiates something with that tenant (Stage D.4).

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

    // The real link — a unique index guarantees at most one row per
    // (tenant_id, client_profile_id), so .maybeSingle() is safe here.
    const { data: linkedClient, error: linkErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('client_profile_id', callerData.user.id)
      .maybeSingle()
    if (linkErr) throw linkErr
    if (!linkedClient) return json({ appointments: [] })

    // Belt-and-suspenders: tenant_id filtered again here even though the
    // matched client_id already belongs to this tenant by construction — an
    // appointment for a client outside `tenant_id` must never leak through.
    const { data: appointments, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select(`
        id,
        scheduled_at,
        duration_minutes,
        status,
        notes,
        price_charged,
        therapist:users!fk_apt_therapist (id, full_name),
        service:services!fk_apt_service (id, name, emoji)
      `)
      .eq('tenant_id', tenant_id)
      .eq('client_id', linkedClient.id)
      .order('scheduled_at', { ascending: false })
    if (apptErr) throw apptErr

    return json({ appointments: appointments ?? [] })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

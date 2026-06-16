import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return json({ error: 'Método no permitido' }, 405)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const { data: tenants, error: tenantsErr } = await supabase
      .from('tenants')
      .select('id, name, slug, address, phone, whatsapp_number')
      .eq('active', true)
      .eq('listed_in_directory', true)
      .order('name')

    if (tenantsErr) throw tenantsErr
    if (!tenants || tenants.length === 0) return json({ tenants: [] })

    const tenantIds = tenants.map((t) => t.id)

    const { data: allServices, error: servicesErr } = await supabase
      .from('services')
      .select('tenant_id, name, emoji')
      .in('tenant_id', tenantIds)
      .eq('active', true)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('name')

    if (servicesErr) throw servicesErr

    // Group services by tenant, keeping top 4 per tenant
    const servicesByTenant = new Map<string, { name: string; emoji: string | null }[]>()
    for (const svc of allServices ?? []) {
      const list = servicesByTenant.get(svc.tenant_id) ?? []
      if (list.length < 4) list.push({ name: svc.name, emoji: svc.emoji ?? null })
      servicesByTenant.set(svc.tenant_id, list)
    }

    const result = tenants.map((t) => ({
      id:               t.id,
      name:             t.name,
      slug:             t.slug,
      address:          t.address ?? null,
      phone:            t.phone ?? null,
      whatsapp_number:  t.whatsapp_number ?? null,
      services:         servicesByTenant.get(t.id) ?? [],
    }))

    return json({ tenants: result })

  } catch (error) {
    console.error('public-directory error:', error)
    return json(
      { error: error instanceof Error ? error.message : 'Error interno del servidor' },
      500,
    )
  }
})

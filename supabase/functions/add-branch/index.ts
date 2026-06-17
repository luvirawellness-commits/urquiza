import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('Método no permitido', 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json() as Record<string, any>
    const { user_id, access_token, tenant_name, slug, address, phone, whatsapp_number } = body

    if (!user_id || !access_token || !tenant_name || !slug) {
      return err('user_id, access_token, tenant_name y slug son requeridos')
    }

    // 1. Verify access_token belongs to user_id
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser || authUser.id !== user_id) {
      return err('No autorizado', 401)
    }

    // Verify caller is owner or super_admin
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle()

    if (!userRow || !['owner', 'super_admin'].includes(userRow.role as string)) {
      return err('Solo los propietarios pueden agregar sucursales', 403)
    }

    // 2. Check slug uniqueness
    const normalizedSlug = String(slug).toLowerCase().trim()
    const { data: slugExists } = await supabase
      .from('tenants')
      .select('id')
      .eq('slug', normalizedSlug)
      .maybeSingle()

    if (slugExists) {
      return err('El slug ya está en uso. Elegí otro nombre para la URL.', 409)
    }

    // 3. Create new tenant with 7-day trial
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .insert({
        name:             String(tenant_name).trim(),
        slug:             normalizedSlug,
        address:          address ? String(address).trim() : null,
        phone:            phone ? String(phone).trim() : null,
        whatsapp_number:  whatsapp_number ? String(whatsapp_number).trim() : null,
        active:           true,
        trial_ends_at:    trialEndsAt,
      })
      .select()
      .single()

    if (tenantErr) throw tenantErr

    // 4. Add owner to the new tenant in user_tenants
    const { error: utErr } = await supabase
      .from('user_tenants')
      .insert({
        user_id,
        tenant_id: tenant.id,
        role:      'owner',
        active:    true,
      })

    if (utErr) throw utErr

    console.log('Branch created:', { tenant_id: tenant.id, slug: normalizedSlug, owner: user_id })

    return json({ success: true, tenant_id: tenant.id, trial_ends_at: trialEndsAt })

  } catch (error) {
    console.error('add-branch error:', error)
    return err(
      error instanceof Error ? error.message : 'Error interno del servidor',
      500,
    )
  }
})

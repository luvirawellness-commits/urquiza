import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const { email, full_name, role, color_hex, default_tenant_id, tenant_assignments } = await req.json()

    if (!email || !full_name) {
      return new Response(
        JSON.stringify({ error: 'email y full_name son obligatorios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Generate a strong temp password: 8 random chars + 4 uppercase + digit + symbol
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let tempPassword = ''
    for (let i = 0; i < 8; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)]
    for (let i = 0; i < 3; i++) tempPassword += upper[Math.floor(Math.random() * upper.length)]
    tempPassword += '1!'

    // 1. Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
    })
    if (authError) throw authError
    const userId = authData.user.id

    let userCreated = false
    let tenantsCreated = false

    try {
      // 2. Create public.users row
      const primaryTenantId = default_tenant_id ?? tenant_assignments?.[0]?.tenant_id ?? null
      const { error: profileError } = await supabaseAdmin.from('users').insert({
        id: userId,
        email,
        full_name,
        role: role ?? 'therapist',
        color_hex: color_hex ?? '#7C3AED',
        tenant_id: primaryTenantId,
        default_tenant_id: primaryTenantId,
        active: true,
      })
      if (profileError) throw profileError
      userCreated = true

      // 3. Create user_tenants rows
      if (tenant_assignments?.length > 0) {
        const { error: tenantsError } = await supabaseAdmin.from('user_tenants').insert(
          // deno-lint-ignore no-explicit-any
          tenant_assignments.map((a: any) => ({
            user_id: userId,
            tenant_id: a.tenant_id,
            role: a.role,
            active: true,
          })),
        )
        if (tenantsError) throw tenantsError
        tenantsCreated = true
      }

      return new Response(
        JSON.stringify({ user_id: userId, temp_password: tempPassword }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    } catch (innerError) {
      // Rollback in reverse order
      if (tenantsCreated) {
        await supabaseAdmin.from('user_tenants').delete().eq('user_id', userId)
      }
      if (userCreated) {
        await supabaseAdmin.from('users').delete().eq('id', userId)
      }
      await supabaseAdmin.auth.admin.deleteUser(userId)
      throw innerError
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

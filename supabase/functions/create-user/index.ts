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

    // 0. Verify the requesting user's identity and role
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
    if (callerError || !callerData.user) {
      return new Response(
        JSON.stringify({ error: 'Token inválido' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const callerId = callerData.user.id
    const callerAppRole = callerData.user.app_metadata?.role as string | undefined
    const isSuperAdminCaller = callerAppRole === 'super_admin'

    let callerRole: string
    if (isSuperAdminCaller) {
      callerRole = 'super_admin'
    } else {
      const { data: callerProfile, error: profileError } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', callerId)
        .single()

      if (profileError || !callerProfile) {
        return new Response(
          JSON.stringify({ error: 'Perfil del solicitante no encontrado' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      callerRole = callerProfile.role as string
    }

    if (callerRole !== 'owner' && callerRole !== 'partner_admin' && callerRole !== 'super_admin') {
      return new Response(
        JSON.stringify({ error: 'No tenés permiso para crear usuarios' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Read body only once, after auth check
    const { email, full_name, role, color_hex, default_tenant_id, tenant_assignments, password: providedPassword } = await req.json()

    if (!email || !full_name) {
      return new Response(
        JSON.stringify({ error: 'email y full_name son obligatorios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // partner_admin cannot create owner accounts
    if (callerRole === 'partner_admin' && role === 'owner') {
      return new Response(
        JSON.stringify({ error: 'Un partner_admin no puede crear usuarios owner' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // partner_admin can only assign tenants they themselves belong to (super_admin skips this)
    if (!isSuperAdminCaller && callerRole === 'partner_admin' && tenant_assignments?.length > 0) {
      const { data: callerTenants, error: tenantsErr } = await supabaseAdmin
        .from('user_tenants')
        .select('tenant_id')
        .eq('user_id', callerId)

      if (tenantsErr) throw tenantsErr

      const allowedTenantIds = new Set((callerTenants ?? []).map((t: { tenant_id: string }) => t.tenant_id))
      // deno-lint-ignore no-explicit-any
      const unauthorized = (tenant_assignments as any[]).find((a) => !allowedTenantIds.has(a.tenant_id))
      if (unauthorized) {
        return new Response(
          JSON.stringify({ error: 'No tenés permiso para asignar usuarios a ese local' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    // Use caller-provided password if given, otherwise generate one
    let tempPassword = (providedPassword as string | undefined) ?? ''
    if (!tempPassword) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
      const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      for (let i = 0; i < 8; i++) tempPassword += chars[Math.floor(Math.random() * chars.length)]
      for (let i = 0; i < 3; i++) tempPassword += upper[Math.floor(Math.random() * upper.length)]
      tempPassword += '1!'
    }

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
      const { error: profileErr } = await supabaseAdmin.from('users').insert({
        id: userId,
        email,
        full_name,
        role: role ?? 'therapist',
        color_hex: color_hex ?? '#7C3AED',
        tenant_id: primaryTenantId,
        default_tenant_id: primaryTenantId,
        active: true,
      })
      if (profileErr) throw profileErr
      userCreated = true

      // Stamp app_metadata so JWT claims carry tenant_id + role
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          tenant_id: primaryTenantId,
          role: role ?? 'therapist',
        },
      })

      // 3. Create user_tenants rows
      if (tenant_assignments?.length > 0) {
        const { error: tenantsError } = await supabaseAdmin.from('user_tenants').insert(
          // deno-lint-ignore no-explicit-any
          (tenant_assignments as any[]).map((a) => ({
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

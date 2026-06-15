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

    const { email, password, full_name, tenant_name, slug, address, phone, timezone, services } =
      await req.json()

    console.log('register-tenant: payload received', { email, full_name, tenant_name, slug })

    if (!email || !password || !full_name || !tenant_name || !slug) {
      return new Response(
        JSON.stringify({ success: false, error: 'Faltan campos obligatorios.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Check slug uniqueness
    console.log('Step 0: checking slug uniqueness...')
    const { data: existingTenant, error: slugCheckError } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle()

    if (slugCheckError) {
      console.error('Step 0 error (slug check):', slugCheckError)
    }

    if (existingTenant) {
      return new Response(
        JSON.stringify({ success: false, error: 'El identificador ya está en uso. Elegí otro.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const tenantId = crypto.randomUUID()
    console.log('Step 1: creating auth user...', { email, tenantId })

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { role: 'owner', tenant_id: tenantId },
    })

    if (authError) {
      console.error('Step 1 error (auth user):', authError)
      const msg = authError.message.toLowerCase()
      if (msg.includes('already registered') || msg.includes('already exists')) {
        return new Response(
          JSON.stringify({ success: false, error: 'Ya existe una cuenta con ese email.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      throw authError
    }

    console.log('Step 1: auth user created', authData.user.id)

    const userId = authData.user.id
    let tenantCreated = false
    let userCreated = false
    let userTenantCreated = false

    try {
      // 2. Create tenant
      console.log('Step 2: creating tenant...')
      const trialEndsAt = new Date()
      trialEndsAt.setDate(trialEndsAt.getDate() + 7)

      const { error: tenantError } = await supabaseAdmin.from('tenants').insert({
        id: tenantId,
        name: tenant_name,
        slug,
        address,
        phone,
        timezone: timezone || 'America/Argentina/Buenos_Aires',
        trial_ends_at: trialEndsAt.toISOString(),
        active: true,
      })
      if (tenantError) {
        console.error('Step 2 error (tenant insert):', tenantError)
        throw tenantError
      }
      tenantCreated = true
      console.log('Step 2: tenant created')

      // 3. Create user profile
      console.log('Step 3: creating user profile...')
      const { error: userError } = await supabaseAdmin.from('users').insert({
        id: userId,
        tenant_id: tenantId,
        email,
        full_name,
        role: 'owner',
        active: true,
      })
      if (userError) {
        console.error('Step 3 error (user insert):', userError)
        throw userError
      }
      userCreated = true
      console.log('Step 3: user profile created')

      // 4. Create user_tenants entry
      console.log('Step 4: creating user_tenants entry...')
      const { error: utError } = await supabaseAdmin.from('user_tenants').insert({
        user_id: userId,
        tenant_id: tenantId,
        role: 'owner',
        active: true,
      })
      if (utError) {
        console.error('Step 4 error (user_tenants insert):', utError)
        throw utError
      }
      userTenantCreated = true
      console.log('Step 4: user_tenants entry created')

      // 5. Create default services
      if (Array.isArray(services) && services.length > 0) {
        console.log('Step 5: creating services...', services.length)
        const { error: svcError } = await supabaseAdmin.from('services').insert(
          // deno-lint-ignore no-explicit-any
          (services as any[]).map((s, i) => ({
            tenant_id: tenantId,
            name: s.name,
            price_60: s.price_60 ?? 0,
            price_90: s.price_90 ?? 0,
            active: true,
            available_in_memberships: true,
            sort_order: i,
          })),
        )
        if (svcError) {
          console.error('Step 5 error (services insert):', svcError)
          throw svcError
        }
        console.log('Step 5: services created')
      }

      console.log('register-tenant: all steps completed successfully')
      return new Response(
        JSON.stringify({ success: true, tenant_id: tenantId, user_id: userId }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    } catch (innerError) {
      console.error('register-tenant: rolling back...', innerError)
      if (userTenantCreated) {
        await supabaseAdmin.from('user_tenants').delete().eq('user_id', userId)
      }
      if (userCreated) {
        await supabaseAdmin.from('users').delete().eq('id', userId)
      }
      if (tenantCreated) {
        await supabaseAdmin.from('tenants').delete().eq('id', tenantId)
      }
      await supabaseAdmin.auth.admin.deleteUser(userId)
      throw innerError
    }
  } catch (error) {
    console.error('register-tenant error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : JSON.stringify(error),
        details: error,
      }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

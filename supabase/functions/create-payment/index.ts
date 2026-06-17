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

  const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
  if (!MP_ACCESS_TOKEN) return err('Configuración de pago incompleta', 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json() as Record<string, any>
    const { tenant_id, plan, access_token } = body

    if (!tenant_id || !plan || !access_token) {
      return err('tenant_id, plan y access_token son requeridos')
    }
    if (!['monthly', 'annual'].includes(plan)) {
      return err('plan debe ser "monthly" o "annual"')
    }

    // 1. Verify access_token
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser) return err('No autorizado', 401)

    // 2. Get tenant info
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name')
      .eq('id', tenant_id)
      .single()

    if (tenantErr || !tenant) return err('Tenant no encontrado', 404)

    // 3. Create MercadoPago preference
    const unitPrice = plan === 'monthly' ? 80 : 600
    const title = plan === 'monthly' ? 'Luvira OS — Plan Mensual' : 'Luvira OS — Plan Anual'

    const preference = {
      items: [{ title, quantity: 1, unit_price: unitPrice, currency_id: 'USD' }],
      back_urls: {
        success: 'https://app.luviraos.com/pago-exitoso',
        failure: 'https://app.luviraos.com/pago-fallido',
        pending: 'https://app.luviraos.com/pago-pendiente',
      },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      metadata: { tenant_id, plan },
      statement_descriptor: 'LUVIRA OS',
    }

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preference),
    })

    if (!mpRes.ok) {
      const mpErr = await mpRes.text()
      console.error('MercadoPago error:', mpErr)
      return err('Error al crear la preferencia de pago', 502)
    }

    const mpData = await mpRes.json() as { id: string; init_point: string }

    return json({ preference_id: mpData.id, init_point: mpData.init_point })

  } catch (error) {
    console.error('create-payment error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

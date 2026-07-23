import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimit.ts'

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

  // Public endpoint (called by anonymous clients from the online booking page),
  // so it's rate-limited by IP instead of relying on a Supabase auth session.
  const ip = req.headers.get('x-forwarded-for')
    ?? req.headers.get('cf-connecting-ip')
    ?? 'unknown'

  const rl = await checkRateLimit({
    key: `create-sena-payment:${ip}`,
    limit: 20,
    windowSeconds: 60,
  })
  if (!rl.allowed) return rateLimitResponse(rl.resetIn)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json() as Record<string, any>
    const {
      tenant_id, amount, client_id, client_name, client_email,
      service_name, service_id, therapist_id, scheduled_at,
      duration_minutes, notes,
    } = body

    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_ACCESS_TOKEN) return err('Configuración de pago incompleta', 500)

    if (!tenant_id || !amount || !client_id || !client_name || !service_name ||
        !service_id || !therapist_id || !scheduled_at || !duration_minutes) {
      return err('Faltan datos requeridos para iniciar el pago de la seña')
    }
    const amountNum = Number(amount)
    if (!(amountNum > 0)) return err('amount debe ser mayor a 0')

    // 1. Get tenant info (slug is needed to redirect back to its booking page)
    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id, name, slug')
      .eq('id', tenant_id)
      .single()
    if (tenantErr || !tenant) return err('Tenant no encontrado', 404)

    // 2. Sanity-check the referenced client/service/therapist belong to this
    // tenant before charging — a bad ID here would only surface as a failed
    // insert in mp-webhook *after* the client has already paid.
    const [clientRes, serviceRes, therapistRes] = await Promise.all([
      supabase.from('clients').select('id').eq('id', client_id).eq('tenant_id', tenant_id).maybeSingle(),
      supabase.from('services').select('id').eq('id', service_id).eq('tenant_id', tenant_id).maybeSingle(),
      supabase.from('users').select('id').eq('id', therapist_id).eq('tenant_id', tenant_id).maybeSingle(),
    ])
    if (!clientRes.data) return err('Cliente no encontrado', 404)
    if (!serviceRes.data) return err('Servicio no encontrado', 404)
    if (!therapistRes.data) return err('Terapeuta no encontrado', 404)

    // No appointment is created here — mp-webhook creates it only once the
    // seña payment is confirmed as 'approved', so an abandoned checkout never
    // occupies a slot. All the booking data rides along in the preference
    // metadata for the webhook to use at that point.
    const BOOKING_URL = Deno.env.get('BOOKING_URL') ?? 'https://luviraos.com'
    const bookingReturnUrl = `${BOOKING_URL}/reservar/${tenant.slug}`

    const preference = {
      items: [{ title: `Seña - ${service_name}`, quantity: 1, unit_price: amountNum, currency_id: 'ARS' }],
      payer: { name: client_name, email: client_email || undefined },
      back_urls: {
        success: `${bookingReturnUrl}?status=approved`,
        failure: `${bookingReturnUrl}?status=failure`,
        pending: `${bookingReturnUrl}?status=pending`,
      },
      auto_return: 'approved',
      notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
      metadata: {
        type: 'sena',
        tenant_id,
        client_id,
        service_id,
        service_name,
        therapist_id,
        scheduled_at,
        duration_minutes,
        amount: amountNum,
        notes: notes || '',
      },
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
    console.error('create-sena-payment error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

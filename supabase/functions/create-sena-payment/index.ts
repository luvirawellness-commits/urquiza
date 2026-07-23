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
    const { appointment_id, tenant_id, amount, client_name, client_email, service_name } = body

    const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
    if (!MP_ACCESS_TOKEN) return err('Configuración de pago incompleta', 500)

    if (!tenant_id || !amount || !client_name || !service_name) {
      return err('tenant_id, amount, client_name y service_name son requeridos')
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

    // 2. Verify the appointment exists and is awaiting this payment. The
    // booking flow must create the appointment (it holds the real
    // client_id/service_id/therapist_id/scheduled_at) before calling this
    // function — those IDs aren't part of this payload, so a fresh
    // appointment can't be built here. Its status must stay 'pending_payment'
    // until mp-webhook confirms the payment — flipping it early here would
    // make the slot look confirmed before it actually is.
    if (!appointment_id) return err('appointment_id es requerido', 400)

    const { data: appointment, error: apptErr } = await supabase
      .from('appointments')
      .select('id, status')
      .eq('id', appointment_id)
      .eq('tenant_id', tenant_id)
      .single()
    if (apptErr || !appointment) return err('Turno no encontrado', 404)

    if (appointment.status !== 'pending' && appointment.status !== 'pending_payment') {
      return err('El turno no está disponible para el pago de la seña', 409)
    }

    // 3. Create MercadoPago preference. All three back_urls point to the same
    // public booking page (with an explicit ?status= so the page can render
    // the right message) rather than relying on MP's own redirect params.
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
      metadata: { type: 'sena', appointment_id, tenant_id, amount: amountNum },
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

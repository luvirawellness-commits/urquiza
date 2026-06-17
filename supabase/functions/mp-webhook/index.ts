import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json({ ok: true })

  const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN')
  if (!MP_ACCESS_TOKEN) {
    console.error('MP_ACCESS_TOKEN not set')
    return json({ error: 'Configuration error' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const url = new URL(req.url)
    // deno-lint-ignore no-explicit-any
    const body = await req.json().catch(() => ({})) as Record<string, any>

    // Support both webhook format (body) and IPN format (query params)
    const topic = body?.type ?? url.searchParams.get('topic')
    const paymentId = body?.data?.id ?? url.searchParams.get('id')

    if (topic !== 'payment' || !paymentId) {
      return json({ received: true })
    }

    // 2. Fetch payment details from MercadoPago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { 'Authorization': `Bearer ${MP_ACCESS_TOKEN}` },
    })

    if (!mpRes.ok) {
      console.error('Failed to fetch MP payment:', await mpRes.text())
      return json({ error: 'Failed to fetch payment' }, 502)
    }

    // deno-lint-ignore no-explicit-any
    const payment = await mpRes.json() as Record<string, any>
    console.log('Payment received:', { id: payment.id, status: payment.status, metadata: payment.metadata })

    // 3. Only process approved payments
    if (payment.status !== 'approved') {
      return json({ received: true, status: payment.status })
    }

    const { tenant_id, plan } = payment.metadata ?? {}
    if (!tenant_id || !plan) {
      console.error('Missing metadata:', payment.metadata)
      return json({ error: 'Missing tenant_id or plan in metadata' }, 400)
    }

    const DAYS: Record<string, number> = {
      monthly:    30,
      quarterly:  90,
      semiannual: 180,
      annual:     365,
    }
    const days = DAYS[plan] ?? 30
    const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60_000).toISOString()

    const { error: updateErr } = await supabase
      .from('tenants')
      .update({ trial_ends_at: trialEndsAt })
      .eq('id', tenant_id)

    if (updateErr) {
      console.error('Tenant update error:', updateErr)
      return json({ error: updateErr.message }, 500)
    }

    console.log('Tenant extended:', { tenant_id, plan, trial_ends_at: trialEndsAt })
    return json({ received: true, tenant_id, plan, trial_ends_at: trialEndsAt })

  } catch (error) {
    console.error('mp-webhook error:', error)
    return json({ error: error instanceof Error ? error.message : 'Internal error' }, 500)
  }
})

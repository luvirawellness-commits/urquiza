import { serve } from 'https://deno.land/std@0.220.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimit.ts'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function verifyMpSignature(
  xSignature: string,
  xRequestId: string,
  dataId: string,
  secret: string,
): Promise<boolean> {
  // Parse "ts=TIMESTAMP,v1=SIGNATURE"
  const parts: Record<string, string> = {}
  for (const part of xSignature.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  // Build manifest per MercadoPago spec (data.id lowercased per official docs)
  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`

  // HMAC-SHA256 using Deno built-in crypto.subtle (no external lib)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(manifest))
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return hex === v1
}

serve(async (req: Request) => {
  console.log('=== WEBHOOK HIT ===')
  console.log('Method:', req.method)
  console.log('Headers:', JSON.stringify(Object.fromEntries(req.headers.entries())))

  if (req.method === 'OPTIONS') return json({ ok: true })

  const ip = req.headers.get('x-forwarded-for')
    ?? req.headers.get('cf-connecting-ip')
    ?? 'unknown'

  const rl = await checkRateLimit({
    key: `mp-webhook:${ip}`,
    limit: 200,
    windowSeconds: 60,
  })

  if (!rl.allowed) return rateLimitResponse(rl.resetIn)

  // Which MP account this notification belongs to has to be known before any
  // per-account secret/token lookup — MP's own webhook payload is just
  // { type: 'payment', data: { id } }, no tenant/flow context, and fetching
  // the payment to find out is itself gated behind having the right token.
  // So the discriminator instead lives in the notification_url's own query
  // string, which we control at preference-creation time and MP preserves
  // as configured. create-payment sets ?flow=plan; create-sena-payment (Stage
  // B) sets ?flow=sena&tenant_id=... — tenant_id is how the sena branch below
  // knows which tenant's OAuth-connected account to use.
  const url = new URL(req.url)
  const isPlanFlow = url.searchParams.get('flow') === 'plan'
  const senaTenantIdParam = url.searchParams.get('tenant_id')

  // Each MP application signs its webhook notifications with its own secret —
  // verifying a plan-flow notification against the sena secret (or vice
  // versa) always fails, so this has to branch the same way the token
  // selection below does. Sena payments moved to per-tenant OAuth-connected
  // accounts in Stage B, all created through the "Luvira OS - Connect"
  // application — MP_PLATFORM_WEBHOOK_SECRET is THAT application's own
  // webhook secret (configured in its "Your integrations" > Webhooks panel),
  // not the old MP_WEBHOOK_SECRET, which belonged to whichever personal
  // account the shared pre-Stage-B sena token was issued under. Reusing the
  // old secret here would silently fail signature verification on every sena
  // payment — the exact "wrong secret" bug from Stage A, so no fallback.
  // .trim() defensively — a stray trailing newline/space from pasting a
  // secret into the dashboard is invisible but changes the HMAC key
  // material entirely, and fails signature verification the exact same way
  // a genuinely wrong secret would.
  const webhookSecret = (isPlanFlow
    ? Deno.env.get('MP_SUBSCRIPTIONS_WEBHOOK_SECRET')
    : Deno.env.get('MP_PLATFORM_WEBHOOK_SECRET'))?.trim()
  if (!webhookSecret) {
    console.error(isPlanFlow
      ? 'MP_SUBSCRIPTIONS_WEBHOOK_SECRET not configured — cannot verify webhook signatures'
      : 'MP_PLATFORM_WEBHOOK_SECRET not configured — cannot verify webhook signatures')
    return json({ error: 'Configuration error' }, 500)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Plan/subscription payments still use one shared platform token (Stage A,
  // untouched). Sena payments now use each tenant's own OAuth-connected
  // MercadoPago access token (Stage B) looked up by the tenant_id carried in
  // the notification_url — no shared sena token exists to fall back to.
  let MP_ACCESS_TOKEN: string
  if (isPlanFlow) {
    const token = Deno.env.get('MP_SUBSCRIPTIONS_ACCESS_TOKEN')
    if (!token) {
      console.error('MP_SUBSCRIPTIONS_ACCESS_TOKEN not set')
      return json({ error: 'Configuration error' }, 500)
    }
    MP_ACCESS_TOKEN = token
  } else {
    if (!senaTenantIdParam) {
      // Only expected for a preference created before this migration shipped
      // (old notification_url had no tenant_id) — there's no shared sena
      // token left to fall back to, so this can't be resolved automatically.
      console.error('Sena webhook missing tenant_id in notification_url — cannot resolve MercadoPago account', { url: req.url })
      return json({ error: 'Missing tenant_id in notification_url' }, 400)
    }

    const { data: mpConfig, error: mpConfigErr } = await supabase
      .from('tenant_mp_config')
      .select('access_token')
      .eq('tenant_id', senaTenantIdParam)
      .maybeSingle()

    if (mpConfigErr) {
      console.error('Failed to look up tenant_mp_config:', mpConfigErr)
      return json({ error: 'Failed to resolve tenant MercadoPago account' }, 500)
    }
    // Defends against a tenant disconnecting their MP account between
    // preference creation (already validated there) and this webhook arriving.
    if (!mpConfig?.access_token) {
      console.error('Tenant has no connected MercadoPago account:', { tenant_id: senaTenantIdParam })
      return json({ error: 'Tenant MercadoPago account not connected' }, 400)
    }
    MP_ACCESS_TOKEN = mpConfig.access_token
  }

  try {
    // Read signature headers before consuming body
    const xSignature = req.headers.get('x-signature') ?? ''
    const xRequestId = req.headers.get('x-request-id') ?? ''

    // Read raw body text first, then parse — preserves exact values before any transformation
    const rawBody = await req.text()
    // deno-lint-ignore no-explicit-any
    const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, any>

    // data.id: webhook format sends ?data.id=, IPN sends ?id=, body has data.id
    const dataId = url.searchParams.get('data.id')
      ?? url.searchParams.get('id')
      ?? String(body?.data?.id ?? '')

    console.log('Raw body:', rawBody)
    console.log('URL search params:', Object.fromEntries(url.searchParams.entries()))
    console.log('Computed dataId:', dataId)
    console.log('x-signature header:', xSignature)
    console.log('x-request-id header:', xRequestId)

    // Verify HMAC-SHA256 signature — reject anything that doesn't match
    const valid = await verifyMpSignature(xSignature, xRequestId, dataId, webhookSecret)
    if (!valid) {
      console.error('Webhook signature verification failed', { xSignature, xRequestId, dataId })
      return json({ error: 'Unauthorized' }, 401)
    }

    // Support both webhook format (body) and IPN format (query params)
    const topic = body?.type ?? url.searchParams.get('topic')
    const paymentId = body?.data?.id ?? url.searchParams.get('id')

    if (topic !== 'payment' || !paymentId) {
      return json({ received: true })
    }

    // Fetch payment details from MercadoPago
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

    // Only process approved payments
    if (payment.status !== 'approved') {
      return json({ received: true, status: payment.status })
    }

    // Seña (deposit) payments for online bookings — separate flow from the
    // subscription-plan payments below, so it's handled and returned first.
    // The appointment doesn't exist yet at this point; it's created here,
    // only once the payment is confirmed 'approved'.
    if (payment.metadata?.type === 'sena') {
      const meta = payment.metadata ?? {}
      const {
        tenant_id: senaTenantId, client_id, service_id, service_name,
        therapist_id, scheduled_at, duration_minutes, amount,
      } = meta

      if (!senaTenantId || !client_id || !therapist_id || !scheduled_at || !duration_minutes || !amount) {
        console.error('Missing sena metadata:', meta)
        return json({ error: 'Missing required fields in sena metadata' }, 400)
      }

      // Idempotency: MP can redeliver the same webhook notification. If this
      // payment already produced an appointment, don't create a second one.
      const { data: already } = await supabase
        .from('appointments')
        .select('id')
        .eq('tenant_id', senaTenantId)
        .eq('deposit_payment_id', String(payment.id))
        .maybeSingle()

      if (already) {
        console.log('Sena payment already processed:', { payment_id: payment.id, appointment_id: already.id })
        return json({ received: true, appointment_id: already.id, already_processed: true })
      }

      // The slot was never held before payment, so re-check for a conflict
      // that may have appeared in the meantime (same overlap logic
      // public-booking's create-booking uses). If it's gone, the client has
      // already paid and this needs manual reconciliation — there's no slot
      // left to attach the payment to.
      const durMin = Number(duration_minutes)
      const slotStartMs = new Date(scheduled_at).getTime()
      const slotEndMs = slotStartMs + durMin * 60_000
      const lookbackMs = 4 * 60 * 60_000

      const { data: nearby, error: conflictErr } = await supabase
        .from('appointments')
        .select('id, scheduled_at, duration_minutes')
        .eq('tenant_id', senaTenantId)
        .eq('therapist_id', therapist_id)
        .gte('scheduled_at', new Date(slotStartMs - lookbackMs).toISOString())
        .lt('scheduled_at', new Date(slotEndMs).toISOString())
        .not('status', 'in', '(cancelled,no_show,blocked)')

      if (conflictErr) {
        console.error('Conflict check error:', conflictErr)
        return json({ error: conflictErr.message }, 500)
      }

      const hasConflict = (nearby ?? []).some((a) => {
        const aStart = new Date(a.scheduled_at as string).getTime()
        const aEnd = aStart + ((a.duration_minutes as number) ?? 60) * 60_000
        return slotStartMs < aEnd && slotEndMs > aStart
      })

      if (hasConflict) {
        console.error('SENA PAID BUT SLOT NO LONGER AVAILABLE — needs manual reconciliation:', {
          payment_id: payment.id, tenant_id: senaTenantId, client_id, therapist_id, scheduled_at,
        })
        return json({ error: 'Slot no longer available — payment succeeded, needs manual reconciliation', payment_id: payment.id }, 409)
      }

      const { data: appointment, error: apptErr } = await supabase
        .from('appointments')
        .insert({
          tenant_id: senaTenantId,
          client_id,
          therapist_id,
          service_id: service_id ?? null,
          scheduled_at,
          duration_minutes: durMin,
          status: 'pending',
          deposit_paid: true,
          deposit_amount: amount,
          deposit_payment_id: String(payment.id),
          source: 'web',
          box_number: 0,
        })
        .select('id')
        .single()

      if (apptErr || !appointment) {
        console.error('Appointment insert error:', apptErr)
        return json({ error: apptErr?.message ?? 'Failed to create appointment' }, 500)
      }

      const { error: txErr } = await supabase.from('transactions').insert({
        tenant_id: senaTenantId,
        type: 'income',
        category: 'deposit',
        amount,
        payment_method: 'transfer',
        date: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }),
        appointment_id: appointment.id,
        description: `Seña online: ${service_name ?? 'Servicio'}`,
        status: 'paid',
        client_id,
        user_id: therapist_id,
      })

      if (txErr) {
        console.error('Transaction insert error:', txErr)
        return json({ error: txErr.message }, 500)
      }

      console.log('Sena confirmed, appointment created:', { appointment_id: appointment.id, tenant_id: senaTenantId })
      return json({ received: true, appointment_id: appointment.id, deposit_paid: true })
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
      .update({ trial_ends_at: trialEndsAt, last_plan: plan })
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

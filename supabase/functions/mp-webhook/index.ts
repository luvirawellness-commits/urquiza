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

  const webhookSecret = Deno.env.get('MP_WEBHOOK_SECRET')
  if (!webhookSecret) {
    console.error('MP_WEBHOOK_SECRET not configured — cannot verify webhook signatures')
    return json({ error: 'Configuration error' }, 500)
  }

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

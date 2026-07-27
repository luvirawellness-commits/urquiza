import { serve } from 'https://deno.land/std@0.220.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshMpToken } from '../_shared/mpTokenRefresh.ts'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Public endpoint (verify_jwt = false, meant to be called by Supabase Cron —
  // same reasoning as whatsapp-reminders). Unlike whatsapp-reminders, this one
  // makes MercadoPago API calls against every connected tenant's account, so
  // a shared secret in a custom header keeps random internet requests from
  // triggering it.
  const cronSecret = Deno.env.get('MP_CRON_SECRET')
  if (!cronSecret) {
    console.error('MP_CRON_SECRET not configured — refusing to run')
    return json({ error: 'Configuration error' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  // Wider margin than create-sena-payment's refresh-on-use (15 days) — this
  // job is the backstop for tenants with no recent bookings to trigger that
  // inline path, so it needs to catch a token before it's cut things too close.
  const REFRESH_WINDOW_MS = 20 * 24 * 60 * 60_000
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_MS).toISOString()

  const { data: dueConfigs, error: queryErr } = await supabase
    .from('tenant_mp_config')
    .select('tenant_id')
    .not('refresh_token', 'is', null)
    .lte('token_expires_at', cutoff)

  if (queryErr) {
    console.error('mp-token-refresh-cron: failed to query tenant_mp_config:', queryErr)
    return json({ error: queryErr.message }, 500)
  }

  const targets = dueConfigs ?? []
  let succeeded = 0
  let failed = 0
  const failures: { tenant_id: string; error?: string }[] = []

  // Sequential, not parallel — no need to hammer MP's token endpoint, and one
  // tenant's failure must never stop the rest from being processed.
  for (const { tenant_id } of targets) {
    const result = await refreshMpToken(tenant_id)
    if (result.success) {
      succeeded++
    } else {
      failed++
      failures.push({ tenant_id, error: result.error })
    }
  }

  console.log('mp-token-refresh-cron summary:', { checked: targets.length, succeeded, failed, failures })

  return json({ checked: targets.length, succeeded, failed, failures })
})

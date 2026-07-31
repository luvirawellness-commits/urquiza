import { serve } from 'https://deno.land/std@0.220.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
  // same reasoning as mp-token-refresh-cron). generate_settlement_expenses()
  // is unscoped by tenant and writes real expense transactions across every
  // tenant, so a dedicated shared secret keeps random internet requests from
  // triggering it.
  const cronSecret = Deno.env.get('SETTLEMENT_CRON_SECRET')
  if (!cronSecret) {
    console.error('SETTLEMENT_CRON_SECRET not configured — refusing to run')
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

  // The RPC itself is idempotent (settlement_expenses_generated_at guard +
  // row locking — see 20260805000000_settlement_expenses.sql), so a retried
  // or overlapping cron invocation can never double-generate.
  const { data, error } = await supabase.rpc('generate_settlement_expenses')

  if (error) {
    console.error('settlement-expenses-cron: generate_settlement_expenses failed:', error)
    return json({ error: error.message }, 500)
  }

  console.log('settlement-expenses-cron summary:', data)

  return json(data)
})

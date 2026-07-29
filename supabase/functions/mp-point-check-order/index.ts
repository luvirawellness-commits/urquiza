import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { refreshMpToken } from '../_shared/mpTokenRefresh.ts'

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

// Mirrors src/lib/permissions.ts's static ROLE_PERMISSIONS caja row — see
// mp-point-create-order for the same constant and why it's duplicated here.
const CAJA_ROLES = ['owner', 'partner_admin', 'receptionist']

const REFRESH_MARGIN_MS = 15 * 24 * 60 * 60_000

// point_charges.status only ever holds one of 'created', 'processed',
// 'failed', 'canceled', 'expired' (see 20260802000000_point_charges.sql) —
// MP's own richer state machine (created → at_terminal → processed, or one
// of the terminal outcomes) collapses "created" and "at_terminal" into our
// single 'created' bucket. This matters beyond naming: the partial unique
// index that prevents a duplicate charge only protects appointments whose
// point_charges row is still status='created' — if a poll moved the row to
// some MP-specific intermediate status instead, an order sitting at
// "at_terminal" (customer hasn't tapped their card yet) would stop being
// covered by that guard and a second charge could be started underneath it.
const TERMINAL_STATUS_MAP: Record<string, string> = {
  processed: 'processed',
  failed: 'failed',
  canceled: 'canceled',
  expired: 'expired',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('Método no permitido', 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json() as Record<string, any>
    const { tenant_id, user_id, access_token, order_id } = body

    // Logged before any validation/auth — every invocation of this function
    // produces at least this line, regardless of what happens after. Without
    // it, a request that fails auth or validation left zero application-level
    // trace, indistinguishable from the function never being called at all.
    console.log('mp-point-check-order: request received', { tenant_id, user_id, order_id })

    if (!tenant_id || !user_id || !access_token || !order_id) {
      console.error('mp-point-check-order: missing required fields', { tenant_id, user_id, order_id, has_access_token: !!access_token })
      return err('tenant_id, user_id, access_token y order_id son requeridos')
    }

    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser || authUser.id !== user_id) {
      console.error('mp-point-check-order: auth failed', { user_id, authErr: authErr?.message, matchedUser: authUser?.id })
      return err('No autorizado', 401)
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle()

    if (!userRow || !CAJA_ROLES.includes(userRow.role as string)) {
      console.error('mp-point-check-order: caja permission denied', { user_id, role: userRow?.role })
      return err('No tenés permiso de caja para consultar cobros con Point', 403)
    }

    const { data: mpConfig, error: mpConfigErr } = await supabase
      .from('tenant_mp_config')
      .select('access_token, token_expires_at')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (mpConfigErr) throw mpConfigErr
    if (!mpConfig?.access_token) {
      console.error('mp-point-check-order: tenant has no connected MercadoPago account', { tenant_id })
      return err('Este local todavía no conectó su cuenta de MercadoPago', 400)
    }

    let mpAccessToken = mpConfig.access_token
    const expiresAtMs = mpConfig.token_expires_at ? new Date(mpConfig.token_expires_at).getTime() : null
    if (expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_MARGIN_MS) {
      const refreshResult = await refreshMpToken(tenant_id)
      if (refreshResult.success && refreshResult.access_token) {
        mpAccessToken = refreshResult.access_token
      } else {
        console.warn('mp-point-check-order: token refresh-on-use failed, proceeding with existing token:', {
          tenant_id, error: refreshResult.error,
        })
      }
    }

    // Logged unconditionally, before the call — if the fetch itself hangs,
    // times out, or throws, this line is still what tells us a poll for this
    // order_id was actually attempted at all.
    console.log('mp-point-check-order: polling MP', { tenant_id, order_id })

    const orderRes = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(order_id)}`, {
      headers: { 'Authorization': `Bearer ${mpAccessToken}` },
    })

    const orderBody = await orderRes.json().catch(() => null) as Record<string, unknown> | null

    // Logged unconditionally on every poll (not just failures) — this was
    // the actual gap: previously only error/warning paths were logged, so a
    // stuck-but-200-OK order (e.g. status never leaving "created") produced
    // no trace at all to diagnose from.
    console.log('mp-point-check-order: MP response', {
      tenant_id,
      order_id,
      http_status: orderRes.status,
      body: orderBody,
    })

    if (!orderRes.ok) {
      console.error('mp-point-check-order: MP get order failed:', orderRes.status, orderBody)
      return err((orderBody?.message as string) ?? 'MercadoPago no pudo consultar el estado del cobro', 502)
    }

    const mpStatus = String(orderBody?.status ?? '')
    const pointChargeStatus = TERMINAL_STATUS_MAP[mpStatus] ?? 'created'

    // point_charges is the durable source of truth (see Part 1 of this
    // fix) — every poll writes the real current status into it, not just
    // whatever this one response happens to say, so a later poll (or a
    // resumed session after the modal was closed and reopened) always finds
    // an up-to-date row instead of a stale 'created' one.
    const { error: updateErr } = await supabase
      .from('point_charges')
      .update({ status: pointChargeStatus, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenant_id)
      .eq('mp_order_id', order_id)

    if (updateErr) {
      // Don't fail the whole poll over this — the frontend still needs the
      // real MP status to update its own UI even if the durable copy
      // couldn't be written this one time; the next successful poll will
      // catch the row up.
      console.error('mp-point-check-order: failed to update point_charges row', updateErr, { tenant_id, order_id })
    }

    return json({
      order_id: orderBody?.id,
      status: orderBody?.status,
      status_detail: orderBody?.status_detail,
      transactions: orderBody?.transactions,
    })

  } catch (error) {
    console.error('mp-point-check-order error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

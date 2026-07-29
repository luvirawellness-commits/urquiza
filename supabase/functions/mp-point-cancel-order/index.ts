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

    if (!tenant_id || !user_id || !access_token || !order_id) {
      return err('tenant_id, user_id, access_token y order_id son requeridos')
    }

    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser || authUser.id !== user_id) {
      return err('No autorizado', 401)
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle()

    if (!userRow || !CAJA_ROLES.includes(userRow.role as string)) {
      return err('No tenés permiso de caja para cancelar cobros con Point', 403)
    }

    const { data: mpConfig, error: mpConfigErr } = await supabase
      .from('tenant_mp_config')
      .select('access_token, token_expires_at')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (mpConfigErr) throw mpConfigErr
    if (!mpConfig?.access_token) {
      return err('Este local todavía no conectó su cuenta de MercadoPago', 400)
    }

    let mpAccessToken = mpConfig.access_token
    const expiresAtMs = mpConfig.token_expires_at ? new Date(mpConfig.token_expires_at).getTime() : null
    if (expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_MARGIN_MS) {
      const refreshResult = await refreshMpToken(tenant_id)
      if (refreshResult.success && refreshResult.access_token) {
        mpAccessToken = refreshResult.access_token
      } else {
        console.warn('mp-point-cancel-order: token refresh-on-use failed, proceeding with existing token:', {
          tenant_id, error: refreshResult.error,
        })
      }
    }

    // MP only allows canceling an order while it's still status "created"
    // (i.e. before the terminal has taken/started processing the card). Once
    // it's past that (e.g. "at_terminal" or later) this call fails with 409 —
    // that's expected and not a server error, the frontend just falls back
    // to stopping polling and letting expiration_time run out.
    const cancelRes = await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(order_id)}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
    })

    const cancelBody = await cancelRes.json().catch(() => null) as Record<string, unknown> | null

    if (!cancelRes.ok) {
      console.warn('mp-point-cancel-order: MP cancel failed (may be past the cancelable window):', cancelRes.status, cancelBody)
      return err(
        (cancelBody?.message as string) ?? 'No se pudo cancelar el cobro — puede que ya esté en curso en el lector.',
        cancelRes.status === 409 ? 409 : 502,
      )
    }

    return json({ order_id: cancelBody?.id, status: cancelBody?.status })

  } catch (error) {
    console.error('mp-point-cancel-order error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

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

// Mirrors src/lib/permissions.ts's static ROLE_PERMISSIONS: caja access is
// 'full' for owner/partner_admin/receptionist and 'none' for therapist.
// There's no shared module between the frontend and Deno functions, so this
// list is kept in sync by hand — it changes exactly as often as that file's
// caja row does, which is rare.
const CAJA_ROLES = ['owner', 'partner_admin', 'receptionist']

// Same margin/best-effort refresh-on-use policy as the rest of the MP
// integration (create-sena-payment, mp-point-list-devices/register-device).
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
    const {
      tenant_id, user_id, access_token,
      amount, description, external_reference, terminal_id,
    } = body

    if (!tenant_id || !user_id || !access_token || !amount || !terminal_id) {
      return err('tenant_id, user_id, access_token, amount y terminal_id son requeridos')
    }
    const amountNum = Number(amount)
    if (!(amountNum > 0)) return err('amount debe ser mayor a 0')

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
      return err('No tenés permiso de caja para cobrar con Point', 403)
    }

    // The device must be one this tenant actually registered and left active —
    // never trust a terminal_id handed in raw by the client, it could target
    // any terminal reachable by this tenant's MP account otherwise.
    const { data: device, error: deviceErr } = await supabase
      .from('tenant_point_devices')
      .select('terminal_id')
      .eq('tenant_id', tenant_id)
      .eq('terminal_id', terminal_id)
      .eq('is_active', true)
      .maybeSingle()

    if (deviceErr) throw deviceErr
    if (!device) return err('El lector Point indicado no está registrado o no está activo para este local', 404)

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
        console.warn('mp-point-create-order: token refresh-on-use failed, proceeding with existing token:', {
          tenant_id, error: refreshResult.error,
        })
      }
    }

    const orderRes = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mpAccessToken}`,
        'Content-Type': 'application/json',
        // Required by MP to make retries of this exact request safe — a
        // fresh key per call is correct here since each call is a genuinely
        // new charge attempt, never an automatic retry of a prior one.
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        type: 'point',
        external_reference: external_reference ?? undefined,
        expiration_time: 'PT16M',
        transactions: { payments: [{ amount: amountNum.toFixed(2) }] },
        config: { point: { terminal_id, print_on_terminal: 'no_ticket' } },
        description: description ?? undefined,
      }),
    })

    const orderBody = await orderRes.json().catch(() => null) as Record<string, unknown> | null

    if (!orderRes.ok) {
      console.error('mp-point-create-order: MP order creation failed:', orderRes.status, orderBody)
      return err(
        (orderBody?.message as string) ?? 'MercadoPago no pudo crear el cobro. Verificá el lector e intentá de nuevo.',
        502,
      )
    }

    console.log('mp-point-create-order: order created:', { tenant_id, terminal_id, order_id: orderBody?.id })

    return json({
      order_id: orderBody?.id,
      status: orderBody?.status,
      status_detail: orderBody?.status_detail,
    })

  } catch (error) {
    console.error('mp-point-create-order error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

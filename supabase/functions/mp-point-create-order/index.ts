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

// Used only for the true-race cleanup path below (see the point_charges
// insert): the order was just created seconds ago and is still status
// "created", so it's within MP's cancelable window — but this is
// best-effort, not load-bearing. If it fails, the order is simply left to
// expire on its own via expiration_time; either way point_charges never
// records it as this tenant's active charge, so it can't cause a duplicate.
async function cancelMpOrderBestEffort(accessToken: string, orderId: string): Promise<void> {
  try {
    await fetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
    })
  } catch (e) {
    console.warn('mp-point-create-order: best-effort cancel of orphaned order failed', { orderId, error: e })
  }
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
    const {
      tenant_id, user_id, access_token,
      amount, description, external_reference, terminal_id,
      appointment_id, payment_method,
    } = body

    // Logged before any validation/auth — every invocation produces at least
    // this line, so a request that fails early still leaves a trace.
    console.log('mp-point-create-order: request received', { tenant_id, user_id, amount, terminal_id, external_reference, appointment_id, payment_method })

    if (!tenant_id || !user_id || !access_token || !amount || !terminal_id || !appointment_id || !payment_method) {
      console.error('mp-point-create-order: missing required fields', {
        tenant_id, user_id, amount, terminal_id, appointment_id, payment_method, has_access_token: !!access_token,
      })
      // appointment_id/payment_method are mandatory here specifically because
      // this function's only caller (Agenda.tsx's session checkout) always
      // has both, and appointment_id is what the duplicate-charge guard below
      // keys off of — a future non-appointment Point flow would need its own
      // dedup key, not a relaxation of this check.
      return err('tenant_id, user_id, access_token, amount, terminal_id, appointment_id y payment_method son requeridos')
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
    if (!device) {
      console.error('mp-point-create-order: terminal not registered/active for tenant', { tenant_id, terminal_id })
      return err('El lector Point indicado no está registrado o no está activo para este local', 404)
    }

    // Duplicate-charge guard, step 1 of 2: the frontend is expected to have
    // already checked for and resumed any pending charge before ever calling
    // this function, so hitting one here means a race (e.g. two staff
    // opening the same session at once) — reject before ever touching MP,
    // which is strictly better than creating an order we'd have to unwind.
    // The insert below (step 2, the point_charges_one_active_per_appointment
    // unique index) is what catches the case where two requests both pass
    // this check at the same instant.
    const { data: existingCharge, error: existingChargeErr } = await supabase
      .from('point_charges')
      .select('mp_order_id')
      .eq('tenant_id', tenant_id)
      .eq('appointment_id', appointment_id)
      .eq('status', 'created')
      .maybeSingle()

    if (existingChargeErr) throw existingChargeErr
    if (existingCharge) {
      console.error('mp-point-create-order: an active charge already exists for this appointment', {
        tenant_id, appointment_id, existing_order_id: existingCharge.mp_order_id,
      })
      return err('Ya hay un cobro con Point en curso para esta sesión.', 409)
    }

    const { data: mpConfig, error: mpConfigErr } = await supabase
      .from('tenant_mp_config')
      .select('access_token, token_expires_at')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (mpConfigErr) throw mpConfigErr
    if (!mpConfig?.access_token) {
      console.error('mp-point-create-order: tenant has no connected MercadoPago account', { tenant_id })
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

    // Full response logged unconditionally — the initial status/status_detail
    // MP hands back here is the first signal of whether the order actually
    // reached the terminal (e.g. "at_terminal") vs. sat at "created", which
    // check-order's polling logs alone can't distinguish retroactively.
    console.log('mp-point-create-order: MP response', {
      tenant_id,
      terminal_id,
      http_status: orderRes.status,
      body: orderBody,
    })

    if (!orderRes.ok) {
      console.error('mp-point-create-order: MP order creation failed:', orderRes.status, orderBody)
      return err(
        (orderBody?.message as string) ?? 'MercadoPago no pudo crear el cobro. Verificá el lector e intentá de nuevo.',
        502,
      )
    }

    const mpOrderId = String(orderBody?.id ?? '')

    // Duplicate-charge guard, step 2 of 2: this is the row that makes the
    // charge durable server-side (see 20260802000000_point_charges.sql) —
    // without it, the order_id existed only in the frontend's local state,
    // and any way the modal closed (crash, navigation, X button) lost track
    // of it forever, even though the money could still land on MP's side.
    const { error: insertErr } = await supabase
      .from('point_charges')
      .insert({
        tenant_id,
        appointment_id,
        terminal_id,
        mp_order_id: mpOrderId,
        amount: amountNum,
        payment_method,
        status: 'created',
        created_by: user_id,
      })

    if (insertErr) {
      // 23505 = unique_violation. This is the true-race case: two requests
      // both passed the pre-check above before either had inserted. The MP
      // order already exists at this point — cancel it best-effort so it
      // doesn't sit there as a second, untracked charge attempt, and report
      // the failure instead of handing back an order_id nothing will track.
      if (insertErr.code === '23505') {
        console.error('mp-point-create-order: race detected — another charge was already inserted for this appointment, canceling the order just created', {
          tenant_id, appointment_id, mp_order_id: mpOrderId,
        })
        await cancelMpOrderBestEffort(mpAccessToken, mpOrderId)
        return err('Ya hay un cobro con Point en curso para esta sesión.', 409)
      }
      throw insertErr
    }

    console.log('mp-point-create-order: point_charges row saved', { tenant_id, appointment_id, mp_order_id: mpOrderId })

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

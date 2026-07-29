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

// Proactively renew a token nearing its 180-day expiry, same margin/best-effort
// policy as create-sena-payment — mp-token-refresh-cron is the daily backstop
// for tenants that never hit a token-using endpoint on their own.
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
    const { tenant_id, user_id, access_token } = body

    if (!tenant_id || !user_id || !access_token) {
      return err('tenant_id, user_id y access_token son requeridos')
    }

    // Defense-in-depth on top of the platform's own JWT verification for this
    // function — same pattern as mp-oauth-authorize.
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser || authUser.id !== user_id) {
      return err('No autorizado', 401)
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle()

    if (!userRow || !['owner', 'super_admin'].includes(userRow.role as string)) {
      return err('Solo los propietarios pueden administrar los lectores Point', 403)
    }

    const { data: mpConfig, error: mpConfigErr } = await supabase
      .from('tenant_mp_config')
      .select('access_token, token_expires_at')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (mpConfigErr) throw mpConfigErr

    if (!mpConfig?.access_token) {
      return err('Este local todavía no conectó su cuenta de MercadoPago. Conectala primero en "Cuenta de MercadoPago".', 400)
    }

    let mpAccessToken = mpConfig.access_token
    const expiresAtMs = mpConfig.token_expires_at ? new Date(mpConfig.token_expires_at).getTime() : null
    if (expiresAtMs !== null && expiresAtMs - Date.now() <= REFRESH_MARGIN_MS) {
      const refreshResult = await refreshMpToken(tenant_id)
      if (refreshResult.success && refreshResult.access_token) {
        mpAccessToken = refreshResult.access_token
      } else {
        console.warn('mp-point-list-devices: token refresh-on-use failed, proceeding with existing token:', {
          tenant_id, error: refreshResult.error,
        })
      }
    }

    const mpRes = await fetch('https://api.mercadopago.com/terminals/v1/list?limit=50', {
      headers: { 'Authorization': `Bearer ${mpAccessToken}` },
    })

    if (!mpRes.ok) {
      const mpErrBody = await mpRes.text()
      console.error('mp-point-list-devices: MP terminals list failed:', mpRes.status, mpErrBody)
      return err('MercadoPago no pudo listar los dispositivos. Verificá la conexión e intentá de nuevo.', 502)
    }

    // deno-lint-ignore no-explicit-any
    const mpBody = await mpRes.json() as Record<string, any>
    const terminals = (mpBody?.data?.terminals ?? []) as Array<{
      id: string
      store_id?: string
      pos_id?: number
      external_pos_id?: string
      operating_mode?: string
    }>

    return json({ terminals })

  } catch (error) {
    console.error('mp-point-list-devices error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

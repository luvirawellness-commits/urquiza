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

// Same margin/best-effort refresh-on-use policy as create-sena-payment and
// mp-point-list-devices.
const REFRESH_MARGIN_MS = 15 * 24 * 60 * 60_000

type MpTerminal = {
  id: string
  store_id?: string
  pos_id?: number
  operating_mode?: string
}

async function fetchTerminal(accessToken: string, terminalId: string): Promise<MpTerminal | null> {
  const res = await fetch('https://api.mercadopago.com/terminals/v1/list?limit=50', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  // deno-lint-ignore no-explicit-any
  const body = await res.json() as Record<string, any>
  const terminals = (body?.data?.terminals ?? []) as MpTerminal[]
  return terminals.find((t) => t.id === terminalId) ?? null
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
      terminal_id, label, store_id, pos_id, operating_mode,
    } = body

    if (!tenant_id || !user_id || !access_token || !terminal_id) {
      return err('tenant_id, user_id, access_token y terminal_id son requeridos')
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
        console.warn('mp-point-register-device: token refresh-on-use failed, proceeding with existing token:', {
          tenant_id, error: refreshResult.error,
        })
      }
    }

    let finalOperatingMode = operating_mode as string | undefined
    let finalStoreId = store_id as string | undefined
    let finalPosId = pos_id as number | undefined

    if (finalOperatingMode !== 'PDV') {
      // PDV requires the terminal already associated with a store_id/pos_id —
      // that association only happens by pairing the device through the
      // MercadoPago Point mobile app, not through this API. A terminal that
      // just came out of the box (operating_mode: UNDEFINED, no store/pos)
      // can't be switched here — surface that clearly instead of a raw MP error.
      if (!finalStoreId || finalPosId === undefined || finalPosId === null) {
        return err(
          'Este lector todavía no está vinculado a una sucursal/caja en MercadoPago. ' +
          'Emparejalo primero desde la app MercadoPago Point en el celular del local, y volvé a buscar los dispositivos.',
          409,
        )
      }

      const setupRes = await fetch('https://api.mercadopago.com/terminals/v1/setup', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${mpAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ terminals: [{ id: terminal_id, operating_mode: 'PDV' }] }),
      })

      if (!setupRes.ok) {
        const setupErrBody = await setupRes.text()
        console.error('mp-point-register-device: PDV setup failed:', setupRes.status, setupErrBody)
        return err('MercadoPago rechazó el cambio a modo PDV para este lector. Verificá que esté emparejado con una sucursal/caja e intentá de nuevo.', 502)
      }

      // Don't trust the PATCH response alone — re-fetch the terminal and
      // confirm operating_mode actually landed on PDV before saving it as such.
      const verified = await fetchTerminal(mpAccessToken, terminal_id)
      if (!verified || verified.operating_mode !== 'PDV') {
        console.error('mp-point-register-device: PDV switch did not verify:', { terminal_id, verified })
        return err('MercadoPago confirmó el cambio pero no se pudo verificar el modo PDV. Volvé a buscar los dispositivos e intentá de nuevo.', 502)
      }

      finalOperatingMode = verified.operating_mode
      finalStoreId = verified.store_id ?? finalStoreId
      finalPosId = verified.pos_id ?? finalPosId
    }

    const { data: saved, error: upsertErr } = await supabase
      .from('tenant_point_devices')
      .upsert({
        tenant_id,
        terminal_id,
        label: label || null,
        store_id: finalStoreId ?? null,
        pos_id: finalPosId ?? null,
        operating_mode: finalOperatingMode ?? null,
        is_active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id,terminal_id' })
      .select()
      .single()

    if (upsertErr) throw upsertErr

    return json({ device: saved })

  } catch (error) {
    console.error('mp-point-register-device error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

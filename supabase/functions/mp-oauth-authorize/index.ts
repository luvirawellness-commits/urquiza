import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

function base64url(bytes: Uint8Array): string {
  let str = ''
  for (const b of bytes) str += String.fromCharCode(b)
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  return base64url(bytes)
}

async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return base64url(new Uint8Array(digest))
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
    const { tenant_id, user_id, access_token } = body

    if (!tenant_id || !user_id || !access_token) {
      return err('tenant_id, user_id y access_token son requeridos')
    }

    // Verify access_token belongs to user_id — same defense-in-depth check
    // add-branch uses on top of the platform's own JWT verification for this function.
    const { data: { user: authUser }, error: authErr } = await supabase.auth.getUser(access_token)
    if (authErr || !authUser || authUser.id !== user_id) {
      return err('No autorizado', 401)
    }

    // Only the tenant's owner can connect its MercadoPago account — this mirrors
    // the "Reservas Online" admin tab the connect button lives in, which is
    // itself owner-only (super_admin included, same as everywhere else in the app).
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', user_id)
      .maybeSingle()

    if (!userRow || !['owner', 'super_admin'].includes(userRow.role as string)) {
      return err('Solo los propietarios pueden conectar MercadoPago', 403)
    }

    const { data: tenant, error: tenantErr } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenant_id)
      .single()
    if (tenantErr || !tenant) return err('Tenant no encontrado', 404)

    const MP_PLATFORM_CLIENT_ID = Deno.env.get('MP_PLATFORM_CLIENT_ID')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    if (!MP_PLATFORM_CLIENT_ID || !SUPABASE_URL) {
      console.error('MP_PLATFORM_CLIENT_ID or SUPABASE_URL not configured')
      return err('Configuración de MercadoPago Connect incompleta', 500)
    }

    // PKCE (RFC 7636): verifier is a high-entropy random string, challenge is its
    // SHA-256 digest — MP verifies the pairing at token-exchange time in the callback.
    const codeVerifier = randomBase64url(64)
    const codeChallenge = await sha256Base64url(codeVerifier)
    const state = randomBase64url(32)

    // The authorization code MP redirects back with is only valid 10 minutes, but
    // the tenant's owner may sit on the MP consent screen for a while first — 15
    // minutes here is slack for that, not for the code itself.
    const oauthStateExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString()

    // Upsert only touches the OAuth-handshake columns — access_token/refresh_token
    // from a previous connection (if any) are left untouched until the callback
    // actually completes a new exchange.
    const { error: upsertErr } = await supabase
      .from('tenant_mp_config')
      .upsert({
        tenant_id,
        oauth_state: state,
        code_verifier: codeVerifier,
        oauth_state_expires_at: oauthStateExpiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' })

    if (upsertErr) throw upsertErr

    // Fixed, pre-registered redirect target — tenant identity travels via `state`
    // instead, since redirect_uri itself can't vary per tenant.
    const redirectUri = `${SUPABASE_URL}/functions/v1/mp-oauth-callback`

    const authUrl = new URL('https://auth.mercadopago.com/authorization')
    authUrl.searchParams.set('client_id', MP_PLATFORM_CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('platform_id', 'mp')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    // Required for the refresh_token grant to be usable at all (Stage B.3) —
    // per MP's OAuth renewal docs, refresh only works "if the application
    // return[s] the scope parameter indicating the value offline_access".
    // Without this, MP may still issue a refresh_token but reject it at
    // renewal time, silently defeating the whole refresh mechanism.
    authUrl.searchParams.set('scope', 'offline_access')

    return json({ url: authUrl.toString() })

  } catch (error) {
    console.error('mp-oauth-authorize error:', error)
    return err(error instanceof Error ? error.message : 'Error interno del servidor', 500)
  }
})

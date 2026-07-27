import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    })
  }

  const url = new URL(req.url)

  // ADMIN_APP_URL: the deployed admin dashboard's own origin (distinct from
  // BOOKING_URL, which is the public booking site) — must be set explicitly,
  // there's no safe default to guess for a redirect target.
  const ADMIN_APP_URL = Deno.env.get('ADMIN_APP_URL')
  if (!ADMIN_APP_URL) {
    console.error('ADMIN_APP_URL not configured — cannot redirect back to the admin UI')
    return new Response('Configuration error: ADMIN_APP_URL not set', { status: 500 })
  }
  const returnBase = `${ADMIN_APP_URL}/configuracion-admin?tab=reservas`

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const mpError = url.searchParams.get('error')

    if (mpError) {
      console.error('MP OAuth returned an error:', mpError)
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=${encodeURIComponent(mpError)}`)
    }
    if (!code || !state) {
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=missing_params`)
    }

    // Recover which tenant this belongs to via the state stashed at authorize
    // time — the fixed redirect_uri has no room for tenant identity itself.
    // This same lookup also acts as CSRF protection: a state an attacker didn't
    // receive from mp-oauth-authorize won't match any row.
    const { data: config, error: configErr } = await supabase
      .from('tenant_mp_config')
      .select('tenant_id, code_verifier, oauth_state_expires_at')
      .eq('oauth_state', state)
      .maybeSingle()

    if (configErr || !config) {
      console.error('MP OAuth callback: no matching state found', { state })
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=invalid_state`)
    }
    if (!config.oauth_state_expires_at || new Date(config.oauth_state_expires_at) < new Date()) {
      console.error('MP OAuth callback: state expired', { tenant_id: config.tenant_id })
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=expired_state`)
    }

    const MP_PLATFORM_CLIENT_ID = Deno.env.get('MP_PLATFORM_CLIENT_ID')
    const MP_PLATFORM_CLIENT_SECRET = Deno.env.get('MP_PLATFORM_CLIENT_SECRET')
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
    if (!MP_PLATFORM_CLIENT_ID || !MP_PLATFORM_CLIENT_SECRET || !SUPABASE_URL) {
      console.error('MP_PLATFORM_CLIENT_ID/SECRET or SUPABASE_URL not configured')
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=server_misconfigured`)
    }

    // Must match exactly the redirect_uri sent in the authorize step.
    const redirectUri = `${SUPABASE_URL}/functions/v1/mp-oauth-callback`

    const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: MP_PLATFORM_CLIENT_ID,
        client_secret: MP_PLATFORM_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: config.code_verifier,
      }),
    })

    if (!tokenRes.ok) {
      const tokenErrBody = await tokenRes.text()
      console.error('MP token exchange failed:', tokenErrBody)
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=token_exchange_failed`)
    }

    const tokenData = await tokenRes.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
      user_id: number | string
      public_key?: string
    }

    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    const { error: updateErr } = await supabase
      .from('tenant_mp_config')
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: tokenExpiresAt,
        mp_user_id: String(tokenData.user_id),
        public_key: tokenData.public_key ?? null,
        // Clear PKCE/CSRF state now that the round trip is done — it's single-use.
        oauth_state: null,
        code_verifier: null,
        oauth_state_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', config.tenant_id)

    if (updateErr) {
      console.error('Failed to store MP tokens:', updateErr)
      return redirectTo(`${returnBase}&mp_connected=false&mp_error=storage_failed`)
    }

    console.log('MP OAuth connected:', { tenant_id: config.tenant_id, mp_user_id: tokenData.user_id })
    return redirectTo(`${returnBase}&mp_connected=true`)

  } catch (error) {
    console.error('mp-oauth-callback error:', error)
    return redirectTo(`${returnBase}&mp_connected=false&mp_error=internal_error`)
  }
})

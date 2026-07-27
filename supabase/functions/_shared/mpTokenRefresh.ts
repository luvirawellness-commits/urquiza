import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export interface RefreshMpTokenResult {
  success: boolean
  access_token?: string
  error?: string
}

// MercadoPago rotates the refresh_token on every use (per its OAuth renewal
// docs: "every time you refresh the access_token, the refresh_token will
// also be refreshed, so you will need to store it again") — the previous
// refresh_token is invalidated the moment a new one is issued, so it must
// be overwritten, never reused.
//
// Requesting scope=offline_access at authorization time (mp-oauth-authorize)
// is what makes this grant usable at all — a connection made without that
// scope may have no working refresh_token, and this will fail for it.
export async function refreshMpToken(tenantId: string): Promise<RefreshMpTokenResult> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const MP_PLATFORM_CLIENT_ID = Deno.env.get('MP_PLATFORM_CLIENT_ID')
  const MP_PLATFORM_CLIENT_SECRET = Deno.env.get('MP_PLATFORM_CLIENT_SECRET')
  if (!MP_PLATFORM_CLIENT_ID || !MP_PLATFORM_CLIENT_SECRET) {
    console.error('refreshMpToken: MP_PLATFORM_CLIENT_ID/SECRET not configured', { tenant_id: tenantId })
    return { success: false, error: 'MP_PLATFORM_CLIENT_ID/SECRET not configured' }
  }

  const { data: config, error: configErr } = await supabase
    .from('tenant_mp_config')
    .select('refresh_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (configErr) {
    console.error('refreshMpToken: failed to read tenant_mp_config:', configErr, { tenant_id: tenantId })
    return { success: false, error: configErr.message }
  }
  if (!config?.refresh_token) {
    console.error('refreshMpToken: no refresh_token stored for tenant', { tenant_id: tenantId })
    return { success: false, error: 'No refresh_token stored for this tenant' }
  }

  const tokenRes = await fetch('https://api.mercadopago.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: MP_PLATFORM_CLIENT_ID,
      client_secret: MP_PLATFORM_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: config.refresh_token,
    }),
  })

  if (!tokenRes.ok) {
    const tokenErrBody = await tokenRes.text()
    // Do NOT clear the existing access_token/refresh_token here — a failed
    // refresh attempt (network blip, MP outage, rate limit) shouldn't destroy
    // a still-potentially-valid token and make a connected account look
    // disconnected when it might not need to be yet.
    console.error('refreshMpToken: MP refresh call failed:', tokenErrBody, { tenant_id: tenantId })
    return { success: false, error: `MP refresh failed: ${tokenErrBody.slice(0, 300)}` }
  }

  const tokenData = await tokenRes.json() as {
    access_token: string
    refresh_token: string
    expires_in: number
    user_id?: number | string
    public_key?: string
  }

  const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

  const { error: updateErr } = await supabase
    .from('tenant_mp_config')
    .update({
      access_token: tokenData.access_token,
      // Rotated refresh_token — the one just used is now invalid at MP's end.
      refresh_token: tokenData.refresh_token,
      token_expires_at: tokenExpiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)

  if (updateErr) {
    console.error('refreshMpToken: failed to store refreshed tokens:', updateErr, { tenant_id: tenantId })
    return { success: false, error: updateErr.message }
  }

  console.log('refreshMpToken: refreshed OK', { tenant_id: tenantId, token_expires_at: tokenExpiresAt })
  return { success: true, access_token: tokenData.access_token }
}

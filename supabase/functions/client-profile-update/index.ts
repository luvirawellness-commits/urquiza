import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { validateArgentinePhone } from '../_shared/phoneValidation.ts'

// Stage D.1 — update the logged-in client's own global profile. Same
// caller-JWT-forwarding approach as client-profile-get, relying on RLS
// (auth.uid() = id) for isolation rather than the service-role key.
//
// email is intentionally not editable here — it's tied to the auth.users
// identity itself and belongs to Supabase Auth's own email-change flow, not
// this stage. phone_verified is never client-settable and always false —
// the WhatsApp OTP verification flow once planned as Stage D.3 was
// cancelled, so the column is permanently dead weight. Left in place rather
// than migrated out since nothing reads it as true.

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

const REFERRAL_CHANNELS = ['instagram', 'google', 'referral', 'whatsapp', 'in_person', 'other']

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return err('No autorizado', 401)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: authHeader } },
    },
  )

  try {
    const { data: userData, error: userError } = await supabase.auth.getUser()
    if (userError || !userData.user) return err('Token inválido', 401)

    const body = await req.json()
    const { first_name, last_name, phone, birth_date, referral_channel, marketing_consent } = body

    if (referral_channel && !REFERRAL_CHANNELS.includes(referral_channel)) {
      return err('referral_channel inválido')
    }

    const { data: current, error: currentErr } = await supabase
      .from('client_profiles')
      .select('id')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (currentErr) throw currentErr
    if (!current) return err('Perfil no encontrado', 404)

    // deno-lint-ignore no-explicit-any
    const updates: Record<string, any> = {}
    if (first_name !== undefined) updates.first_name = String(first_name).trim()
    if (last_name !== undefined) updates.last_name = String(last_name).trim()
    if (birth_date !== undefined) updates.birth_date = birth_date || null
    if (referral_channel !== undefined) updates.referral_channel = referral_channel || null
    if (marketing_consent !== undefined) updates.marketing_consent = marketing_consent === true

    if (phone !== undefined) {
      const cleanPhone = String(phone).trim()
      const phoneError = validateArgentinePhone(cleanPhone)
      if (phoneError) return err(phoneError)
      updates.phone = cleanPhone
    }

    if (Object.keys(updates).length === 0) {
      return err('No hay campos para actualizar')
    }

    const { data: profile, error: updateErr } = await supabase
      .from('client_profiles')
      .update(updates)
      .eq('id', userData.user.id)
      .select()
      .single()

    if (updateErr) {
      if (updateErr.code === '23505') return err('Ese teléfono ya está en uso por otra cuenta.')
      throw updateErr
    }

    return json({ profile })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.1 — fetch the logged-in client's own global profile. Deliberately
// does NOT use the service-role key: the request's own Authorization header
// (the client's session access token) is forwarded into a plain anon-key
// client, so client_profiles' RLS policy (auth.uid() = id) does the
// isolation — the same guarantee a raw client-side query would get, just
// routed through a function for a consistent API shape with the other
// client-* endpoints.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    const { data: profile, error: profileErr } = await supabase
      .from('client_profiles')
      .select('*')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (profileErr) throw profileErr
    if (!profile) return err('Perfil no encontrado', 404)

    return json({ profile })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

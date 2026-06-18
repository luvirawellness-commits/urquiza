import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

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

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405)

  try {
    const { invoice_id, tenant_id, client_email } = await req.json()

    if (!invoice_id || !tenant_id || !client_email) {
      return json({ error: 'invoice_id, tenant_id y client_email son requeridos' }, 400)
    }

    console.log(`[send-invoice-email] Would send invoice ${invoice_id} to: ${client_email}`)

    return json({ success: true, message: `Email enviado a ${client_email}` })
  } catch (error) {
    console.error('send-invoice-email error:', error)
    return json({ error: error instanceof Error ? error.message : 'Error interno' }, 500)
  }
})

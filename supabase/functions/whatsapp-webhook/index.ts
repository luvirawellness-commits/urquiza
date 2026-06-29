import { serve } from 'https://deno.land/std@0.220.0/http/server.ts'
import { checkRateLimit, rateLimitResponse } from '../_shared/rateLimit.ts'

serve(async (req: Request) => {
  const ip = req.headers.get('x-forwarded-for')
    ?? req.headers.get('cf-connecting-ip')
    ?? 'unknown'

  const rl = await checkRateLimit({
    key: `whatsapp-webhook:${ip}`,
    limit: req.method === 'GET' ? 100 : 500,
    windowSeconds: 60,
  })

  if (!rl.allowed) return rateLimitResponse(rl.resetIn)

  const url = new URL(req.url)

  // ── GET: webhook verification from Meta ──────────────────────────────────────
  if (req.method === 'GET') {
    const mode      = url.searchParams.get('hub.mode')
    const token     = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN')

    console.log('WhatsApp webhook verification attempt', { mode, token, challenge })

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified successfully')
      return new Response(challenge ?? '', { status: 200 })
    }

    console.warn('Webhook verification failed', { mode, token })
    return new Response('Forbidden', { status: 403 })
  }

  // ── POST: incoming messages / status updates from Meta ───────────────────────
  if (req.method === 'POST') {
    // Respond 200 immediately — Meta requires a fast response or it retries
    const responsePromise = new Response('OK', { status: 200 })

    try {
      const rawBody = await req.text()
      const payload = rawBody ? JSON.parse(rawBody) : {}
      console.log('WhatsApp webhook payload:', JSON.stringify(payload, null, 2))
    } catch (err) {
      console.error('Failed to parse WhatsApp webhook body:', err)
    }

    return responsePromise
  }

  return new Response('Method Not Allowed', { status: 405 })
})

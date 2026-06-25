import { serve } from 'https://deno.land/std@0.220.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Format Argentine phone numbers to WhatsApp E.164.
// Handles: already-prefixed (+54... / 54...), local trunk (0...), plain 10-digit.
// Old mobile 15-prefix removed for 2-digit area codes (e.g. Buenos Aires 11).
function formatArgentinaPhone(raw: string): string {
  let d = raw.replace(/\D/g, '')

  if (d.startsWith('54')) {
    // 12 digits = 54 + area + number, missing mobile 9 → insert it
    if (d.length === 12) d = '549' + d.slice(2)
    return `+${d}`
  }

  if (d.startsWith('0')) d = d.slice(1)

  // 11 digits with 15 at positions 2-3 → Buenos Aires old mobile format
  // e.g. 011-15-1234-5678 → strip 0 → 11-15-12345678 → 11-12345678
  if (d.length === 11 && d.slice(2, 4) === '15') {
    d = d.slice(0, 2) + d.slice(4)
  }

  return `+549${d}`
}

function addMinutes(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

function formatArgentinaDateTime(iso: string): { date: string; time: string } {
  const d  = new Date(iso)
  const tz = 'America/Argentina/Buenos_Aires'
  return {
    date: new Intl.DateTimeFormat('es-AR', {
      timeZone: tz, weekday: 'long', day: 'numeric', month: 'long',
    }).format(d),
    time: new Intl.DateTimeFormat('es-AR', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d),
  }
}

async function sendTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  clientName: string,
  date: string,
  time: string,
  serviceName: string,
  therapistName: string,
): Promise<{ ok: boolean; errorMsg?: string }> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'recordatorio_turno_luvira',
        language: { code: 'es' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: clientName },
            { type: 'text', text: date },
            { type: 'text', text: time },
            { type: 'text', text: serviceName },
            { type: 'text', text: therapistName },
          ],
        }],
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, errorMsg: `Meta API ${res.status}: ${body}` }
  }
  return { ok: true }
}

serve(async (req: Request) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const accessToken   = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

  if (!accessToken || !phoneNumberId) {
    console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID')
    return new Response(
      JSON.stringify({ error: 'Missing WhatsApp credentials' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const APPT_SELECT = `
    id, scheduled_at, tenant_id,
    client:clients!fk_apt_client(first_name, last_name, phone),
    service:services!fk_apt_service(name),
    therapist:users!fk_apt_therapist(full_name)
  `

  // Fetch both windows in parallel
  const [res24h, res2h] = await Promise.all([
    supabase
      .from('appointments')
      .select(APPT_SELECT)
      .in('status', ['confirmed', 'pending'])
      .gte('scheduled_at', addMinutes(23 * 60))
      .lte('scheduled_at', addMinutes(25 * 60))
      .eq('whatsapp_reminder_24h_sent', false),
    supabase
      .from('appointments')
      .select(APPT_SELECT)
      .in('status', ['confirmed', 'pending'])
      .gte('scheduled_at', addMinutes(105))   // 1h 45m
      .lte('scheduled_at', addMinutes(135))   // 2h 15m
      .eq('whatsapp_reminder_2h_sent', false),
  ])

  if (res24h.error) console.error('Error querying 24h appointments:', res24h.error)
  if (res2h.error)  console.error('Error querying 2h appointments:',  res2h.error)

  const allAppts = [
    ...(res24h.data ?? []).map((a) => ({ ...a, _type: '24h' as const })),
    ...(res2h.data  ?? []).map((a) => ({ ...a, _type: '2h'  as const })),
  ]

  // Batch-fetch tenant WhatsApp numbers for all unique tenants in result set
  const tenantIds = [...new Set(allAppts.map((a) => a.tenant_id).filter(Boolean))]
  const tenantWhatsapp = new Map<string, string>()

  if (tenantIds.length > 0) {
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, whatsapp_number')
      .in('id', tenantIds)
    for (const t of tenants ?? []) {
      if (t.whatsapp_number) tenantWhatsapp.set(t.id, t.whatsapp_number)
    }
  }

  let sent = 0, skipped = 0, errors = 0

  for (const appt of allAppts) {
    if (!tenantWhatsapp.has(appt.tenant_id)) {
      console.log(`Skip appt ${appt.id}: tenant has no whatsapp_number`)
      skipped++
      continue
    }

    const client = appt.client as { first_name: string; last_name?: string; phone?: string } | null
    if (!client?.phone) {
      console.warn(`Skip appt ${appt.id}: client has no phone`)
      skipped++
      continue
    }

    const service    = appt.service    as { name: string }       | null
    const therapist  = appt.therapist  as { full_name: string }  | null

    const to          = formatArgentinaPhone(client.phone)
    const clientName  = [client.first_name, client.last_name].filter(Boolean).join(' ')
    const { date, time } = formatArgentinaDateTime(appt.scheduled_at)

    console.log(`Sending ${appt._type} reminder → ${to} for appt ${appt.id}`)

    const result = await sendTemplate(
      phoneNumberId, accessToken, to,
      clientName, date, time,
      service?.name ?? 'Sesión',
      therapist?.full_name ?? 'Profesional',
    )

    if (!result.ok) {
      console.error(`Failed for appt ${appt.id}:`, result.errorMsg)
      errors++
      continue
    }

    const updateField = appt._type === '24h'
      ? { whatsapp_reminder_24h_sent: true }
      : { whatsapp_reminder_2h_sent: true }

    const { error: updateErr } = await supabase
      .from('appointments')
      .update(updateField)
      .eq('id', appt.id)

    if (updateErr) console.error(`Failed to mark appt ${appt.id} as reminded:`, updateErr)
    sent++
  }

  const summary = { sent, skipped, errors, total: allAppts.length }
  console.log('whatsapp-reminders summary:', summary)

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})

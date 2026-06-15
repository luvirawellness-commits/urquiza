import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ── CORS ──────────────────────────────────────────────────────────────────────

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

// ── Entry point ───────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const url = new URL(req.url)

  try {
    // ── GET ───────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const action = url.searchParams.get('action')

      // ── 1. GET tenant info by slug ─────────────────────────────────────────
      if (action === 'tenant') {
        const slug = url.searchParams.get('slug')
        if (!slug) return err('slug es requerido')

        console.log('Fetching tenant with slug:', slug)
        const { data: tenant, error: tenantErr } = await supabase
          .from('tenants')
          .select('id, name, slug, address, phone, whatsapp_number, timezone')
          .eq('slug', slug)
          .eq('active', true)
          .maybeSingle()

        console.log('Tenant result:', JSON.stringify(tenant))
        console.log('Tenant error:', JSON.stringify(tenantErr))

        if (tenantErr) throw tenantErr
        if (!tenant) return err('Local no encontrado', 404)

        const [servicesRes, therapistsRes] = await Promise.all([
          supabase
            .from('services')
            .select('id, name, emoji, description, price_60, price_90, category')
            .eq('tenant_id', tenant.id)
            .eq('active', true)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('name'),
          supabase
            .from('users')
            .select('id, full_name, avatar_url, color_hex, schedule')
            .eq('tenant_id', tenant.id)
            .eq('active', true)
            .in('role', ['therapist', 'partner_admin'])
            .order('full_name'),
        ])

        if (servicesRes.error) throw servicesRes.error
        if (therapistsRes.error) throw therapistsRes.error

        return json({
          tenant,
          services: servicesRes.data ?? [],
          therapists: therapistsRes.data ?? [],
        })
      }

      // ── 2. GET availability (slots per therapist per date) ─────────────────
      if (action === 'availability') {
        const tenantId    = url.searchParams.get('tenant_id')
        const therapistId = url.searchParams.get('therapist_id') // optional
        const date        = url.searchParams.get('date')          // YYYY-MM-DD
        const duration    = parseInt(url.searchParams.get('duration') ?? '60')

        if (!tenantId || !date) {
          return err('tenant_id y date son requeridos')
        }
        if (isNaN(duration) || duration < 30) {
          return err('duration debe ser un número de minutos (mínimo 30)')
        }

        // Argentina is UTC-3: midnight ARG = date T03:00:00Z
        // dayStartMs is the epoch for midnight Argentina time — all slot offsets are relative to it.
        const dayStartMs  = new Date(date + 'T03:00:00.000Z').getTime()
        const windowFrom  = new Date(dayStartMs).toISOString()
        const windowTo    = new Date(dayStartMs + 24 * 60 * 60_000).toISOString()
        const nowMs       = Date.now()
        const dayName     = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][
          new Date(date + 'T12:00:00Z').getUTCDay()
        ]

        console.log('Availability request:', { tenant_id: tenantId, date, duration, therapist_id: therapistId ?? null, dayName, windowFrom, windowTo })

        // ── Fetch therapists ───────────────────────────────────────────────────
        // deno-lint-ignore no-explicit-any
        let therapistsQuery: any = supabase
          .from('users')
          .select('id, full_name, color_hex')
          .eq('tenant_id', tenantId)
          .eq('active', true)
          .in('role', ['therapist', 'partner_admin'])
          .order('full_name')

        if (therapistId) therapistsQuery = therapistsQuery.eq('id', therapistId)

        const { data: therapists, error: therapistsErr } = await therapistsQuery
        if (therapistsErr) throw therapistsErr
        if (!therapists || therapists.length === 0) {
          return therapistId ? err('Terapeuta no encontrado', 404) : json({ slots: [] })
        }

        console.log('Therapists found:', therapists.length)

        const therapistIds = (therapists as { id: string }[]).map((t) => t.id)

        // ── Fetch profiles + appointments in parallel ──────────────────────────
        const [{ data: profiles, error: profilesErr }, { data: allAppts, error: apptErr }] =
          await Promise.all([
            supabase
              .from('employee_profiles')
              .select('user_id, weekly_schedule')
              .in('user_id', therapistIds),
            supabase
              .from('appointments')
              .select('therapist_id, scheduled_at, duration_minutes, status')
              .eq('tenant_id', tenantId)
              .in('therapist_id', therapistIds)
              .gte('scheduled_at', windowFrom)
              .lt('scheduled_at', windowTo)
              .not('status', 'in', '(cancelled,no_show)'),
          ])

        if (profilesErr) throw profilesErr
        if (apptErr) throw apptErr

        // deno-lint-ignore no-explicit-any
        const profileMap = new Map<string, any>(
          (profiles ?? []).map((p) => [p.user_id, p.weekly_schedule])
        )

        // ── Compute available slots per therapist ──────────────────────────────
        const slotMap = new Map<string, { id: string; name: string; color: string | null }[]>()

        for (const t of therapists as { id: string; full_name: string; color_hex: string | null }[]) {
          // STEP 1 — Does therapist work this day?
          // deno-lint-ignore no-explicit-any
          const weeklySchedule = profileMap.get(t.id) as Record<string, { from: string; to: string }[]> | null
          const dayIntervals   = weeklySchedule?.[dayName] ?? []

          console.log('Therapist:', t.id, t.full_name, '| day:', dayName, '| intervals:', JSON.stringify(dayIntervals))

          if (!dayIntervals.length) continue

          // STEP 2 & 3 — Separate blocked slots from booked appointments
          const tAppts  = (allAppts ?? []).filter((a) => a.therapist_id === t.id)
          const blocked = tAppts.filter((a) => a.status === 'blocked')
          const booked  = tAppts.filter((a) => a.status !== 'blocked')

          // STEP 4 — Generate candidate slots and filter
          for (const interval of dayIntervals) {
            const [startH, startM] = interval.from.split(':').map(Number)
            const [endH,   endM]   = interval.to.split(':').map(Number)
            const startMin         = startH * 60 + startM
            const endMin           = endH   * 60 + endM

            for (let slotMin = startMin; slotMin + duration <= endMin; slotMin += 30) {
              // slotMs is UTC epoch: dayStartMs (midnight ARG in UTC) + slotMin offset
              const slotMs    = dayStartMs + slotMin * 60_000
              const slotEndMs = slotMs + duration * 60_000

              // Skip past slots (30-min buffer so clients can actually book)
              if (slotMs < nowMs + 30 * 60_000) continue

              // Skip if overlaps any blocked appointment
              const isBlocked = blocked.some((a) => {
                const aStart = new Date(a.scheduled_at).getTime()
                const aEnd   = aStart + ((a.duration_minutes as number) ?? 60) * 60_000
                return slotMs < aEnd && slotEndMs > aStart
              })
              if (isBlocked) continue

              // Skip if overlaps any booked appointment
              const isBooked = booked.some((a) => {
                const aStart = new Date(a.scheduled_at).getTime()
                const aEnd   = aStart + ((a.duration_minutes as number) ?? 60) * 60_000
                return slotMs < aEnd && slotEndMs > aStart
              })
              if (isBooked) continue

              // Slot is free — record Argentina local time HH:MM
              const slotH   = Math.floor(slotMin / 60)
              const slotM   = slotMin % 60
              const timeStr = `${pad(slotH)}:${pad(slotM)}`
              if (!slotMap.has(timeStr)) slotMap.set(timeStr, [])
              slotMap.get(timeStr)!.push({ id: t.id, name: t.full_name, color: t.color_hex ?? null })
            }
          }
        }

        // STEP 5 — Build sorted response
        const slots = Array.from(slotMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([time, therapists]) => ({ time, therapists }))

        console.log('Total available slots:', slots.length)
        return json({ slots })
      }

      return err('Acción GET no reconocida', 404)
    }

    // ── POST ──────────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      // deno-lint-ignore no-explicit-any
      const body = await req.json() as Record<string, any>
      const action = body.action as string | undefined

      // ── 3. POST register-client ────────────────────────────────────────────
      if (action === 'register-client') {
        const { tenant_id, first_name, last_name, phone, email, notes } = body

        if (!tenant_id || !first_name || !phone) {
          return err('tenant_id, first_name y phone son requeridos')
        }

        // Check if phone already registered for this tenant
        const { data: existing } = await supabase
          .from('clients')
          .select('id, first_name, last_name, phone, email')
          .eq('tenant_id', tenant_id)
          .eq('phone', String(phone).trim())
          .maybeSingle()

        if (existing) {
          return json({ client: existing, already_registered: true })
        }

        // Create new client
        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .insert({
            tenant_id,
            first_name:  String(first_name).trim(),
            last_name:   last_name ? String(last_name).trim() : null,
            phone:       String(phone).trim(),
            email:       email ? String(email).trim() : null,
            notes:       notes ? String(notes).trim() : null,
            status:      'active',
            source:      'online',
            wa_opt_in:   true,
          })
          .select('id, first_name, last_name, phone, email')
          .single()

        if (clientErr) {
          if (clientErr.code === '23505') {
            return err('Ya existe un cliente registrado con ese teléfono.')
          }
          throw clientErr
        }

        return json({ client, already_registered: false })
      }

      // ── 4. POST login-client ───────────────────────────────────────────────
      if (action === 'login-client') {
        const { tenant_id, phone } = body

        if (!tenant_id || !phone) {
          return err('tenant_id y phone son requeridos')
        }

        const { data: client, error: clientErr } = await supabase
          .from('clients')
          .select('id, first_name, last_name, phone, email, total_sessions, last_visit_at')
          .eq('tenant_id', tenant_id)
          .eq('phone', String(phone).trim())
          .eq('status', 'active')
          .maybeSingle()

        if (clientErr) throw clientErr
        if (!client) return err('No encontramos un cliente registrado con ese teléfono.', 404)

        return json({ client })
      }

      // ── 5. POST create-booking ─────────────────────────────────────────────
      if (action === 'create-booking') {
        const {
          tenant_id,
          client_id,
          therapist_id,
          service_id,
          scheduled_at,
          duration_minutes,
          notes,
        } = body

        if (!tenant_id || !client_id || !therapist_id || !scheduled_at || !duration_minutes) {
          return err('tenant_id, client_id, therapist_id, scheduled_at y duration_minutes son requeridos')
        }

        const durMin   = parseInt(String(duration_minutes))
        if (isNaN(durMin) || durMin < 30) return err('duration_minutes inválido')

        // Verify client belongs to this tenant
        const { data: client, error: clientCheckErr } = await supabase
          .from('clients')
          .select('id, first_name, last_name')
          .eq('id', client_id)
          .eq('tenant_id', tenant_id)
          .maybeSingle()

        if (clientCheckErr) throw clientCheckErr
        if (!client) return err('Cliente no encontrado', 404)

        // Check for schedule conflicts with existing appointments.
        // Query a window wide enough to catch any appointment that could overlap.
        const slotStartMs  = new Date(scheduled_at).getTime()
        const slotEndMs    = slotStartMs + durMin * 60_000
        const lookbackMs   = 4 * 60 * 60_000  // 4-hour lookback covers any realistic appointment length
        const queryFrom    = new Date(slotStartMs - lookbackMs).toISOString()
        const queryTo      = new Date(slotEndMs).toISOString()

        const { data: nearby, error: conflictErr } = await supabase
          .from('appointments')
          .select('id, scheduled_at, duration_minutes')
          .eq('tenant_id', tenant_id)
          .eq('therapist_id', therapist_id)
          .gte('scheduled_at', queryFrom)
          .lt('scheduled_at', queryTo)
          .not('status', 'in', '(cancelled,no_show,blocked)')

        if (conflictErr) throw conflictErr

        const hasConflict = (nearby ?? []).some((appt) => {
          const aStart = new Date(appt.scheduled_at as string).getTime()
          const aEnd   = aStart + ((appt.duration_minutes as number) ?? 60) * 60_000
          return slotStartMs < aEnd && slotEndMs > aStart
        })

        if (hasConflict) {
          return err('El horario seleccionado ya no está disponible. Por favor elegí otro.', 409)
        }

        // Fetch service price for price_charged
        let priceCharged: number | null = null
        if (service_id) {
          const { data: svc, error: svcErr } = await supabase
            .from('services')
            .select('price_60, price_90')
            .eq('id', service_id)
            .eq('tenant_id', tenant_id)
            .maybeSingle()

          if (svcErr) throw svcErr
          if (svc) {
            priceCharged = durMin === 90 ? (svc.price_90 ?? svc.price_60) : svc.price_60
          }
        }

        // Create the appointment
        const { data: appt, error: apptErr } = await supabase
          .from('appointments')
          .insert({
            tenant_id,
            client_id,
            therapist_id,
            service_id:       service_id ?? null,
            scheduled_at,
            duration_minutes: durMin,
            status:           'confirmed',
            source:           'web',
            box_number:       1,
            price_charged:    priceCharged,
            notes:            notes ? String(notes).trim() : null,
          })
          .select(`
            id,
            scheduled_at,
            duration_minutes,
            therapist:users!fk_apt_therapist (full_name),
            service:services!fk_apt_service (name, price_60, price_90)
          `)
          .single()

        if (apptErr) throw apptErr

        return json({ booking: appt }, 201)
      }

      return err('Acción POST no reconocida', 404)
    }

    return err('Método no permitido', 405)

  } catch (error) {
    console.error('public-booking error:', error)
    // deno-lint-ignore no-explicit-any
    if ((error as any)?.code === 'P0001') {
      return json({ error: 'Este horario ya no está disponible. Por favor elegí otro turno.' }, 409)
    }
    return err(
      error instanceof Error ? error.message : 'Error interno del servidor',
      500,
    )
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

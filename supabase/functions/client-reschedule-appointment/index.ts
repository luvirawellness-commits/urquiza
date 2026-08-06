import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.5.1 — lets a logged-in client reschedule their own appointment.
//
// Ownership is resolved server-side from the appointment row itself
// (tenant_id, client_id), never from client-supplied tenant_id — same
// reasoning as client-my-appointments/client-my-tenants: a client's JWT
// carries no app_metadata.tenant_id, so isolation is enforced in code here,
// not via RLS.
//
// Availability for the new slot is re-validated by actually calling
// public-booking's own `action=availability` (schedule + conflict aware)
// rather than reimplementing that logic a third time — this function only
// adds a cheap local pre-check for the new slot overlapping the
// appointment's OWN current time, which the reused endpoint can't know to
// exclude (the appointment hasn't moved yet at the time of the check).
//
// The <4h-with-paid-deposit path never talks to MercadoPago and never
// creates a new appointment itself: it cancels the original (deposit_lost,
// original `transactions` row untouched — non-refundable income) and hands
// back everything the frontend needs to call the EXISTING create-sena-payment
// (or public-booking create-booking, if no seña is currently required) —
// the same two endpoints a brand-new booking already uses. No duplicated
// booking/payment logic in here.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_show', 'blocked']
const FOUR_HOURS_MS = 4 * 60 * 60_000

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status)
}

// Same "-03:00" fixed-offset construction reservar.html/public-booking
// already use everywhere, so there's no ambiguity from parsing a bare
// date+time against the server's own timezone.
function toScheduledAtIso(date: string, time: string): string {
  return `${date}T${time}:00-03:00`
}

async function isSlotAvailable(
  tenantId: string, therapistId: string, date: string, time: string, durationMinutes: number,
): Promise<boolean> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const qs = new URLSearchParams({
    action: 'availability',
    tenant_id: tenantId,
    therapist_id: therapistId,
    date,
    duration: String(durationMinutes),
  })
  const res = await fetch(`${supabaseUrl}/functions/v1/public-booking?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${anonKey}`, apikey: anonKey },
  })
  if (!res.ok) throw new Error('No se pudo verificar la disponibilidad del nuevo horario.')
  const data = await res.json() as { slots?: { time: string; therapists: { id: string }[] }[] }
  const slot = (data.slots ?? []).find((s) => s.time === time)
  if (!slot) return false
  return slot.therapists.some((t) => t.id === therapistId)
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders })
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('No autorizado', 401)
    const token = authHeader.replace('Bearer ', '')

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
    if (callerError || !callerData.user) return err('Token inválido', 401)

    const callerRole = callerData.user.app_metadata?.role as string | undefined
    if (callerRole !== 'client') return err('Esta cuenta no es una cuenta de cliente.', 403)

    const body = await req.json()
    const { appointment_id, new_date, new_time, therapist_id, confirm_loss } = body

    if (!appointment_id || !new_date || !new_time || !therapist_id) {
      return err('appointment_id, new_date, new_time y therapist_id son requeridos')
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(new_date)) return err('new_date inválido')
    if (!/^\d{2}:\d{2}$/.test(new_time)) return err('new_time inválido')

    // ── 1. Load the appointment (tenant/client derived from it, never trusted from the caller) ──
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, tenant_id, client_id, therapist_id, service_id, scheduled_at, duration_minutes, status, deposit_paid, deposit_amount')
      .eq('id', appointment_id)
      .maybeSingle()
    if (apptErr) throw apptErr
    if (!appt) return err('Turno no encontrado', 404)

    // ── 2. Verify this appointment actually belongs to the calling client ──
    const { data: linkedClient, error: linkErr } = await supabaseAdmin
      .from('clients')
      .select('id, first_name, last_name, email')
      .eq('tenant_id', appt.tenant_id)
      .eq('client_profile_id', callerData.user.id)
      .maybeSingle()
    if (linkErr) throw linkErr
    if (!linkedClient || linkedClient.id !== appt.client_id) {
      return err('No tenés permiso para modificar este turno.', 403)
    }

    // ── 3. Must be in a movable state ──
    if (TERMINAL_STATUSES.includes(appt.status)) {
      return err('Este turno ya no se puede reprogramar.', 400)
    }

    // ── 4. New therapist must be a real, active therapist at this tenant ──
    const { data: therapist, error: therapistErr } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', therapist_id)
      .eq('tenant_id', appt.tenant_id)
      .eq('active', true)
      .in('role', ['therapist', 'partner_admin'])
      .maybeSingle()
    if (therapistErr) throw therapistErr
    if (!therapist) return err('Terapeuta no encontrado', 404)

    // ── 5. New slot can't just be the appointment's own current slot ──
    const newScheduledAtIso = toScheduledAtIso(new_date, new_time)
    const newStartMs = new Date(newScheduledAtIso).getTime()
    const newEndMs = newStartMs + appt.duration_minutes * 60_000
    const curStartMs = new Date(appt.scheduled_at).getTime()
    const curEndMs = curStartMs + appt.duration_minutes * 60_000
    if (newStartMs < curEndMs && newEndMs > curStartMs) {
      return err('El nuevo horario coincide con tu turno actual. Elegí un horario diferente.', 400)
    }

    // ── 6. Real availability check — reuses public-booking's own engine ──
    const available = await isSlotAvailable(appt.tenant_id, therapist_id, new_date, new_time, appt.duration_minutes)
    if (!available) {
      return err('El horario seleccionado ya no está disponible. Elegí otro.', 409)
    }

    // ── 7. No paid deposit → move freely, no 4-hour rule involved ──
    if (!appt.deposit_paid) {
      return await moveAppointment(supabaseAdmin, appt, newScheduledAtIso, therapist_id)
    }

    // ── 8. Paid deposit — 4-hour rule based on the CURRENT scheduled time ──
    const hoursUntil = (curStartMs - Date.now()) / (60 * 60_000)

    if (curStartMs - Date.now() >= FOUR_HOURS_MS) {
      return await moveAppointment(supabaseAdmin, appt, newScheduledAtIso, therapist_id)
    }

    if (!confirm_loss) {
      return json({
        action: 'confirmation_required',
        reason: 'deposit_will_be_lost',
        hours_until_appointment: Math.max(0, hoursUntil),
        deposit_amount: appt.deposit_amount,
      })
    }

    // ── 9. Confirmed: forfeit the original deposit, hand off a fresh booking ──
    const { error: cancelErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        deposit_lost: true,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Reprogramado por el cliente con menos de 4hs de anticipación — seña perdida',
      })
      .eq('id', appt.id)
      .eq('tenant_id', appt.tenant_id)
    if (cancelErr) throw cancelErr

    const [{ data: tenant, error: tenantErr }, { data: service, error: serviceErr }] = await Promise.all([
      supabaseAdmin.from('tenants').select('sena_online_required, sena_online_amount').eq('id', appt.tenant_id).maybeSingle(),
      supabaseAdmin.from('services').select('name').eq('id', appt.service_id).eq('tenant_id', appt.tenant_id).maybeSingle(),
    ])
    if (tenantErr) throw tenantErr
    if (serviceErr) throw serviceErr

    const requiresSena = !!(tenant?.sena_online_required && Number(tenant?.sena_online_amount) > 0)
    const clientName = [linkedClient.first_name, linkedClient.last_name].filter(Boolean).join(' ')

    return json({
      action: 'new_booking_required',
      cancelled_appointment_id: appt.id,
      booking_params: {
        tenant_id: appt.tenant_id,
        client_id: appt.client_id,
        client_name: clientName,
        client_email: linkedClient.email || null,
        service_id: appt.service_id,
        service_name: service?.name ?? '',
        therapist_id,
        scheduled_at: newScheduledAtIso,
        duration_minutes: appt.duration_minutes,
        requires_sena: requiresSena,
        sena_amount: requiresSena ? Number(tenant?.sena_online_amount) : null,
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

// deno-lint-ignore no-explicit-any
async function moveAppointment(
  supabaseAdmin: any,
  appt: { id: string; tenant_id: string },
  newScheduledAtIso: string,
  therapistId: string,
): Promise<Response> {
  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('appointments')
    .update({ scheduled_at: newScheduledAtIso, therapist_id: therapistId })
    .eq('id', appt.id)
    .eq('tenant_id', appt.tenant_id)
    .select('id, scheduled_at, duration_minutes, therapist_id, status, deposit_paid')
    .single()
  if (updateErr) throw updateErr
  return json({ action: 'rescheduled', appointment: updated })
}

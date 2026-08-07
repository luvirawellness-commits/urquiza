import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Stage D.5.3 — lets a logged-in client cancel their own appointment.
// Simpler sibling of client-reschedule-appointment: same auth/ownership
// pattern, but no 4-hour rule — cancelling ALWAYS forfeits a paid deposit,
// regardless of how far in advance, so there's no hours-until computation
// here at all. The client must explicitly confirm the loss first (same
// confirm_loss / 200-not-error "confirmation_required" pattern reschedule
// uses), and the original `transactions` row is never touched — it stays
// recorded as non-refundable tenant income.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TERMINAL_STATUSES = ['completed', 'cancelled', 'no_show', 'blocked']

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
    const { appointment_id, confirm_loss } = body
    if (!appointment_id) return err('appointment_id es requerido')

    // ── 1. Load the appointment (tenant/client derived from it, never trusted from the caller) ──
    const { data: appt, error: apptErr } = await supabaseAdmin
      .from('appointments')
      .select('id, tenant_id, client_id, status, deposit_paid, deposit_amount')
      .eq('id', appointment_id)
      .maybeSingle()
    if (apptErr) throw apptErr
    if (!appt) return err('Turno no encontrado', 404)

    // ── 2. Verify this appointment actually belongs to the calling client ──
    const { data: linkedClient, error: linkErr } = await supabaseAdmin
      .from('clients')
      .select('id')
      .eq('tenant_id', appt.tenant_id)
      .eq('client_profile_id', callerData.user.id)
      .maybeSingle()
    if (linkErr) throw linkErr
    if (!linkedClient || linkedClient.id !== appt.client_id) {
      return err('No tenés permiso para modificar este turno.', 403)
    }

    // ── 3. Must be in a cancellable state ──
    if (TERMINAL_STATUSES.includes(appt.status)) {
      return err('Este turno ya no se puede cancelar.', 400)
    }

    // ── 4. No paid deposit → cancel freely, no confirmation needed ──
    if (!appt.deposit_paid) {
      const { error: cancelErr } = await supabaseAdmin
        .from('appointments')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: 'Cancelado por el cliente',
        })
        .eq('id', appt.id)
        .eq('tenant_id', appt.tenant_id)
      if (cancelErr) throw cancelErr

      return json({ action: 'cancelled', appointment_id: appt.id })
    }

    // ── 5. Paid deposit — cancelling always forfeits it, no time exception ──
    if (!confirm_loss) {
      return json({
        action: 'confirmation_required',
        reason: 'deposit_will_be_lost',
        deposit_amount: appt.deposit_amount,
        message: 'Vas a perder la seña que ya pagaste. Esta acción no se puede deshacer.',
      })
    }

    const { error: cancelErr } = await supabaseAdmin
      .from('appointments')
      .update({
        status: 'cancelled',
        deposit_lost: true,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: 'Cancelado por el cliente',
      })
      .eq('id', appt.id)
      .eq('tenant_id', appt.tenant_id)
    if (cancelErr) throw cancelErr

    return json({ action: 'cancelled', appointment_id: appt.id, deposit_lost: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error desconocido'
    return err(message)
  }
})

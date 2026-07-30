import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Stage C.2: order creation + polling only — no webhook confirmation yet
// (that's C.3). Kept as a shared hook/helper module (not inlined in
// Agenda.tsx) since checkout flows beyond session-closing will eventually
// need the same device lookup + order lifecycle calls.

export type PointDevice = {
  id: string
  terminal_id: string
  label: string | null
}

// Only active devices — an inactive one (toggled off in Configuración)
// must never be offered as a charge target here.
export function useActivePointDevices(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ['point-devices-active', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_point_devices')
        .select('id, terminal_id, label')
        .eq('tenant_id', tenantId as string)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as PointDevice[]
    },
    enabled: !!tenantId,
  })
}

export type PendingPointCharge = {
  mp_order_id: string
  terminal_id: string
  amount: number
  payment_method: string
}

// The duplicate-charge fix: point_charges is the durable record of any
// order still unresolved ('created' covers MP's own "created"/"at_terminal"
// states alike — see mp-point-check-order). Checked before ever offering a
// fresh "Cobrar con Point" button, and again whenever the session modal is
// reopened, so a charge that's still genuinely in flight is resumed instead
// of a second one being started underneath it.
//
// Takes appointmentId (session-closing) or idempotencyKey (gift card /
// membership sales, which have no DB row to key off until after the charge
// succeeds — see 20260803000000) — exactly one should be set by the caller,
// mirroring mp-point-create-order's own validation.
export function usePendingPointCharge(key: { appointmentId?: string | null; idempotencyKey?: string | null }) {
  const { appointmentId, idempotencyKey } = key
  return useQuery({
    queryKey: ['point-charge-pending', appointmentId, idempotencyKey],
    queryFn: async () => {
      let query = supabase
        .from('point_charges')
        .select('mp_order_id, terminal_id, amount, payment_method')
        .eq('status', 'created')
      query = appointmentId
        ? query.eq('appointment_id', appointmentId)
        : query.eq('idempotency_key', idempotencyKey as string)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data as PendingPointCharge | null
    },
    enabled: !!appointmentId || !!idempotencyKey,
  })
}

export type PointOrderResult = {
  order_id: string
  status: string
  status_detail?: string | null
}

type CallerAuth = { tenantId: string; userId: string; accessToken: string }

export async function createPointOrder(auth: CallerAuth & {
  amount: number
  description: string
  externalReference: string
  terminalId: string
  appointmentId?: string
  idempotencyKey?: string
  paymentMethod: string
}): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-create-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      amount: auth.amount,
      description: auth.description,
      external_reference: auth.externalReference,
      terminal_id: auth.terminalId,
      appointment_id: auth.appointmentId,
      idempotency_key: auth.idempotencyKey,
      payment_method: auth.paymentMethod,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al iniciar el cobro con Point')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

export async function checkPointOrder(auth: CallerAuth & { orderId: string }): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-check-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      order_id: auth.orderId,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al consultar el cobro')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

export async function cancelPointOrder(auth: CallerAuth & { orderId: string }): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-cancel-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      order_id: auth.orderId,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al cancelar el cobro')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

// Orders reach one of these and never move again — polling stops here.
export const POINT_TERMINAL_STATUSES = ['processed', 'failed', 'canceled', 'expired'] as const

export const POINT_STATUS_LABELS: Record<string, string> = {
  failed: 'El cobro fue rechazado por el lector.',
  canceled: 'El cobro fue cancelado.',
  expired: 'El cobro expiró sin completarse.',
}

// Payment methods that must go through a physical Point charge instead of
// manual entry whenever the tenant has an active device — the fraud hole
// Stage C.2 closed for session closing, now shared with any flow that takes
// a debit/credit/qr payment (gift cards, memberships, product sales,
// Finanzas' Registrar cobro card).
export const POINT_ONLY_METHODS = ['debit', 'credit', 'qr']

export type PointChargeStatus = 'idle' | 'creating' | 'waiting' | 'processed' | 'failed' | 'canceled' | 'expired'

function pendingSaleStorageKey(flow: string, tenantId: string): string {
  return `luvira:point-pending:${flow}:${tenantId}`
}

// Appointments already exist as a DB row before their Point charge starts,
// so usePendingPointCharge({ appointmentId }) can resume across a
// reload/crash for free — the user just reopens the same appointment. Gift
// card and membership sales have no such anchor: the entity isn't created
// until AFTER the charge succeeds, so there's nothing to navigate back to.
//
// This hook replicates that protection two ways: (1) a client-generated
// idempotency key persisted to localStorage before the charge starts, so
// mp-point-create-order's dedup guard covers these sales the same way
// appointment_id covers session closing (see 20260803000000); (2) the exact
// form payload needed to complete the sale is persisted alongside it —
// unlike an appointment, a reload wipes all of the form's React state, so
// without this a resumed charge that reaches 'processed' would have nothing
// to submit and would silently no-op despite the customer having been
// charged. Cleared once the charge reaches a terminal state or the sale
// completes — nothing left to resume either way past that point.
export function usePointSalePersistence<T>(
  flow: 'gift_card' | 'membership' | 'product' | 'registrar_cobro' | 'combined_checkout',
  tenantId: string | null | undefined,
) {
  const [idempotencyKey, setIdempotencyKeyState] = useState<string | null>(null)
  const [resumedPayload, setResumedPayload] = useState<T | null>(null)
  const initializedRef = useRef<string | null>(null)

  // Picks up a leftover key+payload from a previous session (reload/crash)
  // once per tenant — a fresh one is only minted on demand (ensureKey), not
  // eagerly, so a sale that never touches Point never writes to localStorage.
  useEffect(() => {
    if (!tenantId || initializedRef.current === tenantId) return
    initializedRef.current = tenantId
    const raw = localStorage.getItem(pendingSaleStorageKey(flow, tenantId))
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as { idempotencyKey: string; payload: T }
      if (parsed?.idempotencyKey) {
        setIdempotencyKeyState(parsed.idempotencyKey)
        setResumedPayload(parsed.payload ?? null)
      }
    } catch {
      localStorage.removeItem(pendingSaleStorageKey(flow, tenantId))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId])

  // Returns the current key if one is already active (fresh or resumed),
  // otherwise mints one and persists it with the given payload snapshot.
  // Call this once, right when the form first becomes Point-gated.
  function ensureKey(payload: T): string {
    if (idempotencyKey) return idempotencyKey
    const key = crypto.randomUUID()
    if (tenantId) localStorage.setItem(pendingSaleStorageKey(flow, tenantId), JSON.stringify({ idempotencyKey: key, payload }))
    setIdempotencyKeyState(key)
    return key
  }

  // Keeps the persisted payload in sync with live edits — call on every
  // relevant field change while the charge is still 'idle', so whatever
  // eventually gets frozen (fields get locked once charging starts) is
  // exactly what a resume would submit.
  function syncPayload(payload: T) {
    if (!idempotencyKey || !tenantId) return
    localStorage.setItem(pendingSaleStorageKey(flow, tenantId), JSON.stringify({ idempotencyKey, payload }))
  }

  function clearKey() {
    if (tenantId) localStorage.removeItem(pendingSaleStorageKey(flow, tenantId))
    setIdempotencyKeyState(null)
    setResumedPayload(null)
  }

  return { idempotencyKey, resumedPayload, ensureKey, syncPayload, clearKey }
}

import { useState, useEffect, useRef } from 'react'
import {
  useActivePointDevices, usePendingPointCharge, usePointSalePersistence,
  POINT_ONLY_METHODS, type PointChargeStatus, type PointDevice, type PendingPointCharge,
} from '@/hooks/useMercadoPagoPoint'

// Shared machinery behind every "force Point for debit/credit/qr when the
// tenant has an active device" flow — extracted after the same ~150-300
// lines got hand-rolled 5 times (Agenda's session closing, GiftCards,
// VenderMembresiaModal, Productos, Finanzas' Registrar cobro). Owns: device
// lookup, the two dedup-key modes (an existing DB row like an appointment,
// vs a client-generated idempotency key for sales that don't exist as a DB
// row until the charge succeeds), one-shot resume detection, row lock/ready
// derivation, the auto-fire-on-ready effect, the beforeunload guard, and a
// Dialog-blocking convenience.
//
// Deliberately does NOT own each flow's own row/split state or per-row
// status record — those are real per-flow domain data (splits, cart,
// pointStatuses), not something a shared hook should reach into. A future
// flow instantiates this, wires its own rows/status state into `rows`, and
// renders PointChargeControl per tracked row — it should not need to
// re-derive any of the five effects above by hand.

export type PointDedupKey =
  | { mode: 'appointment'; appointmentId: string | undefined }
  | { mode: 'idempotency'; flow: 'gift_card' | 'membership' | 'product' | 'registrar_cobro' | 'combined_checkout' }

export type PointGatedRow = { method: string; status: PointChargeStatus }

export function usePointGatedPayment<TPayload>(opts: {
  tenantId: string | null | undefined
  dedupKey: PointDedupKey
  rows: PointGatedRow[]
  canSubmit: boolean
  onAllProcessed: () => void
  onResume?: (charge: PendingPointCharge, payload: TPayload | null) => void
  beforeUnloadGuard?: boolean
}) {
  const { tenantId, dedupKey, rows, canSubmit, onAllProcessed, onResume, beforeUnloadGuard = true } = opts

  const { data: pointDevices = [] } = useActivePointDevices(tenantId)
  const hasActivePointDevices = pointDevices.length > 0
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [resumeOrderId, setResumeOrderId] = useState<string | null>(null)
  const resumeAppliedRef = useRef(false)

  useEffect(() => {
    if (pointDevices.length === 1) setSelectedDeviceId(pointDevices[0].terminal_id)
  }, [pointDevices])

  // Hooks can't be called conditionally, so this always runs — in
  // 'appointment' mode it's passed tenantId: undefined, which keeps its
  // internal effect fully inert (never touches localStorage), and
  // ensureKey/syncPayload below are never actually invoked for that mode.
  // The flow value is never read in that case either.
  const persistence = usePointSalePersistence<TPayload>(
    dedupKey.mode === 'idempotency' ? dedupKey.flow : 'gift_card',
    dedupKey.mode === 'idempotency' ? tenantId : undefined,
  )
  const idempotencyKey = dedupKey.mode === 'idempotency' ? persistence.idempotencyKey : null

  const { data: pendingCharge } = usePendingPointCharge(
    dedupKey.mode === 'appointment'
      ? { appointmentId: dedupKey.appointmentId }
      : { idempotencyKey },
  )

  function ensureKey(payload: TPayload) {
    if (dedupKey.mode !== 'idempotency') return
    persistence.ensureKey(payload)
  }

  function syncPayload(payload: TPayload) {
    if (dedupKey.mode !== 'idempotency') return
    persistence.syncPayload(payload)
  }

  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume

  // Resume: fires the caller's onResume exactly once, the first time a
  // charge left in flight from before a reload/crash is found — the caller
  // restores its own row/split/entity state from (charge, payload); this
  // hook only owns the device/terminal + order-id half of that state.
  useEffect(() => {
    if (resumeAppliedRef.current || !pendingCharge) return
    resumeAppliedRef.current = true
    setResumeOrderId(pendingCharge.mp_order_id)
    setSelectedDeviceId(pendingCharge.terminal_id)
    const payload = dedupKey.mode === 'idempotency' ? persistence.resumedPayload : null
    onResumeRef.current?.(pendingCharge, payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCharge])

  // A resumed row must stay tracked even if devices were deactivated in the
  // meantime — mirrors the original isTrackedPointRow reasoning everywhere
  // this was hand-rolled: an in-flight charge from before must never
  // silently stop being gated. Only row 0 gets this exception, matching
  // every existing caller's resumeOrderId={i === 0 ? resumeOrderId : null}.
  function isTrackedPointRow(index: number): boolean {
    const row = rows[index]
    if (!row) return false
    return (hasActivePointDevices || (index === 0 && !!resumeOrderId)) && POINT_ONLY_METHODS.includes(row.method)
  }

  function rowLocked(index: number): boolean {
    if (!isTrackedPointRow(index)) return false
    const status = rows[index].status
    return status === 'creating' || status === 'waiting' || status === 'processed'
  }

  const pointRowsReady = rows.every((row, i) => !isTrackedPointRow(i) || row.status === 'processed')
  const hasTrackedPointRow = rows.some((_row, i) => isTrackedPointRow(i))
  const anyCharging = rows.some((row) => row.status === 'creating' || row.status === 'waiting')

  const onAllProcessedRef = useRef(onAllProcessed)
  onAllProcessedRef.current = onAllProcessed

  // Auto-fires the instant every tracked row reports processed — mirrors
  // CerrarSesionStep's original pointRowsReady auto-confirm effect (Stage
  // C.2 Part 5): leaving this unconfirmed after a successful charge would
  // mean the money is collected but the sale never recorded, and a later
  // retry could double-charge since the dedup guard only blocks while a
  // charge is still 'created'. hasTrackedPointRow gates out pointRowsReady
  // flipping true for an unrelated reason (e.g. no Point rows at all).
  const prevReadyRef = useRef(pointRowsReady)
  useEffect(() => {
    const wasReady = prevReadyRef.current
    prevReadyRef.current = pointRowsReady
    if (!wasReady && pointRowsReady && hasTrackedPointRow && canSubmit) {
      onAllProcessedRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointRowsReady, hasTrackedPointRow, canSubmit])

  // Best-effort defense-in-depth — discourages an accidental tab close
  // while a charge is actually in flight. Opt-out only exists so Agenda's
  // CerrarSesionStep (which never had this) keeps identical behavior; every
  // other caller keeps the default.
  useEffect(() => {
    if (!beforeUnloadGuard || !anyCharging) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [beforeUnloadGuard, anyCharging])

  // Dialog-blocking convenience for flows that own their own Dialog
  // directly (VenderMembresiaModal, Productos' CartModal). Flows that don't
  // own a Dialog (page-level forms) or that report charging status up to a
  // parent that owns the Dialog (Agenda's CerrarSesionStep, via its
  // existing onChargingChange prop) simply don't call this.
  const [showCloseBlockedMsg, setShowCloseBlockedMsg] = useState(false)

  useEffect(() => {
    if (!showCloseBlockedMsg) return
    const t = setTimeout(() => setShowCloseBlockedMsg(false), 4000)
    return () => clearTimeout(t)
  }, [showCloseBlockedMsg])

  function handleDialogOpenChange(open: boolean, onRealClose: () => void) {
    if (!open && anyCharging) {
      setShowCloseBlockedMsg(true)
      return
    }
    if (!open) onRealClose()
  }

  // Clears only the persisted idempotency key/payload — leaves
  // resumeOrderId/resume tracking untouched. Exposed separately from
  // resetPointState (which also resets those) because at least one caller
  // needs exactly this narrower reset to match its pre-existing behavior
  // (VenderMembresiaModal's "Volver" button only ever cleared the key, not
  // the resumed-order tracking, and that distinction is preserved as-is).
  function clearKey() {
    if (dedupKey.mode === 'idempotency') persistence.clearKey()
  }

  function resetPointState() {
    clearKey()
    setResumeOrderId(null)
    resumeAppliedRef.current = false
  }

  return {
    pointDevices,
    hasActivePointDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    resumeOrderId,
    idempotencyKey,
    ensureKey,
    syncPayload,
    isTrackedPointRow,
    rowLocked,
    pointRowsReady,
    hasTrackedPointRow,
    anyCharging,
    showCloseBlockedMsg,
    handleDialogOpenChange,
    clearKey,
    resetPointState,
  }
}

export type { PointChargeStatus, PointDevice, PendingPointCharge }

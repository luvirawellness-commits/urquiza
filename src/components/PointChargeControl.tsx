import { useState, useEffect, useRef } from 'react'
import { CreditCard, Loader2, CheckCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  createPointOrder, checkPointOrder, cancelPointOrder,
  POINT_TERMINAL_STATUSES, POINT_STATUS_LABELS, type PointChargeStatus,
} from '@/hooks/useMercadoPagoPoint'

// Owns one payment's Point charge lifecycle end to end: create order → poll
// every ~3s → terminal state. Reports status up to the parent via
// onStatusChange so the caller's own submit gate can require 'processed'
// before proceeding — the parent never touches the order id or polling
// itself. There is no manual-entry fallback for this row while devices are
// active (Stage C.2 business requirement #1).
//
// Extracted from Agenda.tsx's session-close flow (the original, still the
// most exercised caller) so gift card and membership sales can require the
// same protection without re-implementing it. Exactly one of appointmentId
// (session closing — the entity already exists as a DB row) or
// idempotencyKey (gift cards / memberships — the entity doesn't exist yet,
// only created after the charge succeeds, so a client-generated key stands
// in as the dedup/resume anchor — see 20260803000000) must be provided,
// mirroring mp-point-create-order's own validation.
export function PointChargeControl({
  amount, deviceId, deviceLabel, description, externalReference,
  appointmentId, idempotencyKey, paymentMethod, tenantId, userId, accessToken,
  status, onStatusChange, resumeOrderId,
}: {
  amount: number
  deviceId: string | null
  deviceLabel: string | null
  description: string
  externalReference: string
  appointmentId?: string
  idempotencyKey?: string
  paymentMethod: string
  tenantId: string
  userId: string
  accessToken: string
  status: PointChargeStatus
  onStatusChange: (status: PointChargeStatus) => void
  // Set when point_charges already had an unresolved row for this key when
  // the form mounted (e.g. it was closed/crashed mid-charge last time) —
  // resumes polling against that real order instead of starting a new one,
  // which is the actual fix for the duplicate-charge bug.
  resumeOrderId?: string | null
}) {
  const [statusDetail, setStatusDetail] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [canceling, setCanceling] = useState(false)
  const [isResuming, setIsResuming] = useState(false)
  const orderIdRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // Cleanup on unmount only (e.g. the row is removed) — not on every
  // re-render, since amount/onStatusChange change across renders while a
  // charge is still legitimately in flight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => stopPolling, [])

  function startPolling(orderId: string) {
    console.log('[Point] starting poll loop', { orderId })
    stopPolling()
    pollRef.current = setInterval(async () => {
      console.log('[Point] poll tick', { orderId })
      try {
        const result = await checkPointOrder({ tenantId, userId, accessToken, orderId })
        console.log('[Point] poll result', result)
        setStatusDetail(result.status_detail ?? null)
        const mpStatus = result.status ?? ''
        if (mpStatus === 'processed') {
          stopPolling()
          onStatusChange('processed')
        } else if ((POINT_TERMINAL_STATUSES as readonly string[]).includes(mpStatus) && mpStatus !== 'processed') {
          stopPolling()
          setErrorMsg(POINT_STATUS_LABELS[mpStatus] ?? 'El cobro no se pudo completar.')
          onStatusChange(mpStatus as PointChargeStatus)
        }
        // Any other status (created, at_terminal, ...) is still in progress — keep polling.
      } catch (e) {
        // A single failed poll (network blip) shouldn't abort a live charge —
        // just try again on the next tick.
        console.warn('[Point] poll error', e)
      }
    }, 3000)
    console.log('[Point] poll interval registered', { orderId, intervalId: pollRef.current })
  }

  // Resume takes over on mount if point_charges already had an unresolved
  // order for this key — never calls create-order again for it.
  useEffect(() => {
    if (resumeOrderId && !orderIdRef.current) {
      console.log('[Point] resuming existing order', { resumeOrderId })
      orderIdRef.current = resumeOrderId
      setIsResuming(true)
      startPolling(resumeOrderId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeOrderId])

  async function handleCharge() {
    if (!deviceId || !(amount > 0)) return
    setErrorMsg('')
    setIsResuming(false)
    onStatusChange('creating')
    console.log('[Point] creating order', { deviceId, amount, externalReference, appointmentId, idempotencyKey, paymentMethod })
    try {
      const result = await createPointOrder({
        tenantId, userId, accessToken, amount, description,
        externalReference, terminalId: deviceId, appointmentId, idempotencyKey, paymentMethod,
      })
      console.log('[Point] order created', result)
      orderIdRef.current = result.order_id
      onStatusChange('waiting')
      startPolling(result.order_id)
    } catch (e) {
      console.error('[Point] order creation failed', e)
      setErrorMsg(e instanceof Error ? e.message : 'Error al iniciar el cobro con Point')
      onStatusChange('idle')
    }
  }

  async function handleCancel() {
    if (!orderIdRef.current) return
    setCanceling(true)
    try {
      await cancelPointOrder({ tenantId, userId, accessToken, orderId: orderIdRef.current })
      stopPolling()
      orderIdRef.current = null
      setErrorMsg('')
      setStatusDetail(null)
      onStatusChange('idle')
    } catch {
      // MP only allows canceling while status is still "created" — past that
      // the card may already be mid-swipe on the terminal. Don't pretend it's
      // canceled and let staff walk away from a charge that might still land;
      // keep polling so the real outcome is still captured.
      setErrorMsg('No se pudo cancelar — el cobro puede seguir en curso en el lector. Esperá el resultado.')
    } finally {
      setCanceling(false)
    }
  }

  function handleRetry() {
    orderIdRef.current = null
    setErrorMsg('')
    setStatusDetail(null)
    setIsResuming(false)
    onStatusChange('idle')
  }

  if (status === 'idle') {
    return (
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!deviceId || !(amount > 0)}
          onClick={handleCharge}
          className="gap-1.5 w-full"
        >
          <CreditCard className="w-3.5 h-3.5" />
          Cobrar con Point{deviceLabel ? ` (${deviceLabel})` : ''}
        </Button>
        {!deviceId && <p className="text-xs text-amber-600">Elegí un lector para cobrar.</p>}
        {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      </div>
    )
  }

  if (status === 'creating' || status === 'waiting') {
    return (
      <div className="space-y-1.5 rounded-md border border-plum-200 bg-plum-50 p-2">
        <div className="flex items-center gap-2 text-sm text-plum-800">
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
          <span>
            {status === 'creating'
              ? 'Iniciando cobro...'
              : isResuming
                ? 'Ya hay un cobro en curso, verificando estado...'
                : `Esperando pago en el lector${deviceLabel ? `: ${deviceLabel}` : ''}...`}
          </span>
        </div>
        {statusDetail && <p className="text-xs text-plum-600">{statusDetail}</p>}
        {status === 'waiting' && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={canceling}
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
          >
            {canceling ? 'Cancelando...' : 'Cancelar cobro'}
          </button>
        )}
        {errorMsg && <p className="text-xs text-red-600">{errorMsg}</p>}
      </div>
    )
  }

  if (status === 'processed') {
    return (
      <div className="flex items-center gap-1.5 text-sm text-green-700">
        <CheckCircle className="w-3.5 h-3.5" />
        Pago confirmado en el lector
      </div>
    )
  }

  // failed / canceled / expired
  return (
    <div className="space-y-1">
      <p className="text-xs text-red-600">{errorMsg || 'El cobro no se completó.'}</p>
      <Button type="button" size="sm" variant="outline" onClick={handleRetry} className="gap-1.5">
        <RefreshCw className="w-3.5 h-3.5" />
        Reintentar cobro
      </Button>
    </div>
  )
}

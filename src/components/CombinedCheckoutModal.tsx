import { useState, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, Loader2, FileText } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn, formatCurrency } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useAuth, useTenantId } from '@/contexts/AuthContext'
import { getArgentinaDateString } from '@/utils/dateUtils'
import type { Appointment } from '@/types'
import { PAYMENT_METHODS, isElectronicPayment } from '@/lib/paymentMethods'
import { fetchTransactionsByIds, useElectronicInvoiceQueue, type ResolvedTransaction } from '@/hooks/useAutoInvoice'
import { POINT_ONLY_METHODS } from '@/hooks/useMercadoPagoPoint'
import { usePointGatedPayment, type PointChargeStatus } from '@/hooks/usePointGatedPayment'
import { PointChargeControl } from '@/components/PointChargeControl'
import InvoiceModal from '@/components/InvoiceModal'
import InvoiceTypeChoiceModal from '@/components/InvoiceTypeChoiceModal'

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type SplitRow = { method: string; amount: string }

function displayClientName(appt: Appointment): string {
  if (!appt.client) return 'Sin cliente'
  return [appt.client.first_name, appt.client.last_name].filter(Boolean).join(' ') || 'Cliente'
}

function appointmentBasePrice(appt: Appointment): number {
  return appt.price_charged
    ?? (appt.duration_minutes === 90 ? appt.service?.price_90 ?? appt.service?.price_60 : appt.service?.price_60 ?? appt.service?.price_90)
    ?? 0
}

// Cash/card combined checkout for N same-day appointments closed as one
// transaction group — structurally mirrors Agenda.tsx's CerrarSesionStep
// (split-row payment UI, Point gating, the post-close invoice prompt), but
// deliberately scoped to efectivo_digital only: no membership/gift-card
// options here, since both are inherently single-client/single-service and
// don't generalize to a combined group (see close_appointments_combined's
// own migration comment for the same reasoning).
//
// Combined-checkout payload persisted for Point resume: just the
// appointment ids, so a resumed charge can be cross-checked against
// whatever is currently selected — see onResume below for why a mismatch
// is treated as a hard stop rather than silently proceeding.
type CombinedCheckoutPayload = { appointmentIds: string[] }

type Props = {
  appointments: Appointment[]
  onClose: () => void
  onSuccess: () => void
}

export default function CombinedCheckoutModal({ appointments, onClose, onSuccess }: Props) {
  const { user, session, currentTenantId } = useAuth()
  const tenantId = useTenantId()
  const qc = useQueryClient()

  const total = appointments.reduce((sum, a) => sum + appointmentBasePrice(a), 0)
  const clientIds = Array.from(new Set(appointments.map((a) => a.client_id).filter(Boolean)))
  const sharedClientId = clientIds.length === 1 ? (clientIds[0] as string) : undefined
  const sharedClientName = sharedClientId ? displayClientName(appointments[0]) : 'Consumidor Final'
  const description = `Cobro combinado: ${appointments.map((a) => displayClientName(a)).join(', ')}`
  const concept = `Cobro combinado (${appointments.length} turnos)`

  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ method: 'cash', amount: String(total) }])
  const [pointChargeStatuses, setPointChargeStatuses] = useState<Record<number, PointChargeStatus>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumeMismatch, setResumeMismatch] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [step, setStep] = useState<'form' | 'prompt' | 'invoice'>('form')
  const [cashTxs, setCashTxs] = useState<ResolvedTransaction[]>([])
  const [electronicTxs, setElectronicTxs] = useState<ResolvedTransaction[]>([])
  const [invoiceAnswered, setInvoiceAnswered] = useState(false)
  const invoiceQueue = useElectronicInvoiceQueue({ tenantId })

  const splitTotal = splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
  const splitBalanced = Math.abs(splitTotal - total) < 0.01
  const paymentMethodMissing = splitRows.some((r) => !r.method)

  function setRowPointStatus(index: number, status: PointChargeStatus) {
    setPointChargeStatuses((prev) => ({ ...prev, [index]: status }))
  }

  const canConfirmBase = !busy && splitBalanced && !paymentMethodMissing && !resumeMismatch

  const pointGating = usePointGatedPayment<CombinedCheckoutPayload>({
    tenantId,
    dedupKey: { mode: 'idempotency', flow: 'combined_checkout' },
    rows: splitRows.map((row, i) => ({ method: row.method, status: pointChargeStatuses[i] ?? 'idle' })),
    canSubmit: canConfirmBase,
    onAllProcessed: () => void handleConfirm(),
    // Resume: restore the charge state from before a reload. Unlike a
    // single appointment (which is a stable DB row already, and unlike
    // gift cards/memberships/products where the whole payload can just be
    // restored), this modal only exists while its parent keeps a specific
    // appointment selection alive — a reload wipes that selection too. If
    // the resumed charge's original appointment set doesn't match what's
    // currently selected, block rather than silently submit against the
    // wrong appointments; the charge itself is still safely tracked via
    // the dedup key regardless (nothing is lost, just needs a human to
    // reconcile — same posture as every other "can't fully auto-recover"
    // edge case handled this session).
    onResume: (charge, payload) => {
      setPointChargeStatuses({ 0: 'waiting' })
      setSplitRows([{ method: charge.payment_method, amount: String(charge.amount) }])
      if (payload) {
        const currentIds = appointments.map((a) => a.id).sort().join(',')
        const resumedIds = [...payload.appointmentIds].sort().join(',')
        if (currentIds !== resumedIds) setResumeMismatch(true)
      }
    },
  })

  // Mints the idempotency key (freezing the appointment id list alongside
  // it) once — unlike GiftCardForm, this modal's "payload" (the appointment
  // ids) never changes while open (the selection is fixed by the parent
  // before the modal even mounts, and the Dialog overlay blocks background
  // interaction), so there's nothing to keep syncing after the first call.
  //
  // The one-render deferral below matters: usePointSalePersistence's own
  // resume-detection (reading a leftover key from localStorage) runs in an
  // effect declared earlier than this one, but React doesn't reflect that
  // effect's state update until the NEXT render — calling ensureKey
  // synchronously on the very first render would race it and mint a fresh
  // key, silently orphaning (and locally overwriting in localStorage) a
  // charge that was already in flight from before a reload. Waiting one
  // render guarantees the resumed key (if any) has already landed in
  // pointGating.idempotencyKey before this checks it.
  const [readyToEnsureKey, setReadyToEnsureKey] = useState(false)
  useEffect(() => { setReadyToEnsureKey(true) }, [])

  useEffect(() => {
    if (!readyToEnsureKey || pointGating.idempotencyKey) return
    pointGating.ensureKey({ appointmentIds: appointments.map((a) => a.id) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyToEnsureKey, pointGating.idempotencyKey])

  async function handleConfirm() {
    setAttemptedSubmit(true)
    if (paymentMethodMissing) {
      setError('Por favor seleccioná el medio de pago antes de confirmar')
      return
    }
    if (!pointGating.pointRowsReady) {
      setError('Todavía hay un cobro con Point pendiente de confirmar.')
      return
    }
    setBusy(true); setError(null)
    try {
      const amounts: number[] = []
      const methods: string[] = []
      const collectedViaPoint: boolean[] = []
      splitRows.forEach((row, i) => {
        const amt = Number(row.amount) || 0
        if (amt > 0) {
          amounts.push(amt)
          methods.push(row.method)
          collectedViaPoint.push(
            pointGating.hasActivePointDevices && POINT_ONLY_METHODS.includes(row.method) && pointChargeStatuses[i] === 'processed',
          )
        }
      })

      const { data, error: rpcErr } = await supabase.rpc('close_appointments_combined', {
        p_appointment_ids:      appointments.map((a) => a.id),
        p_tenant_id:            currentTenantId!,
        p_date:                 getArgentinaDateString(),
        p_description:          description,
        p_user_id:              user!.id,
        p_amounts:              amounts,
        p_payment_methods:      methods,
        p_collected_via_point:  collectedViaPoint,
      })
      if (rpcErr) throw new Error(rpcErr.message || 'Error al cerrar los turnos')

      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })

      // The underlying appointments are closed now regardless of how the
      // rest of this modal's own invoicing sub-flow goes — let the parent
      // clear its selection immediately.
      onSuccess()

      const txIds = ((data as { transaction_ids?: string[] } | null)?.transaction_ids) ?? []
      const newTxs = await fetchTransactionsByIds(txIds)
      const electronic = newTxs.filter((tx) => isElectronicPayment(tx.payment_method))
      const cash = newTxs.filter((tx) => !isElectronicPayment(tx.payment_method))
      setElectronicTxs(electronic)
      setCashTxs(cash)

      if (newTxs.length > 0) {
        setStep('prompt')
      } else {
        onClose()
      }
    } catch (e) {
      setError((e as Error).message || 'Error al cerrar los turnos')
    } finally { setBusy(false) }
  }

  // Only fires once the user explicitly answers "Sí" to "¿Querés emitir
  // factura?" — electronic transactions go through the automatic
  // type-resolution queue (still pauses for the A/B choice on Responsable
  // Inscripto tenants), cash/other transactions open the manual invoice form.
  function handleWantInvoice() {
    setInvoiceAnswered(true)
    if (electronicTxs.length > 0) {
      void invoiceQueue.startQueue(electronicTxs.map((tx) => ({
        id: tx.id, amount: tx.amount, paymentMethod: tx.payment_method, clientId: tx.client_id,
        clientName: sharedClientName, concept,
      })))
    }
    if (cashTxs.length > 0) {
      setStep('invoice')
    }
  }

  const canConfirm = canConfirmBase && pointGating.pointRowsReady

  return (
    <>
    <Dialog open onOpenChange={(v) => pointGating.handleDialogOpenChange(v, onClose)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-4 h-4" />
            {step === 'form' ? 'Cobro combinado' : 'Turnos cerrados'}
          </DialogTitle>
          <DialogDescription>
            {step === 'form'
              ? `${appointments.length} turnos · ${appointments.map((a) => displayClientName(a)).join(', ')}`
              : 'El cobro combinado se registró correctamente.'}
          </DialogDescription>
        </DialogHeader>

        {pointGating.showCloseBlockedMsg && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            No podés cerrar mientras se espera la confirmación del pago con Point.
          </div>
        )}

        {resumeMismatch && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Hay un cobro con Point pendiente de una selección de turnos anterior, distinta a la
            actual. El cobro sigue siendo rastreado — revisá Mercado Pago o contactá soporte antes
            de reintentar, para evitar un cobro duplicado.
          </div>
        )}

        {step === 'form' ? (
          <div className="space-y-4 mt-1">
            <div className="bg-plum-50 rounded-lg p-3 flex items-center justify-between">
              <span className="font-medium text-plum-800">Total a cobrar:</span>
              <span className="text-lg font-bold text-plum-800">{formatCurrency(total)}</span>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Métodos de pago</Label>

              {pointGating.hasActivePointDevices && pointGating.pointDevices.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Lector Point</Label>
                  <select
                    className={SELECT_CLS}
                    value={pointGating.selectedDeviceId ?? ''}
                    onChange={(e) => pointGating.setSelectedDeviceId(e.target.value || null)}
                  >
                    <option value="">Seleccionar lector...</option>
                    {pointGating.pointDevices.map((d) => (
                      <option key={d.id} value={d.terminal_id}>{d.label || d.terminal_id}</option>
                    ))}
                  </select>
                </div>
              )}

              {splitRows.map((row, i) => {
                const rowStatus = pointChargeStatuses[i] ?? 'idle'
                const isPointRow = pointGating.isTrackedPointRow(i)
                const locked = pointGating.rowLocked(i)
                const deviceLabel = pointGating.pointDevices.find((d) => d.terminal_id === pointGating.selectedDeviceId)?.label ?? null

                return (
                  <div key={i} className={cn('space-y-1.5', isPointRow && 'rounded-md border p-2')}>
                    <div className="flex gap-2 items-center">
                      <select
                        className={cn(SELECT_CLS, 'flex-1', attemptedSubmit && !row.method && 'border-red-500 focus:border-red-500')}
                        value={row.method}
                        disabled={locked}
                        onChange={(e) => {
                          const method = e.target.value
                          setSplitRows((prev) => prev.map((r, j) => (j === i ? { ...r, method } : r)))
                          setPointChargeStatuses((prev) => {
                            if (!(i in prev)) return prev
                            const next = { ...prev }
                            delete next[i]
                            return next
                          })
                        }}
                      >
                        {PAYMENT_METHODS.map((pm) => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                      </select>
                      <Input
                        type="number" min="0" step="1"
                        className="w-28"
                        value={row.amount}
                        disabled={locked}
                        onChange={(e) => setSplitRows((prev) => prev.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))}
                      />
                      {splitRows.length > 1 && (
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => {
                            setSplitRows((prev) => prev.filter((_, j) => j !== i))
                            setPointChargeStatuses((prev) => {
                              const next: Record<number, PointChargeStatus> = {}
                              Object.entries(prev).forEach(([k, v]) => {
                                const idx = Number(k)
                                if (idx < i) next[idx] = v
                                else if (idx > i) next[idx - 1] = v
                              })
                              return next
                            })
                          }}
                          className="text-muted-foreground hover:text-red-600 px-1 text-base leading-none disabled:opacity-30"
                        >✕</button>
                      )}
                    </div>
                    {isPointRow && (
                      pointGating.idempotencyKey ? (
                        <PointChargeControl
                          amount={Number(row.amount) || 0}
                          deviceId={pointGating.selectedDeviceId}
                          deviceLabel={deviceLabel}
                          description={concept}
                          externalReference={`combinado-${pointGating.idempotencyKey}-${i}`}
                          idempotencyKey={pointGating.idempotencyKey}
                          paymentMethod={row.method}
                          tenantId={tenantId}
                          userId={user!.id}
                          accessToken={session?.access_token ?? ''}
                          status={rowStatus}
                          onStatusChange={(status) => setRowPointStatus(i, status)}
                          resumeOrderId={i === 0 ? pointGating.resumeOrderId : null}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">Preparando el cobro con Point...</p>
                      )
                    )}
                  </div>
                )
              })}
              {splitRows.length < 3 && (
                <button
                  type="button"
                  onClick={() => setSplitRows((prev) => [...prev, { method: 'transfer', amount: '0' }])}
                  className="text-xs text-plum-800 hover:underline"
                >+ Agregar método de pago</button>
              )}
              <div className={cn(
                'text-xs font-medium tabular-nums',
                splitBalanced ? 'text-green-600' : 'text-amber-600',
              )}>
                Total ingresado: {formatCurrency(splitTotal)} de {formatCurrency(total)}
                {splitBalanced && ' ✓'}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1"
                disabled={pointGating.anyCharging}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={!canConfirm}
                className="flex-1 bg-plum-700 hover:bg-plum-800 text-white"
              >
                {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Cerrando...</> : 'Confirmar cobro'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">{appointments.length} turnos cerrados exitosamente</span>
            </div>

            {Object.keys(invoiceQueue.results).length > 0 && (
              <div className="space-y-1.5">
                {Object.values(invoiceQueue.results).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {r.status === 'pending' && (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Emitiendo factura...</span></>
                    )}
                    {r.status === 'done' && (
                      <><CheckCircle className="w-3.5 h-3.5 text-green-600" /><span className="text-green-700">Factura emitida ✓</span></>
                    )}
                    {r.status === 'error' && (
                      <><AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" /><span className="text-red-600">{r.message}</span></>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!invoiceAnswered ? (
              <>
                <p className="text-sm text-gray-600">¿Querés emitir factura?</p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleWantInvoice}
                    className="flex-1 bg-plum-700 hover:bg-plum-800 text-white gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Sí, emitir factura
                  </Button>
                  <Button onClick={onClose} variant="outline" className="flex-1">
                    No, gracias
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={onClose} className="w-full">
                Cerrar
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    <InvoiceModal
      isOpen={step === 'invoice'}
      onClose={onClose}
      tenantId={tenantId}
      clientName={sharedClientName}
      clientId={sharedClientId}
      amount={cashTxs.reduce((sum, t) => sum + t.amount, 0)}
      concept={concept}
      transactionId={cashTxs[0]?.id}
    />

    <InvoiceTypeChoiceModal
      open={!!invoiceQueue.pendingChoiceTx}
      onCancel={invoiceQueue.cancelChoice}
      onConfirm={invoiceQueue.resolveChoice}
    />
    </>
  )
}

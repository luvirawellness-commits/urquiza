import { useState, useEffect } from 'react'
import { getArgentinaDateString } from '../utils/dateUtils'
import {
  CreditCard, ChevronDown, ChevronUp, X, CheckCircle, Loader2, Users, AlertCircle,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { useClients, useClient } from '@/hooks/useClients'
import { useMembershipPlans, useSellMembership } from '@/hooks/useClientMemberships'
import { useAuth, useTenantId } from '@/contexts/AuthContext'
import InvoiceModal from '@/components/InvoiceModal'
import InvoiceTypeChoiceModal from '@/components/InvoiceTypeChoiceModal'
import { PointChargeControl } from '@/components/PointChargeControl'
import type { MembershipPlan } from '@/types'
import { PAYMENT_METHODS, isElectronicPayment } from '@/lib/paymentMethods'
import { canAccess } from '@/lib/permissions'
import { fetchTransactionsByIds, useElectronicInvoiceQueue, type ResolvedTransaction } from '@/hooks/useAutoInvoice'
import { usePointGatedPayment, type PointChargeStatus } from '@/hooks/usePointGatedPayment'

// Fraud prevention: membership sales had the same hole Stage C.2 closed for
// session closing (Agenda.tsx) — debit/credit/qr could be recorded here with
// no card actually charged. Membership sales are usually standalone (no
// appointment_id — see sell_membership's p_appointment_id, only set when
// sold mid session-close), so like gift cards they need their own
// idempotency key rather than reusing point_charges' appointment-based dedup.
type MembershipSalePayload = {
  titularId: string
  titularName: string
  selectedPlan: MembershipPlan
  beneficiaries: { id: string; name: string }[]
  amount: number
  startDate: string
  soldBy: string
  preSelectedAppointmentId?: string
}

type Props = {
  open: boolean
  onClose: () => void
  preSelectedClientId?: string
  preSelectedAppointmentId?: string
  onSuccess?: (membershipId: string) => void
  restrictToServiceId?: string
  restrictToServiceName?: string
}

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export default function VenderMembresiaModal({
  open, onClose, preSelectedClientId, preSelectedAppointmentId, onSuccess,
  restrictToServiceId, restrictToServiceName,
}: Props) {
  const { user, session, profile } = useAuth()
  const tenantId = useTenantId()
  const today = getArgentinaDateString()
  const hasCajaAccess = canAccess(profile?.role ?? '', 'caja')

  const [phase, setPhase] = useState<'form' | 'confirm' | 'done'>('form')
  const [showInvoice, setShowInvoice] = useState(false)
  const [membershipTx, setMembershipTx] = useState<ResolvedTransaction | null>(null)
  const [invoiceAnswered, setInvoiceAnswered] = useState(false)

  const [titularId, setTitularId] = useState(preSelectedClientId ?? '')
  const [titularSearch, setTitularSearch] = useState('')
  const [showTitularDrop, setShowTitularDrop] = useState(false)

  const [selectedPlan, setSelectedPlan] = useState<MembershipPlan | null>(null)

  const [showBen, setShowBen] = useState(false)
  const [beneficiaries, setBeneficiaries] = useState<{ id: string; name: string }[]>([])
  const [benSearch, setBenSearch] = useState('')
  const [showBenDrop, setShowBenDrop] = useState(false)

  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [startDate, setStartDate] = useState(today)
  const [error, setError] = useState<string | null>(null)

  const { data: plans, isLoading: plansLoading } = useMembershipPlans()
  const { data: titularClients } = useClients(titularSearch.length >= 1 ? titularSearch : undefined)
  const { data: preClient } = useClient(preSelectedClientId ?? '')
  // Resolves the titular directly by id (not just from the search-result
  // list) so a resumed sale after a reload — where titularSearch is empty
  // and titularClients has nothing to find — still shows the right name.
  const { data: resumedTitularClient } = useClient(!preSelectedClientId ? titularId : '')
  const { data: benCandidates } = useClients(benSearch.length >= 2 ? benSearch : undefined)
  const sellMembership = useSellMembership()

  const titular = preSelectedClientId
    ? preClient
    : (titularClients?.find((c) => c.id === titularId) ?? resumedTitularClient)
  const titularName = titular
    ? [titular.first_name, titular.last_name].filter(Boolean).join(' ')
    : ''

  // ── Point gating ─────────────────────────────────────────────────────────
  const [pointStatus, setPointStatus] = useState<PointChargeStatus>('idle')

  function currentPayload(): MembershipSalePayload {
    return {
      titularId,
      titularName,
      selectedPlan: selectedPlan as MembershipPlan,
      beneficiaries,
      amount: Number(amount),
      startDate,
      soldBy: user!.id,
      preSelectedAppointmentId,
    }
  }

  const pointGating = usePointGatedPayment<MembershipSalePayload>({
    tenantId,
    dedupKey: { mode: 'idempotency', flow: 'membership' },
    rows: [{ method: paymentMethod, status: pointStatus }],
    canSubmit: !sellMembership.isPending,
    onAllProcessed: () => void handleSave(),
    // Resume: restore the charge state and the exact sale details captured
    // right before it started. Unlike an appointment, this sale doesn't
    // exist as a DB row yet — after a reload, component state is gone, so
    // without restoring the payload a resumed charge that reaches
    // 'processed' would have nothing valid to submit.
    onResume: (charge, payload) => {
      setPaymentMethod(charge.payment_method)
      setPointStatus('waiting')
      setAmount(String(charge.amount))
      if (payload) {
        setTitularId(payload.titularId)
        setSelectedPlan(payload.selectedPlan)
        setBeneficiaries(payload.beneficiaries)
        setStartDate(payload.startDate)
        setPhase('confirm')
      }
    },
  })
  const isPointGatedMethod = pointGating.isTrackedPointRow(0)
  const pointCharging = pointGating.anyCharging
  const fieldsLocked = pointGating.rowLocked(0)

  // Mints the idempotency key (freezing the sale payload alongside it) once
  // the user reaches the confirm screen with a Point-gated method — nothing
  // in 'confirm' is editable, so unlike the gift card form this only needs
  // to fire once, not stay in sync with further edits.
  useEffect(() => {
    if (phase !== 'confirm' || !isPointGatedMethod || pointStatus !== 'idle') return
    if (!selectedPlan || !titularId) return
    if (!pointGating.idempotencyKey) pointGating.ensureKey(currentPayload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isPointGatedMethod, pointStatus])

  const invoiceQueue = useElectronicInvoiceQueue({ tenantId })
  const stillProcessingInvoice = Object.values(invoiceQueue.results).some((r) => r.status === 'pending')

  const expiresAt = (() => {
    if (!selectedPlan || !startDate) return ''
    const d = new Date(startDate + 'T00:00:00')
    d.setDate(d.getDate() + selectedPlan.validity_days)
    return getArgentinaDateString(d)
  })()

  const sessionsAfterSale = selectedPlan
    ? selectedPlan.sessions_qty - (preSelectedAppointmentId ? 1 : 0)
    : 0

  function handleSelectPlan(plan: MembershipPlan) {
    setSelectedPlan(plan)
    setAmount(String(plan.price))
  }

  function handleAddBeneficiary(id: string, name: string) {
    if (id === titularId || beneficiaries.find((b) => b.id === id)) return
    setBeneficiaries((prev) => [...prev, { id, name }])
    setBenSearch('')
    setShowBenDrop(false)
  }

  function canProceed() {
    return !!titularId && !!selectedPlan && !!amount && Number(amount) > 0
  }

  async function handleSave() {
    if (!selectedPlan || !titularId || !user) return
    setError(null)
    try {
      const { membershipId, transactionId } = await sellMembership.mutateAsync({
        clientId: titularId,
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        sessionsTotal: selectedPlan.sessions_qty,
        validityDays: selectedPlan.validity_days,
        beneficiaryIds: beneficiaries.map((b) => b.id),
        amount: Number(amount),
        paymentMethod,
        startDate,
        soldBy: user.id,
        preSelectedAppointmentId,
        clientName: titularName || undefined,
      })

      // sell_membership only inserts a transaction row (and returns its id)
      // when amount > 0 — nothing to invoice otherwise. The id comes straight
      // from the RPC response, an exact match with no clock-skew race.
      const tx = transactionId ? await fetchTransactionsByIds([transactionId]) : []
      setMembershipTx(tx[0] ?? null)

      setPhase('done')
      onSuccess?.(membershipId)
      pointGating.resetPointState()
      setPointStatus('idle')
    } catch (e) {
      setError((e as Error).message || 'Error al guardar la membresía')
    }
  }

  // Only fires once the user explicitly answers "Sí" to "¿Querés emitir
  // factura?" — electronic payments go through the automatic type-resolution
  // queue (still pauses for the A/B choice on Responsable Inscripto
  // tenants), cash/other payment methods open the manual invoice form.
  function handleWantInvoice() {
    if (!membershipTx) return
    setInvoiceAnswered(true)
    if (isElectronicPayment(membershipTx.payment_method)) {
      void invoiceQueue.startQueue([{
        id: membershipTx.id, amount: membershipTx.amount, paymentMethod: membershipTx.payment_method,
        clientId: membershipTx.client_id, clientName: titularName || 'Consumidor Final',
        concept: `Membresía ${selectedPlan?.name ?? ''}`,
      }])
    } else {
      setShowInvoice(true)
    }
  }

  function handleClose() {
    setPhase('form')
    setTitularId(preSelectedClientId ?? '')
    setTitularSearch('')
    setSelectedPlan(null)
    setBeneficiaries([])
    setBenSearch('')
    setAmount('')
    setPaymentMethod('cash')
    setStartDate(today)
    setError(null)
    setMembershipTx(null)
    setInvoiceAnswered(false)
    pointGating.resetPointState()
    pointGating.setSelectedDeviceId(null)
    setPointStatus('idle')
    onClose()
  }

  function handleVolver() {
    if (pointCharging) return
    pointGating.clearKey()
    setPointStatus('idle')
    setPhase('form')
  }

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => pointGating.handleDialogOpenChange(v, handleClose)}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            {phase === 'done' ? 'Membresía vendida' : 'Vender Membresía'}
          </DialogTitle>
          <DialogDescription>
            {phase === 'form' && 'Completá los datos para registrar la venta.'}
            {phase === 'confirm' && 'Revisá el resumen antes de confirmar.'}
            {phase === 'done' && 'La membresía fue registrada exitosamente.'}
          </DialogDescription>
        </DialogHeader>

        {pointGating.showCloseBlockedMsg && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            No podés cerrar mientras se espera la confirmación del pago con Point.
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-plum-800">
                Membresía {selectedPlan?.name} vendida
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {titularName} · {formatCurrency(Number(amount))}
              </p>
              {preSelectedAppointmentId && (
                <p className="text-sm text-green-700 mt-2 font-medium">
                  Primera sesión consumida. Quedan {sessionsAfterSale} sesiones disponibles.
                </p>
              )}
            </div>
            {Object.keys(invoiceQueue.results).length > 0 && (
              <div className="space-y-1.5">
                {Object.values(invoiceQueue.results).map((r, i) => (
                  <div key={i} className="flex items-center justify-center gap-2 text-sm">
                    {r.status === 'pending' && (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Emitiendo factura...</span></>
                    )}
                    {r.status === 'done' && (
                      <><CheckCircle className="w-3.5 h-3.5 text-green-600" /><span className="text-green-700">Factura emitida ✓</span></>
                    )}
                    {r.status === 'error' && <span className="text-red-600 text-xs">{r.message}</span>}
                  </div>
                ))}
              </div>
            )}

            {hasCajaAccess && membershipTx && !invoiceAnswered ? (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">¿Querés emitir factura?</p>
                <div className="flex gap-2 justify-center">
                  <Button onClick={handleWantInvoice} className="bg-plum-700 hover:bg-plum-800 text-white gap-1.5">
                    Sí, emitir factura
                  </Button>
                  <Button onClick={handleClose} variant="outline">No, gracias</Button>
                </div>
              </div>
            ) : (
              <Button onClick={handleClose} className="mx-auto block px-8" disabled={stillProcessingInvoice}>
                {stillProcessingInvoice ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Emitiendo factura...</> : 'Cerrar'}
              </Button>
            )}
          </div>
        )}

        {/* ── Confirm ── */}
        {phase === 'confirm' && (
          <div className="space-y-5 mt-2">
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
              <h3 className="text-sm font-semibold text-plum-800 mb-1">Resumen de la venta</h3>
              {[
                ['Cliente titular', titularName],
                ['Plan', selectedPlan?.name ?? ''],
                ['Sesiones incluidas', `${selectedPlan?.sessions_qty} sesiones`],
                beneficiaries.length > 0
                  ? ['Beneficiarios', `${beneficiaries.length} adicional${beneficiaries.length !== 1 ? 'es' : ''}`]
                  : null,
                ['Monto a cobrar', formatCurrency(Number(amount))],
                ['Medio de pago', PAYMENT_METHODS.find((p) => p.value === paymentMethod)?.label ?? ''],
                ['Fecha de inicio', startDate ? formatDate(startDate) : '—'],
                ['Vencimiento', expiresAt ? formatDate(expiresAt) : '—'],
                ['Vendido por', profile?.full_name ?? '—'],
              ]
                .filter(Boolean)
                .map((row) => {
                  const [label, value] = row as [string, string]
                  const isMonto = label === 'Monto a cobrar'
                  return (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={cn('font-medium', isMonto && 'font-bold text-plum-800')}>
                        {value}
                      </span>
                    </div>
                  )
                })}
            </div>

            {isPointGatedMethod && pointGating.pointDevices.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Lector Point</Label>
                <select
                  className={SELECT_CLS}
                  value={pointGating.selectedDeviceId ?? ''}
                  disabled={fieldsLocked}
                  onChange={(e) => pointGating.setSelectedDeviceId(e.target.value || null)}
                >
                  <option value="">Seleccionar lector...</option>
                  {pointGating.pointDevices.map((d) => (
                    <option key={d.id} value={d.terminal_id}>{d.label || d.terminal_id}</option>
                  ))}
                </select>
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            {isPointGatedMethod ? (
              <div className="space-y-2">
                {pointGating.idempotencyKey ? (
                  <PointChargeControl
                    amount={Number(amount) || 0}
                    deviceId={pointGating.selectedDeviceId}
                    deviceLabel={pointGating.pointDevices.find((d) => d.terminal_id === pointGating.selectedDeviceId)?.label ?? null}
                    description={`Membresía ${selectedPlan?.name ?? ''}`}
                    externalReference={`membresia-${pointGating.idempotencyKey}`}
                    idempotencyKey={pointGating.idempotencyKey}
                    paymentMethod={paymentMethod}
                    tenantId={tenantId}
                    userId={user!.id}
                    accessToken={session?.access_token ?? ''}
                    status={pointStatus}
                    onStatusChange={setPointStatus}
                    resumeOrderId={pointGating.resumeOrderId}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Preparando el cobro con Point...</p>
                )}
                <Button variant="outline" onClick={handleVolver} className="w-full" disabled={pointCharging}>
                  Volver
                </Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleVolver} className="flex-1"
                  disabled={sellMembership.isPending}>
                  Volver
                </Button>
                <Button onClick={handleSave} className="flex-1" disabled={sellMembership.isPending}>
                  {sellMembership.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Guardando...</>
                    : 'Confirmar venta'}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* ── Form ── */}
        {phase === 'form' && (
          <div className="space-y-6 mt-2">

            {/* Sección 1 — Cliente titular */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-plum-800">Cliente titular</Label>
              {preSelectedClientId ? (
                <div className="px-3 py-2 border rounded-md text-sm bg-plum-50 text-plum-800 font-medium">
                  {titularName || <span className="text-muted-foreground italic">Cargando...</span>}
                </div>
              ) : titularId && titular ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 px-3 py-2 border rounded-md text-sm bg-plum-50 text-plum-800 font-medium">
                    {titularName}
                  </div>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { setTitularId(''); setTitularSearch('') }}>
                    Cambiar
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Buscar cliente por nombre o teléfono..."
                    value={titularSearch}
                    onChange={(e) => { setTitularSearch(e.target.value); setShowTitularDrop(true) }}
                    onFocus={() => setShowTitularDrop(true)}
                    onBlur={() => setTimeout(() => setShowTitularDrop(false), 150)}
                  />
                  {showTitularDrop && titularClients && titularClients.length > 0 && (
                    <div className="absolute z-20 w-full bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {titularClients.slice(0, 8).map((c) => (
                        <button key={c.id} type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-plum-50 hover:text-plum-800 transition-colors border-b last:border-b-0"
                          onMouseDown={() => {
                            setTitularId(c.id)
                            setTitularSearch('')
                            setShowTitularDrop(false)
                          }}>
                          <p className="font-medium">{c.first_name} {c.last_name}</p>
                          {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sección 2 — Plan */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-plum-800">Plan</Label>
              {restrictToServiceId && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5 text-sm text-amber-800">
                  <span className="flex-shrink-0">⚠️</span>
                  <span>
                    Solo se muestran los planes que incluyen <strong>{restrictToServiceName ?? 'este servicio'}</strong>. Los demás están deshabilitados.
                  </span>
                </div>
              )}
              {plansLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !plans || plans.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin planes activos. Crealos en Configuración.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {plans.map((plan) => {
                    const isSelected = selectedPlan?.id === plan.id
                    const isAllowed = !restrictToServiceId ||
                      plan.allowed_service_ids == null ||
                      plan.allowed_service_ids.includes(restrictToServiceId)
                    const pricePerSes = plan.sessions_qty > 0
                      ? Math.round(plan.price / plan.sessions_qty)
                      : 0
                    return (
                      <div
                        key={plan.id}
                        onClick={() => isAllowed && !pointCharging && handleSelectPlan(plan)}
                        className={cn(
                          'relative flex flex-col gap-1 p-3 rounded-xl border-2 transition-all',
                          isAllowed && !pointCharging
                            ? 'cursor-pointer hover:border-plum-400'
                            : 'opacity-50 cursor-not-allowed',
                          isSelected
                            ? 'border-plum-800 bg-plum-50 shadow-sm'
                            : 'border-gray-200 bg-white',
                        )}
                      >
                        {plan.highlight_badge && (
                          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-plum-800 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap">
                            {plan.highlight_badge}
                          </span>
                        )}
                        <p className={cn('font-bold text-sm mt-1', plan.highlight_badge && 'mt-2')}>
                          {plan.name}
                        </p>
                        <p className="text-base font-bold text-plum-800 tabular-nums">
                          {formatCurrency(plan.price)}
                        </p>
                        <p className="text-xs text-muted-foreground">{plan.sessions_qty} ses. de 60 min</p>
                        {pricePerSes > 0 && (
                          <p className="text-xs text-muted-foreground">{formatCurrency(pricePerSes)}/sesión</p>
                        )}
                        <p className="text-xs text-muted-foreground">{plan.validity_days} días</p>
                        {isAllowed ? (
                          <div className={cn(
                            'mt-1.5 py-1 rounded-md text-center text-xs font-medium transition-colors',
                            isSelected ? 'bg-plum-800 text-white' : 'bg-gray-100 text-gray-600',
                          )}>
                            {isSelected ? '✓ Seleccionado' : 'Seleccionar'}
                          </div>
                        ) : (
                          <div className="mt-1.5 py-1 rounded-md text-center text-xs font-medium bg-red-50 text-red-500 border border-red-100">
                            No incluye este servicio
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Sección 3 — Beneficiarios */}
            <div className="space-y-2">
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-plum-800 hover:text-plum-600 transition-colors"
                onClick={() => setShowBen((v) => !v)}
              >
                <Users className="w-4 h-4" />
                Agregar beneficiarios
                <Badge variant="outline" className="text-xs font-normal">
                  {beneficiaries.length + 1}/10
                </Badge>
                {showBen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showBen && (
                <div className="border rounded-xl p-3 space-y-3 bg-gray-50">
                  <p className="text-xs text-muted-foreground">
                    El titular se agrega automáticamente. Podés sumar hasta 9 beneficiarios adicionales.
                  </p>

                  {beneficiaries.length > 0 && (
                    <div className="space-y-1.5">
                      {beneficiaries.map((b) => (
                        <div key={b.id}
                          className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border">
                          <span className="text-sm">{b.name}</span>
                          <button
                            type="button"
                            onClick={() => setBeneficiaries((prev) => prev.filter((x) => x.id !== b.id))}
                            className="text-muted-foreground hover:text-red-500 transition-colors ml-2"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {beneficiaries.length < 9 && (
                    <div className="relative">
                      <Input
                        placeholder="Buscar cliente para agregar..."
                        value={benSearch}
                        onChange={(e) => { setBenSearch(e.target.value); setShowBenDrop(true) }}
                        onFocus={() => setShowBenDrop(true)}
                        onBlur={() => setTimeout(() => setShowBenDrop(false), 150)}
                      />
                      {showBenDrop && benCandidates && benCandidates.length > 0 && (
                        <div className="absolute z-20 w-full bg-white border rounded-md shadow-lg mt-1 max-h-40 overflow-y-auto">
                          {benCandidates
                            .filter(
                              (c) =>
                                c.id !== titularId && !beneficiaries.find((b) => b.id === c.id),
                            )
                            .slice(0, 6)
                            .map((c) => (
                              <button key={c.id} type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-plum-50 hover:text-plum-800 transition-colors border-b last:border-b-0"
                                onMouseDown={() =>
                                  handleAddBeneficiary(
                                    c.id,
                                    [c.first_name, c.last_name].filter(Boolean).join(' '),
                                  )
                                }>
                                <p className="font-medium">{c.first_name} {c.last_name}</p>
                                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Sección 4 — Pago */}
            <div className="space-y-3">
              <Label className="text-sm font-semibold text-plum-800">Pago</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Monto</Label>
                  <Input
                    type="number" min="0" step="1" placeholder="0"
                    value={amount}
                    disabled={pointCharging}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Medio de pago</Label>
                  <select className={SELECT_CLS} value={paymentMethod} disabled={pointCharging}
                    onChange={(e) => setPaymentMethod(e.target.value)}>
                    {PAYMENT_METHODS.map((pm) => (
                      <option key={pm.value} value={pm.value}>{pm.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Fecha de inicio</Label>
                  <Input type="date" value={startDate} disabled={pointCharging}
                    onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Vendido por</Label>
                  <div className="px-3 py-2 border rounded-md text-sm bg-gray-50 text-muted-foreground h-9 flex items-center">
                    {profile?.full_name ?? '—'}
                  </div>
                </div>
              </div>
              {selectedPlan && expiresAt && (
                <p className="text-xs text-muted-foreground">
                  Vencimiento: {formatDate(expiresAt)}
                  {preSelectedAppointmentId && (
                    <span className="ml-2 text-amber-600">
                      · Primera sesión se descuenta al confirmar
                    </span>
                  )}
                </p>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={handleClose} className="flex-1">
                Cancelar
              </Button>
              <Button onClick={() => setPhase('confirm')} className="flex-1" disabled={!canProceed()}>
                Revisar y confirmar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <InvoiceModal
      isOpen={showInvoice}
      onClose={() => { setShowInvoice(false); handleClose() }}
      tenantId={tenantId}
      clientName={titularName || 'Consumidor Final'}
      clientId={titularId || undefined}
      amount={Number(amount)}
      concept={`Membresía ${selectedPlan?.name ?? ''}`}
      transactionId={membershipTx?.id}
    />

    <InvoiceTypeChoiceModal
      open={!!invoiceQueue.pendingChoiceTx}
      onCancel={invoiceQueue.cancelChoice}
      onConfirm={invoiceQueue.resolveChoice}
    />
    </>
  )
}

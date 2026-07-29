import { useState, useEffect, useRef } from 'react'
import { getArgentinaDateString } from '../utils/dateUtils'
import { Gift, Loader2, Download, FileText } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import InvoiceModal from '@/components/InvoiceModal'
import InvoiceTypeChoiceModal from '@/components/InvoiceTypeChoiceModal'
import { PointChargeControl } from '@/components/PointChargeControl'
import { useServices, useTherapists } from '@/hooks/useAppointments'
import { useGiftCards, useCreateGiftCard, GiftCard } from '@/hooks/useGiftCards'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn, formatCurrency, formatDate, exportToExcel } from '@/lib/utils'
import { CARD_BASE64 } from '@/lib/cardBase64'
import { PAYMENT_METHODS, isElectronicPayment } from '@/lib/paymentMethods'
import { canAccess } from '@/lib/permissions'
import { fetchTransactionsByIds, useElectronicInvoiceQueue, type ResolvedTransaction, type QueuedInvoiceStatus } from '@/hooks/useAutoInvoice'
import {
  useActivePointDevices, usePendingPointCharge, usePointSalePersistence,
  POINT_ONLY_METHODS, type PointChargeStatus,
} from '@/hooks/useMercadoPagoPoint'
const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function defaultExpiry(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 6)
  return getArgentinaDateString(d)
}

type GeneratedGiftCard = {
  code: string
  serviceName: string
  duration: number
  recipientName: string
  senderName: string
  message: string
  imageDataUrl: string
  tenantName: string
}

// ── Canvas generator ───────────────────────────────────────────────────────────
async function generateGiftCardImage(
  serviceName: string,
  durationMinutes: number,
  recipientName: string,
  code: string,
  whatsapp: string,
  senderName?: string,
  message?: string,
  tenantConfig?: { name: string; slug: string },
): Promise<string> {
  const isLuvira =
    !tenantConfig ||
    tenantConfig.slug.toLowerCase().includes('luvira') ||
    tenantConfig.name.toLowerCase().includes('luvira')

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1050
    canvas.height = 600
    const ctx = canvas.getContext('2d')!

    if (isLuvira) {
      // ── Luvira branded: overlay text on background image ──────────────────
      const bg = new Image()
      bg.onload = () => {
        ctx.drawImage(bg, 0, 0, 1050, 600)
        ctx.textAlign = 'center'
        ctx.fillStyle = '#E8D5E8'
        ctx.font = 'italic 20px Georgia, serif'
        ctx.fillText('Vale por: ' + serviceName + ' · ' + durationMinutes + ' minutos', 560, 445)
        ctx.fillStyle = '#FFFFFF'
        ctx.font = 'bold 19px Georgia, serif'
        ctx.fillText('A nombre de: ' + recipientName, 560, 475)
        if (message) {
          ctx.fillStyle = '#E8D5E8'
          ctx.font = 'italic 15px Georgia, serif'
          ctx.fillText('"' + message + '"', 560, 501)
        }
        if (senderName && message) {
          ctx.fillStyle = '#D4A0D4'
          ctx.font = 'italic 13px Georgia, serif'
          ctx.fillText('Con cariño de: ' + senderName, 560, 522)
        }
        const hasBoth = !!(senderName && message)
        const codigoY = hasBoth ? 547 : message ? 529 : senderName ? 505 : 480
        ctx.fillStyle = '#D4AF37'
        ctx.font = 'bold 16px Georgia, serif'
        ctx.fillText('Código de tarjeta: ' + code, 560, codigoY)
        ctx.fillStyle = '#E8D5E8'
        ctx.font = '14px Georgia, serif'
        ctx.fillText('Reservar por WhatsApp al ' + whatsapp, 560, codigoY + 26)
        resolve(canvas.toDataURL('image/png'))
      }
      bg.onerror = () => resolve(canvas.toDataURL('image/png'))
      bg.src = CARD_BASE64
    } else {
      // ── Generic branded: draw from scratch ────────────────────────────────
      const tenantName = tenantConfig!.name

      // Background gradient: bordeaux → deep purple → near-black
      const grad = ctx.createLinearGradient(0, 0, 1050, 600)
      grad.addColorStop(0,   '#3D0E1A')
      grad.addColorStop(0.6, '#2a0d3d')
      grad.addColorStop(1,   '#1a0820')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, 1050, 600)

      // Outer gold border
      ctx.strokeStyle = '#C9A227'
      ctx.lineWidth = 4
      ctx.strokeRect(18, 18, 1014, 564)

      // Inner subtle border
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.35)'
      ctx.lineWidth = 1
      ctx.strokeRect(28, 28, 994, 544)

      ctx.textAlign = 'center'

      // Tenant name — truncate if wider than 900px
      ctx.fillStyle = '#C9A227'
      ctx.font = 'bold 52px Georgia, serif'
      let displayName = tenantName
      while (ctx.measureText(displayName).width > 900 && displayName.length > 4) {
        displayName = displayName.slice(0, -1)
      }
      if (displayName !== tenantName) displayName += '…'
      ctx.fillText(displayName, 525, 120)

      // Subtitle
      ctx.fillStyle = 'rgba(232, 213, 232, 0.85)'
      ctx.font = '20px Georgia, serif'
      ctx.fillText('TARJETA  DE  REGALO', 525, 163)

      // Gold divider with small diamond accents
      ctx.strokeStyle = '#C9A227'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(160, 186); ctx.lineTo(890, 186); ctx.stroke()
      ctx.fillStyle = '#C9A227'
      for (const x of [160, 525, 890]) {
        ctx.beginPath()
        ctx.moveTo(x, 181); ctx.lineTo(x + 5, 186)
        ctx.lineTo(x, 191); ctx.lineTo(x - 5, 186)
        ctx.closePath(); ctx.fill()
      }

      // Service + duration
      ctx.fillStyle = '#E8D5E8'
      ctx.font = 'italic 22px Georgia, serif'
      ctx.fillText('Vale por: ' + serviceName + ' · ' + durationMinutes + ' minutos', 525, 248)

      // Recipient
      ctx.fillStyle = '#FFFFFF'
      ctx.font = 'bold 20px Georgia, serif'
      ctx.fillText('A nombre de: ' + recipientName, 525, 295)

      let nextY = 338
      if (message) {
        ctx.fillStyle = '#E8D5E8'
        ctx.font = 'italic 16px Georgia, serif'
        ctx.fillText('"' + message + '"', 525, nextY)
        nextY += 34
      }
      if (senderName && message) {
        ctx.fillStyle = '#D4A0D4'
        ctx.font = 'italic 14px Georgia, serif'
        ctx.fillText('Con cariño de: ' + senderName, 525, nextY)
        nextY += 30
      }

      // Second divider
      const divY = Math.max(nextY + 18, 415)
      ctx.strokeStyle = 'rgba(201, 162, 39, 0.5)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(160, divY); ctx.lineTo(890, divY); ctx.stroke()

      // Code
      ctx.fillStyle = '#C9A227'
      ctx.font = 'bold 20px Georgia, serif'
      ctx.fillText('Código: ' + code, 525, divY + 52)

      // WhatsApp
      if (whatsapp) {
        ctx.fillStyle = '#E8D5E8'
        ctx.font = '15px Georgia, serif'
        ctx.fillText('Reservar por WhatsApp al ' + whatsapp, 525, divY + 88)
      }

      resolve(canvas.toDataURL('image/png'))
    }
  })
}
// ── Gift card image modal ──────────────────────────────────────────────────────
function GiftCardImageModal({
  gc, onClose, onInvoice, invoiceStatus,
}: {
  gc: GeneratedGiftCard
  onClose: () => void
  onInvoice?: () => void
  invoiceStatus?: QueuedInvoiceStatus | null
}) {
  function handleDownload() {
    const a = document.createElement('a')
    a.href = gc.imageDataUrl
    a.download = `GiftCard-${gc.tenantName.replace(/\s+/g, '-')}-${gc.code}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5" /> ¡Gift Card generada!
          </DialogTitle>
          <DialogDescription>
            A nombre de {gc.recipientName} · Código:{' '}
            <span className="font-mono font-semibold">{gc.code}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 rounded-lg overflow-hidden border">
          <img src={gc.imageDataUrl} alt={`Gift Card ${gc.tenantName}`} style={{ width: '100%', borderRadius: '8px' }} />
        </div>

        {invoiceStatus && (
          <div className="flex items-center gap-2 text-sm">
            {invoiceStatus.status === 'pending' && (
              <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Emitiendo factura...</span></>
            )}
            {invoiceStatus.status === 'done' && (
              <><span className="text-green-700">Factura emitida ✓</span></>
            )}
            {invoiceStatus.status === 'error' && (
              <span className="text-red-600">{invoiceStatus.message}</span>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-2">
          <Button onClick={handleDownload} className="flex-1 gap-2">
            <Download className="w-4 h-4" /> Descargar Gift Card
          </Button>
          {onInvoice && (
            <Button onClick={onInvoice} variant="outline" className="flex-1 gap-2">
              <FileText className="w-4 h-4" /> Emitir factura
            </Button>
          )}
          <Button onClick={onClose} variant="outline" className="flex-1">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Sale form ──────────────────────────────────────────────────────────────────

// Fraud prevention: gift cards had the same hole Stage C.2 closed for
// session closing (Agenda.tsx) — debit/credit/qr could be recorded via this
// dropdown with no card actually charged. This mirrors that fix: whenever
// the tenant has an active Point reader, those methods must go through it.
// Gift cards don't exist as a DB row until after the sale completes, so
// there's no appointment_id-like anchor for point_charges' dedup/resume —
// GiftCardSalePayload is what usePointSalePersistence persists instead, so
// a reload mid-charge can still resume with the exact sale details intact.
type GiftCardSalePayload = {
  service_id: string
  service_name: string
  duration_minutes: 60 | 90
  amount: number
  sold_by: string
  expires_at: string
  notes: string
  user_id: string
  recipient_name: string
  sender_name: string
  message: string
}

function GiftCardForm() {
  const { user, session, profile } = useAuth()
  const tenantId = useTenantId()
  const { data: services } = useServices()
  const { data: therapists } = useTherapists()
  const createGC = useCreateGiftCard()
  const hasCajaAccess = canAccess(profile?.role ?? '', 'caja')

  const [serviceId, setServiceId] = useState('')
  const [duration, setDuration] = useState<60 | 90>(60)
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [soldBy, setSoldBy] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiry)
  const [notes, setNotes] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [senderName, setSenderName] = useState('')
  const [message, setMessage] = useState('')
  const [generatedGC, setGeneratedGC] = useState<GeneratedGiftCard | null>(null)
  const [invoiceCandidate, setInvoiceCandidate] = useState<
    { tx: ResolvedTransaction; clientName: string; concept: string } | null
  >(null)
  const [showInvoice, setShowInvoice] = useState(false)
  const [autoInvoiceTxId, setAutoInvoiceTxId] = useState<string | null>(null)

  const invoiceQueue = useElectronicInvoiceQueue({ tenantId })

  const selectedService = services?.find((s) => s.id === serviceId)

  // ── Point gating ─────────────────────────────────────────────────────────
  const { data: pointDevices = [] } = useActivePointDevices(tenantId)
  const hasActivePointDevices = pointDevices.length > 0
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [pointStatus, setPointStatus] = useState<PointChargeStatus>('idle')
  const [resumeOrderId, setResumeOrderId] = useState<string | null>(null)
  const resumeAppliedRef = useRef(false)

  const { idempotencyKey, resumedPayload, ensureKey, syncPayload, clearKey } =
    usePointSalePersistence<GiftCardSalePayload>('gift_card', tenantId)
  const { data: pendingCharge } = usePendingPointCharge({ idempotencyKey })

  useEffect(() => {
    if (pointDevices.length === 1) setSelectedDeviceId(pointDevices[0].terminal_id)
  }, [pointDevices])

  // A resumed row must stay tracked even if devices were deactivated in the
  // meantime, mirroring Agenda.tsx's isTrackedPointRow — same reasoning: an
  // in-flight charge from before must never silently stop being gated.
  const isPointGatedMethod = (hasActivePointDevices || !!resumeOrderId) && POINT_ONLY_METHODS.includes(paymentMethod)
  const fieldsLocked = isPointGatedMethod && pointStatus !== 'idle'

  function currentPayload(): GiftCardSalePayload {
    return {
      service_id: serviceId,
      service_name: selectedService?.name ?? 'Servicio',
      duration_minutes: duration,
      amount: Number(amount),
      sold_by: soldBy,
      expires_at: expiresAt,
      notes,
      user_id: user!.id,
      recipient_name: recipientName.trim(),
      sender_name: senderName.trim(),
      message: message.trim(),
    }
  }

  // Resume: restore both the charge state and the exact form values
  // captured right before the charge started. After a reload, React state
  // is gone — without restoring the payload too, a resumed charge that
  // reaches 'processed' would have nothing valid to submit.
  useEffect(() => {
    if (resumeAppliedRef.current || !pendingCharge) return
    resumeAppliedRef.current = true
    setPaymentMethod(pendingCharge.payment_method)
    setPointStatus('waiting')
    setSelectedDeviceId(pendingCharge.terminal_id)
    setResumeOrderId(pendingCharge.mp_order_id)
    if (resumedPayload) {
      setServiceId(resumedPayload.service_id)
      setDuration(resumedPayload.duration_minutes)
      setAmount(String(resumedPayload.amount))
      setSoldBy(resumedPayload.sold_by)
      setExpiresAt(resumedPayload.expires_at)
      setNotes(resumedPayload.notes)
      setRecipientName(resumedPayload.recipient_name)
      setSenderName(resumedPayload.sender_name)
      setMessage(resumedPayload.message)
    }
  }, [pendingCharge, resumedPayload])

  // Mints the idempotency key (freezing the sale payload alongside it) the
  // moment the form becomes Point-gated, then keeps the persisted payload in
  // sync with live edits until the charge actually starts — past that point
  // the fields are locked (fieldsLocked), so the last-synced snapshot can
  // never go stale relative to what submitGiftCard() will actually send.
  useEffect(() => {
    if (!isPointGatedMethod || pointStatus !== 'idle') return
    if (!serviceId || !amount || !recipientName.trim()) return
    if (!idempotencyKey) ensureKey(currentPayload())
    else syncPayload(currentPayload())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPointGatedMethod, pointStatus, serviceId, duration, amount, soldBy, expiresAt, notes, recipientName, senderName, message])

  // Best-effort defense-in-depth: GiftCardForm is a page, not a Dialog, so
  // there's no onOpenChange to block navigation through the way
  // AppointmentDetailModal does for session closing — the real guarantee is
  // still the point_charges dedup + resume above, this just discourages an
  // accidental tab close while a charge is actually in flight.
  useEffect(() => {
    if (pointStatus !== 'creating' && pointStatus !== 'waiting') return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [pointStatus])

  function applyServicePrice(sid: string, dur: 60 | 90) {
    const svc = services?.find((s) => s.id === sid)
    if (!svc) return
    setAmount(String(dur === 90 ? (svc.price_90 ?? svc.price_60 ?? '') : (svc.price_60 ?? '')))
  }

  function handleServiceChange(sid: string) {
    setServiceId(sid)
    applyServicePrice(sid, duration)
  }

  function handleDurationChange(d: 60 | 90) {
    setDuration(d)
    if (serviceId) applyServicePrice(serviceId, d)
  }

  async function submitGiftCard() {
    if (!serviceId || !amount || !recipientName.trim()) return
    try {
      const result = await createGC.mutateAsync({
        service_id: serviceId,
        service_name: selectedService?.name ?? 'Servicio',
        duration_minutes: duration,
        amount: Number(amount),
        payment_method: paymentMethod,
        sold_by: soldBy,
        expires_at: expiresAt,
        notes,
        user_id: user!.id,
        recipient_name: recipientName.trim(),
        sender_name: senderName.trim(),
        message: message.trim(),
      })

      // create_gift_card returns the id of the transaction it just created —
      // an exact id, not a time-based query, so no clock-skew race is
      // possible. Capture clientName/concept now, before the form resets.
      if (tenantId && hasCajaAccess) {
        const [tx] = await fetchTransactionsByIds([result.transaction_id])
        if (tx) {
          setInvoiceCandidate({
            tx,
            clientName: recipientName.trim() || 'Consumidor Final',
            concept: `Gift Card #${result.code}`,
          })
        }
      }

      const { data: tenantData } = await supabase
        .from('tenants')
        .select('whatsapp_number, name, slug')
        .eq('id', tenantId)
        .single()

      const td = tenantData as { whatsapp_number?: string | null; name?: string | null; slug?: string | null } | null
      const tenantConfig = td?.name && td?.slug
        ? { name: td.name, slug: td.slug }
        : undefined

      const imageDataUrl = await generateGiftCardImage(
        selectedService?.name ?? 'Servicio',
        duration,
        recipientName.trim(),
        result.code,
        td?.whatsapp_number ?? '',
        senderName.trim() || undefined,
        message.trim() || undefined,
        tenantConfig,
      )

      setGeneratedGC({
        code: result.code,
        serviceName: selectedService?.name ?? 'Servicio',
        duration,
        recipientName: recipientName.trim(),
        senderName: senderName.trim(),
        message: message.trim(),
        imageDataUrl,
        tenantName: td?.name ?? 'GiftCard',
      })
      setServiceId(''); setAmount(''); setPaymentMethod('cash'); setSoldBy('')
      setNotes(''); setDuration(60); setExpiresAt(defaultExpiry())
      setRecipientName(''); setSenderName(''); setMessage('')
      clearKey()
      setPointStatus('idle')
      setResumeOrderId(null)
      resumeAppliedRef.current = false
    } catch (_) { /* error shown below */ }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Point-gated submission is driven by the auto-confirm effect below,
    // once the charge itself reports 'processed' — not by this click.
    if (isPointGatedMethod) return
    void submitGiftCard()
  }

  // Auto-fire the sale the instant Point reports processed — mirrors
  // CerrarSesionStep's pointRowsReady auto-confirm effect (Stage C.2 Part
  // 5): leaving this unconfirmed after a successful charge would mean the
  // money is collected but no gift card ever recorded, and a later retry
  // could double-charge since the dedup guard only blocks while a charge is
  // still 'created'.
  const prevProcessedRef = useRef(false)
  useEffect(() => {
    const wasProcessed = prevProcessedRef.current
    const isProcessed = pointStatus === 'processed'
    prevProcessedRef.current = isProcessed
    if (!wasProcessed && isProcessed && !createGC.isPending) {
      void submitGiftCard()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointStatus])

  // Only fires once the user explicitly clicks "Emitir factura" — electronic
  // payments go through the automatic type-resolution queue (still pauses
  // for the A/B choice on Responsable Inscripto tenants) while the gift card
  // image stays open; cash/other payment methods open the manual invoice form.
  function handleInvoiceClick() {
    if (!invoiceCandidate) return
    const { tx, clientName, concept } = invoiceCandidate
    if (isElectronicPayment(tx.payment_method)) {
      setAutoInvoiceTxId(tx.id)
      void invoiceQueue.startQueue([{
        id: tx.id, amount: tx.amount, paymentMethod: tx.payment_method, clientId: tx.client_id,
        clientName, concept,
      }])
    } else {
      setGeneratedGC(null)
      setShowInvoice(true)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-plum-800 flex items-center gap-2">
            <Gift className="w-4 h-4" /> Vender Gift Card
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Servicio *</Label>
                <select className={selectCls} value={serviceId} disabled={fieldsLocked}
                  onChange={(e) => handleServiceChange(e.target.value)} required>
                  <option value="">Seleccionar servicio</option>
                  {services?.map((s) => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Duración *</Label>
                <select className={selectCls} value={duration} disabled={fieldsLocked}
                  onChange={(e) => handleDurationChange(Number(e.target.value) as 60 | 90)}>
                  <option value={60}>60 minutos</option>
                  <option value={90}>90 minutos</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Precio *</Label>
                <Input type="number" min="0" step="1" value={amount} disabled={fieldsLocked}
                  onChange={(e) => setAmount(e.target.value)} required placeholder="0" />
              </div>

              <div className="space-y-1.5">
                <Label>Método de pago *</Label>
                <select className={selectCls} value={paymentMethod} disabled={fieldsLocked}
                  onChange={(e) => setPaymentMethod(e.target.value)} required>
                  {PAYMENT_METHODS.map((pm) => (
                    <option key={pm.value} value={pm.value}>{pm.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Vendido por</Label>
                <select className={selectCls} value={soldBy} disabled={fieldsLocked}
                  onChange={(e) => setSoldBy(e.target.value)}>
                  <option value="">Sin asignar</option>
                  {therapists?.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Vencimiento</Label>
                <Input type="date" value={expiresAt} disabled={fieldsLocked}
                  onChange={(e) => setExpiresAt(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Input placeholder="Opcional" value={notes} disabled={fieldsLocked}
                  onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <Label>A nombre de *</Label>
                <Input
                  required
                  disabled={fieldsLocked}
                  placeholder="Nombre y apellido del destinatario"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>De parte de</Label>
                <Input
                  disabled={fieldsLocked}
                  placeholder="¿Quién la regala? (opcional)"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Mensaje</Label>
                <Input
                  disabled={fieldsLocked}
                  placeholder="Mensaje personal (opcional)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            </div>

            {isPointGatedMethod && pointDevices.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Lector Point</Label>
                <select
                  className={selectCls}
                  value={selectedDeviceId ?? ''}
                  disabled={fieldsLocked}
                  onChange={(e) => setSelectedDeviceId(e.target.value || null)}
                >
                  <option value="">Seleccionar lector...</option>
                  {pointDevices.map((d) => (
                    <option key={d.id} value={d.terminal_id}>{d.label || d.terminal_id}</option>
                  ))}
                </select>
              </div>
            )}

            {isPointGatedMethod ? (
              idempotencyKey ? (
                <PointChargeControl
                  amount={Number(amount) || 0}
                  deviceId={selectedDeviceId}
                  deviceLabel={pointDevices.find((d) => d.terminal_id === selectedDeviceId)?.label ?? null}
                  description={`Gift Card${selectedService ? ` — ${selectedService.name}` : ''}`}
                  externalReference={`giftcard-${idempotencyKey}`}
                  idempotencyKey={idempotencyKey}
                  paymentMethod={paymentMethod}
                  tenantId={tenantId}
                  userId={user!.id}
                  accessToken={session?.access_token ?? ''}
                  status={pointStatus}
                  onStatusChange={setPointStatus}
                  resumeOrderId={resumeOrderId}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Completá los datos de la venta para cobrar con Point.</p>
              )
            ) : (
              <Button type="submit" className="w-full gap-2"
                disabled={createGC.isPending || !serviceId || !amount || !recipientName.trim()}>
                {createGC.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</>
                  : <><Gift className="w-4 h-4" /> Generar Gift Card</>}
              </Button>
            )}

            {createGC.isError && (
              <p className="text-sm text-red-600 text-center">
                {(createGC.error as Error).message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {generatedGC && (
        <GiftCardImageModal
          gc={generatedGC}
          onClose={() => { setGeneratedGC(null); setAutoInvoiceTxId(null); setInvoiceCandidate(null) }}
          onInvoice={invoiceCandidate && !autoInvoiceTxId ? handleInvoiceClick : undefined}
          invoiceStatus={autoInvoiceTxId ? invoiceQueue.results[autoInvoiceTxId] : null}
        />
      )}

      {invoiceCandidate && (
        <InvoiceModal
          isOpen={showInvoice}
          onClose={() => { setShowInvoice(false); setInvoiceCandidate(null) }}
          tenantId={tenantId}
          clientName={invoiceCandidate.clientName}
          amount={invoiceCandidate.tx.amount}
          concept={invoiceCandidate.concept}
          transactionId={invoiceCandidate.tx.id}
        />
      )}

      <InvoiceTypeChoiceModal
        open={!!invoiceQueue.pendingChoiceTx}
        onCancel={invoiceQueue.cancelChoice}
        onConfirm={invoiceQueue.resolveChoice}
      />
    </>
  )
}

// ── Status helpers ─────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<GiftCard['status'], string> = {
  active: 'bg-green-100 text-green-700 border-green-200',
  used: 'bg-gray-100 text-gray-600 border-gray-200',
  expired: 'bg-red-100 text-red-700 border-red-200',
}
const STATUS_LABEL: Record<GiftCard['status'], string> = {
  active: 'Activa',
  used: 'Usada',
  expired: 'Vencida',
}

// ── List ───────────────────────────────────────────────────────────────────────
function GiftCardList() {
  const { data: giftCards, isLoading } = useGiftCards()

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-plum-800">
            Historial ({giftCards?.length ?? 0})
          </CardTitle>
          {giftCards && giftCards.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportToExcel(
                  giftCards.map((gc) => ({
                    'Código': gc.code,
                    'Servicio': gc.service?.name ?? '',
                    'Destinatario': gc.recipient_name ?? '',
                    'Monto': gc.amount,
                    'Vendida': gc.sold_at ? formatDate(gc.sold_at) : '',
                    'Vence': gc.expires_at ? formatDate(gc.expires_at) : '',
                    'Estado': STATUS_LABEL[gc.status] ?? gc.status,
                    'Usado por': gc.used_by
                      ? `${gc.used_by.first_name} ${gc.used_by.last_name ?? ''}`.trim()
                      : '',
                  })),
                  'giftcards.xlsx',
                  'Gift Cards',
                )
              }
            >
              <Download className="w-4 h-4 mr-1.5" />
              Exportar Excel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-6 h-6 animate-spin text-plum-800" />
          </div>
        ) : !giftCards || giftCards.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <Gift className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Sin gift cards todavía</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b bg-gray-50">
                  {['Código', 'Servicio', 'Destinatario', 'Monto', 'Vendida', 'Vence', 'Estado', 'Usado por'].map((h) => (
                    <th key={h}
                      className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {giftCards.map((gc) => (
                  <tr key={gc.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-semibold text-plum-800 whitespace-nowrap">
                        {gc.code}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-plum-800 whitespace-nowrap">
                        {gc.service?.emoji} {gc.service?.name ?? '—'}
                      </p>
                      <p className="text-xs text-muted-foreground">{gc.duration_minutes} min</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-plum-800 whitespace-nowrap">
                        {gc.recipient_name ?? '—'}
                      </p>
                      {gc.sender_name && (
                        <p className="text-xs text-muted-foreground">de {gc.sender_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium tabular-nums text-plum-800 whitespace-nowrap">
                      {formatCurrency(gc.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {formatDate(gc.sold_at)}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {gc.expires_at ? formatDate(gc.expires_at) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'text-xs font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap',
                        STATUS_BADGE[gc.status],
                      )}>
                        {STATUS_LABEL[gc.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                      {gc.used_by
                        ? `${gc.used_by.first_name} ${gc.used_by.last_name ?? ''}`.trim()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function GiftCards() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Gift Cards</h1>
        <p className="text-muted-foreground text-sm mt-1">Venta y seguimiento de gift cards</p>
      </div>
      <GiftCardForm />
      <GiftCardList />
    </div>
  )
}

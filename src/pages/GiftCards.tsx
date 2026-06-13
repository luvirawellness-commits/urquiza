import { useState } from 'react'
import { Gift, Loader2, Download } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
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
const selectCls =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function defaultExpiry(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 6)
  return d.toISOString().split('T')[0]
}

type GeneratedGiftCard = {
  code: string
  serviceName: string
  duration: number
  recipientName: string
  senderName: string
  message: string
  imageDataUrl: string
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
): Promise<string> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1050
    canvas.height = 600
    const ctx = canvas.getContext('2d')!
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
  })
}
// ── Gift card image modal ──────────────────────────────────────────────────────
function GiftCardImageModal({ gc, onClose }: { gc: GeneratedGiftCard; onClose: () => void }) {
  function handleDownload() {
    const a = document.createElement('a')
    a.href = gc.imageDataUrl
    a.download = `GiftCard-Luvira-${gc.code}.png`
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
          <img src={gc.imageDataUrl} alt="Gift Card Luvira" style={{ width: '100%', borderRadius: '8px' }} />
        </div>

        <div className="flex gap-2 mt-2">
          <Button onClick={handleDownload} className="flex-1 gap-2">
            <Download className="w-4 h-4" /> Descargar Gift Card
          </Button>
          <Button onClick={onClose} variant="outline" className="flex-1">
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Sale form ──────────────────────────────────────────────────────────────────
function GiftCardForm() {
  const { user } = useAuth()
  const tenantId = useTenantId()
  const { data: services } = useServices()
  const { data: therapists } = useTherapists()
  const createGC = useCreateGiftCard()

  const [serviceId, setServiceId] = useState('')
  const [duration, setDuration] = useState<60 | 90>(60)
  const [amount, setAmount] = useState('')
  const [soldBy, setSoldBy] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiry)
  const [notes, setNotes] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [senderName, setSenderName] = useState('')
  const [message, setMessage] = useState('')
  const [generatedGC, setGeneratedGC] = useState<GeneratedGiftCard | null>(null)

  const selectedService = services?.find((s) => s.id === serviceId)

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!serviceId || !amount || !recipientName.trim()) return
    try {
      const result = await createGC.mutateAsync({
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
      })

      const { data: tenantData } = await supabase
        .from('tenants')
        .select('whatsapp_number')
        .eq('id', tenantId)
        .single()

      const imageDataUrl = await generateGiftCardImage(
        selectedService?.name ?? 'Servicio',
        duration,
        recipientName.trim(),
        result.code,
        (tenantData as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? '',
        senderName.trim() || undefined,
        message.trim() || undefined,
      )

      setGeneratedGC({
        code: result.code,
        serviceName: selectedService?.name ?? 'Servicio',
        duration,
        recipientName: recipientName.trim(),
        senderName: senderName.trim(),
        message: message.trim(),
        imageDataUrl,
      })
      setServiceId(''); setAmount(''); setSoldBy('')
      setNotes(''); setDuration(60); setExpiresAt(defaultExpiry())
      setRecipientName(''); setSenderName(''); setMessage('')
    } catch (_) { /* error shown below */ }
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
                <select className={selectCls} value={serviceId}
                  onChange={(e) => handleServiceChange(e.target.value)} required>
                  <option value="">Seleccionar servicio</option>
                  {services?.map((s) => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Duración *</Label>
                <select className={selectCls} value={duration}
                  onChange={(e) => handleDurationChange(Number(e.target.value) as 60 | 90)}>
                  <option value={60}>60 minutos</option>
                  <option value={90}>90 minutos</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Precio *</Label>
                <Input type="number" min="0" step="1" value={amount}
                  onChange={(e) => setAmount(e.target.value)} required placeholder="0" />
              </div>

              <div className="space-y-1.5">
                <Label>Vendido por</Label>
                <select className={selectCls} value={soldBy}
                  onChange={(e) => setSoldBy(e.target.value)}>
                  <option value="">Sin asignar</option>
                  {therapists?.map((t) => (
                    <option key={t.id} value={t.id}>{t.full_name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Vencimiento</Label>
                <Input type="date" value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Notas</Label>
                <Input placeholder="Opcional" value={notes}
                  onChange={(e) => setNotes(e.target.value)} />
              </div>

              <div className="sm:col-span-2 space-y-1.5">
                <Label>A nombre de *</Label>
                <Input
                  required
                  placeholder="Nombre y apellido del destinatario"
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>De parte de</Label>
                <Input
                  placeholder="¿Quién la regala? (opcional)"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Mensaje</Label>
                <Input
                  placeholder="Mensaje personal (opcional)"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </div>
            </div>

            <Button type="submit" className="w-full gap-2"
              disabled={createGC.isPending || !serviceId || !amount || !recipientName.trim()}>
              {createGC.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Generando...</>
                : <><Gift className="w-4 h-4" /> Generar Gift Card</>}
            </Button>

            {createGC.isError && (
              <p className="text-sm text-red-600 text-center">
                {(createGC.error as Error).message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      {generatedGC && (
        <GiftCardImageModal gc={generatedGC} onClose={() => setGeneratedGC(null)} />
      )}
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

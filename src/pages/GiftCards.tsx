import { useState, useEffect } from 'react'
import { Gift, Loader2, Download } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useServices, useTherapists } from '@/hooks/useAppointments'
import { useGiftCards, useCreateGiftCard, GiftCard } from '@/hooks/useGiftCards'
import { supabase, TENANT_ID } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn, formatCurrency, formatDate } from '@/lib/utils'

// Replace with actual base64-encoded logo PNG
const LOGO_BASE64 = ''

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
}

// ── Canvas generator ───────────────────────────────────────────────────────────
async function generateGiftCardCanvas(params: {
  code: string
  serviceName: string
  duration: number
  recipientName: string
  senderName?: string
  whatsappNumber?: string
}): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = 900
  canvas.height = 500
  const ctx = canvas.getContext('2d')!

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, 500)
  grad.addColorStop(0, '#3D0A3F')
  grad.addColorStop(1, '#1A0020')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 900, 500)

  // Decorative mandala arcs — top-left corner
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.strokeStyle = '#B8960C'
  ctx.lineWidth = 1
  for (const r of [20, 40, 60, 80, 100]) {
    ctx.beginPath()
    ctx.arc(-20, -20, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // Decorative mandala arcs — bottom-right corner
  ctx.save()
  ctx.globalAlpha = 0.4
  ctx.strokeStyle = '#B8960C'
  ctx.lineWidth = 1
  for (const r of [20, 40, 60, 80, 100]) {
    ctx.beginPath()
    ctx.arc(920, 520, r, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()

  // Logo (drawn before text so text renders on top)
  if (LOGO_BASE64) {
    await new Promise<void>((resolve) => {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 40, 150, 180, 180); resolve() }
      img.onerror = () => resolve()
      img.src = LOGO_BASE64
    })
  }

  // Brand text — left column starting at x=280
  ctx.textAlign = 'left'

  ctx.fillStyle = '#B8960C'
  ctx.font = 'bold 42px Georgia, serif'
  ctx.fillText('TARJETA DE REGALO', 280, 80)

  ctx.fillStyle = '#D4A0D4'
  ctx.font = '20px Georgia, serif'
  ctx.fillText('CENTRO DE BIENESTAR', 280, 115)

  ctx.fillStyle = '#B8960C'
  ctx.font = 'bold 56px Georgia, serif'
  ctx.fillText('LUVIRA', 280, 175)

  // "WELLNESS" with manual letter spacing (+2px per glyph)
  ctx.fillStyle = '#B8960C'
  ctx.font = '28px Georgia, serif'
  let xPos = 280
  for (const letter of 'WELLNESS') {
    ctx.fillText(letter, xPos, 210)
    xPos += ctx.measureText(letter).width + 2
  }

  // Thin separator line in brand area
  ctx.fillStyle = '#B8960C'
  ctx.fillRect(280, 232, 400, 1)

  // Full-width gold double line
  ctx.strokeStyle = '#B8960C'
  ctx.lineWidth = 2
  ctx.beginPath(); ctx.moveTo(0, 320); ctx.lineTo(900, 320); ctx.stroke()

  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = '#B8960C'
  ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(0, 325); ctx.lineTo(900, 325); ctx.stroke()
  ctx.restore()

  // Bottom section — centered at x=450
  ctx.textAlign = 'center'

  ctx.fillStyle = '#E8D5E8'
  ctx.font = 'italic 18px Georgia, serif'
  ctx.fillText(`Vale por: ${params.serviceName} ${params.duration}min`, 450, 355)

  ctx.fillStyle = '#FFFFFF'
  ctx.font = '16px Georgia, serif'
  ctx.fillText(`A nombre de: ${params.recipientName}`, 450, 385)

  ctx.fillStyle = '#B8960C'
  ctx.font = 'bold 16px "Courier New", monospace'
  ctx.fillText(`Código: ${params.code}`, 450, 410)

  ctx.fillStyle = '#D4A0D4'
  ctx.font = '13px Georgia, serif'
  ctx.fillText(
    params.whatsappNumber
      ? `Reservar por WhatsApp al ${params.whatsappNumber}`
      : 'Reservar por WhatsApp',
    450, 440,
  )

  if (params.senderName) {
    ctx.fillStyle = '#E8D5E8'
    ctx.font = 'italic 13px Georgia, serif'
    ctx.fillText(`Con cariño de: ${params.senderName}`, 450, 460)
  }

  return canvas.toDataURL('image/png')
}

// ── Gift card image modal ──────────────────────────────────────────────────────
function GiftCardImageModal({ gc, onClose }: { gc: GeneratedGiftCard; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function build() {
      const { data } = await supabase
        .from('tenants')
        .select('whatsapp_number')
        .eq('id', TENANT_ID)
        .single()
      if (cancelled) return
      const url = await generateGiftCardCanvas({
        code: gc.code,
        serviceName: gc.serviceName,
        duration: gc.duration,
        recipientName: gc.recipientName,
        senderName: gc.senderName || undefined,
        whatsappNumber: (data as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? undefined,
      })
      if (!cancelled) setImageUrl(url)
    }
    build()
    return () => { cancelled = true }
  }, [gc])

  function handleDownload() {
    if (!imageUrl) return
    const a = document.createElement('a')
    a.href = imageUrl
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
            <Gift className="w-5 h-5" /> Gift Card generada
          </DialogTitle>
          <DialogDescription>
            A nombre de {gc.recipientName} · Código:{' '}
            <span className="font-mono font-semibold">{gc.code}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 rounded-lg overflow-hidden border">
          {imageUrl ? (
            <img src={imageUrl} alt="Gift Card Luvira" className="w-full" />
          ) : (
            <div className="flex items-center justify-center h-52 bg-gray-50">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-2">
          <Button onClick={handleDownload} disabled={!imageUrl} className="flex-1 gap-2">
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
      setGeneratedGC({
        code: result.code,
        serviceName: selectedService?.name ?? 'Servicio',
        duration,
        recipientName: recipientName.trim(),
        senderName: senderName.trim(),
        message: message.trim(),
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
        <CardTitle className="text-base text-plum-800">
          Historial ({giftCards?.length ?? 0})
        </CardTitle>
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

import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Loader2, CheckCircle, CreditCard, UserPlus, MessageCircle, Pencil } from 'lucide-react'
import {
  useAppointments, useCreateAppointment, useUpdateAppointmentStatus,
  useUpdateAppointment, useServices, useTherapists, type Therapist,
} from '@/hooks/useAppointments'
import { useClientActiveMemberships } from '@/hooks/useClientMemberships'
import VenderMembresiaModal from '@/components/VenderMembresiaModal'
import { useInsertTransaction } from '@/hooks/useFinanzas'
import { useValidateGiftCard, useRedeemGiftCard, type ValidatedGiftCard } from '@/hooks/useGiftCards'
import { useClients, useCreateClient } from '@/hooks/useClients'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { useCreateAbsence, useEmployeeSchedules, type WeeklySchedule } from '@/hooks/useRRHH'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn, formatTime, formatDate, formatCurrency } from '@/lib/utils'
import type { Appointment, AppointmentStatus, Client } from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const START_HOUR = 7
const END_HOUR = 21
const HOUR_PX = 80
const TOTAL_HEIGHT = (END_HOUR - START_HOUR) * HOUR_PX // 1120px
const DEFAULT_COLORS = ['#7c3aed', '#0891b2', '#16a34a', '#dc2626', '#d97706']
const DAY_NAMES_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

type BloqueoTipo = 'descanso' | 'ausencia'

const BLOQUEO_COLORS: Record<BloqueoTipo, { bg: string; border: string; text: string }> = {
  descanso: { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' },
  ausencia: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
}

function parseBloqueoTipo(notes: string | null | undefined): BloqueoTipo | null {
  if (!notes) return null
  const lower = notes.toLowerCase()
  if (lower.startsWith('ausencia')) return 'ausencia'
  if (lower.startsWith('descanso')) return 'descanso'
  return null
}

// ── Types ─────────────────────────────────────────────────────────────────────

type SlotTarget = {
  therapistId: string
  date: string
  hour: number
  minute: number
  x: number
  y: number
}

type TurnoPrefill = {
  date: string
  time: string
  therapistId: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

function timeToY(h: number, m: number): number {
  return ((h - START_HOUR) * 60 + m) * (HOUR_PX / 60)
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function fmtSlot(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function fmtDayHeader(d: Date): string {
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${DAY_NAMES_LONG[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]} ${d.getFullYear()}`
}

function fmtWeekRange(weekStart: Date): string {
  const mon = new Date(weekStart)
  const sun = new Date(mon)
  sun.setDate(sun.getDate() + 6)
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  if (mon.getMonth() === sun.getMonth()) {
    return `${mon.getDate()} – ${sun.getDate()} de ${months[sun.getMonth()]} ${sun.getFullYear()}`
  }
  return `${mon.getDate()} ${months[mon.getMonth()]} – ${sun.getDate()} ${months[sun.getMonth()]} ${sun.getFullYear()}`
}

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  date.setHours(0, 0, 0, 0)
  return date
}

// Returns pixel segments [top, height] for all unavailable gaps in the day grid.
function getUnavailableSegments(
  schedule: Therapist['schedule'],
  date: Date,
): { top: number; height: number }[] {
  const GRID_START = START_HOUR * 60
  const GRID_END = END_HOUR * 60

  function toY(totalMins: number) {
    return ((totalMins - GRID_START) * HOUR_PX) / 60
  }

  if (!schedule) return []

  const dayKey = DAY_KEYS[date.getDay()]
  const ranges = (schedule[dayKey] ?? []) as { start: string; end: string }[]

  if (ranges.length === 0) {
    return [{ top: 0, height: TOTAL_HEIGHT }]
  }

  const sorted = [...ranges]
    .map(r => ({
      s: r.start.split(':').map(Number).reduce((h, m) => h * 60 + m),
      e: r.end.split(':').map(Number).reduce((h, m) => h * 60 + m),
    }))
    .sort((a, b) => a.s - b.s)

  const segs: { top: number; height: number }[] = []

  if (sorted[0].s > GRID_START) {
    const top = 0
    const height = toY(sorted[0].s)
    if (height > 0) segs.push({ top, height })
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].e
    const gapEnd = sorted[i + 1].s
    if (gapEnd > gapStart) {
      segs.push({ top: toY(gapStart), height: toY(gapEnd) - toY(gapStart) })
    }
  }

  const lastEnd = sorted[sorted.length - 1].e
  if (lastEnd < GRID_END) {
    segs.push({ top: toY(lastEnd), height: toY(GRID_END) - toY(lastEnd) })
  }

  return segs
}

const WEEKLY_DAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const

function getWeeklyScheduleUnavailableSegs(
  ws: WeeklySchedule | null | undefined,
  date: Date,
): { top: number; height: number }[] {
  if (!ws) return []
  const GRID_START = START_HOUR * 60
  const GRID_END = END_HOUR * 60
  function toY(mins: number) { return ((mins - GRID_START) * HOUR_PX) / 60 }
  const dayKey = WEEKLY_DAY_KEYS[date.getDay()] as keyof WeeklySchedule
  const intervals = ws[dayKey] ?? []
  if (intervals.length === 0) return [{ top: 0, height: TOTAL_HEIGHT }]
  const sorted = [...intervals]
    .map(iv => ({
      s: iv.from.split(':').map(Number).reduce((h, m) => h * 60 + m),
      e: iv.to.split(':').map(Number).reduce((h, m) => h * 60 + m),
    }))
    .sort((a, b) => a.s - b.s)
  const segs: { top: number; height: number }[] = []
  if (sorted[0].s > GRID_START) segs.push({ top: 0, height: toY(sorted[0].s) })
  for (let i = 0; i < sorted.length - 1; i++) {
    const gs = sorted[i].e; const ge = sorted[i + 1].s
    if (ge > gs) segs.push({ top: toY(gs), height: toY(ge) - toY(gs) })
  }
  const lastEnd = sorted[sorted.length - 1].e
  if (lastEnd < GRID_END) segs.push({ top: toY(lastEnd), height: toY(GRID_END) - toY(lastEnd) })
  return segs
}

function isPast(date: string, h: number, m: number): boolean {
  const d = new Date(`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`)
  return d < new Date()
}


function therapistColor(t: Therapist, idx: number): string {
  return t.color_hex ?? DEFAULT_COLORS[idx % DEFAULT_COLORS.length]
}

function clientName(appt: Appointment): string {
  if (!appt.client) return 'Sin cliente'
  return [appt.client.first_name, appt.client.last_name].filter(Boolean).join(' ') || 'Cliente'
}

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No presentado',
  blocked: 'Bloqueado',
}

const STATUS_PILL: Record<AppointmentStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-orange-100 text-orange-700',
  blocked: 'bg-slate-100 text-slate-700',
}

const STATUS_DOT: Record<AppointmentStatus, string> = {
  pending: 'bg-gray-400',
  confirmed: 'bg-blue-500',
  completed: 'bg-blue-600',
  cancelled: 'bg-red-500',
  no_show: 'bg-orange-500',
  blocked: 'bg-slate-400',
}

const TERMINAL: AppointmentStatus[] = ['completed', 'cancelled', 'no_show', 'blocked']

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
] as const

type PaymentType = 'efectivo_digital' | 'membresia' | 'gift_card'
type SplitRow = { method: string; amount: string }

// ── DayApptBlock ──────────────────────────────────────────────────────────────

function DayApptBlock({
  appt, color, onClick,
}: {
  appt: Appointment; color: string; onClick: () => void
}) {
  const top = timeToY(new Date(appt.scheduled_at).getHours(), new Date(appt.scheduled_at).getMinutes())
  const height = Math.max(appt.duration_minutes * (HOUR_PX / 60), 22)
  const isBlock = appt.status === 'blocked'
  const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show'
  const isCompleted = appt.status === 'completed'

  const bloqueoTipo = isBlock ? parseBloqueoTipo(appt.notes) : null
  const bloqueoStyle = bloqueoTipo
    ? BLOQUEO_COLORS[bloqueoTipo]
    : { bg: '#f1f5f9', border: '#94a3b8', text: '#475569' }
  const blockLabel = bloqueoTipo === 'ausencia' ? '⚠️ Ausencia' : bloqueoTipo === 'descanso' ? 'Descanso' : 'Bloqueado'
  const blockMotivo = bloqueoTipo && appt.notes?.includes(': ')
    ? appt.notes.split(': ').slice(1).join(': ').trim()
    : (!bloqueoTipo ? (appt.notes ?? '') : '')

  return (
    <div
      className="absolute left-1 right-1 rounded overflow-hidden cursor-pointer z-10 select-none transition-opacity hover:opacity-90"
      style={{
        top,
        height,
        opacity: isCancelled ? 0.5 : 1,
        backgroundColor: isCancelled ? '#f3f4f6' : isBlock ? bloqueoStyle.bg : isCompleted ? '#2563EB26' : `${color}26`,
        borderLeft: `3px solid ${isCancelled ? '#9ca3af' : isBlock ? bloqueoStyle.border : isCompleted ? '#2563EB' : color}`,
      }}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      <div className="px-1.5 py-0.5 h-full overflow-hidden">
        {isBlock ? (
          <p className="text-[11px] font-medium leading-tight mt-0.5" style={{ color: bloqueoStyle.text }}>
            {blockLabel}{blockMotivo ? ` · ${blockMotivo}` : ''}
          </p>
        ) : isCancelled ? (
          <>
            <p className="text-[11px] font-medium text-gray-400 truncate leading-tight line-through">{clientName(appt)}</p>
            <p className="text-[10px] text-gray-400 leading-tight">{appt.status === 'cancelled' ? 'Cancelado' : 'No se presentó'}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[appt.status]}`} />
              <p className="text-[11px] font-semibold text-gray-800 truncate leading-tight">{clientName(appt)}</p>
            </div>
            {height > 36 && (
              <p className="text-[10px] text-gray-500 truncate leading-tight">{appt.service?.name}</p>
            )}
            {height > 54 && (
              <p className="text-[10px] text-gray-400 leading-tight">{appt.duration_minutes} min</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── CerrarSesionStep ──────────────────────────────────────────────────────────

function CerrarSesionStep({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const { user } = useAuth()
  const [paymentType, setPaymentType] = useState<PaymentType>('efectivo_digital')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const basePrice = appt.price_charged
    ?? (appt.duration_minutes === 90 ? appt.service?.price_90 ?? appt.service?.price_60 : appt.service?.price_60 ?? appt.service?.price_90)
    ?? 0
  const [monto, setMonto] = useState(String(basePrice))
  const [descAmt, setDescAmt] = useState('0')
  const [descPct, setDescPct] = useState('0')
  const [splitRows, setSplitRows] = useState<SplitRow[]>([{ method: 'cash', amount: String(basePrice) }])

  const montoNum = Number(monto) || 0
  const descAmtNum = Number(descAmt) || 0
  const descPctNum = Number(descPct) || 0
  const montoFinal = Math.max(0, montoNum - descAmtNum - (montoNum * descPctNum / 100))
  const splitTotal = splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
  const splitBalanced = Math.abs(splitTotal - montoFinal) < 0.01

  const { data: activeMemberships } = useClientActiveMemberships(appt.client_id ?? null)
  const [membershipSubOpt, setMembershipSubOpt] = useState<'use_existing' | 'sell_new'>('use_existing')
  const [selectedMembershipId, setSelectedMembershipId] = useState<string | null>(null)
  const [showVenderModal, setShowVenderModal] = useState(false)

  useEffect(() => {
    if (activeMemberships && activeMemberships.length >= 1 && !selectedMembershipId) {
      setSelectedMembershipId(activeMemberships[0].id)
    }
  }, [activeMemberships])

  useEffect(() => {
    setSplitRows(prev => prev.length === 1 ? [{ ...prev[0], amount: String(montoFinal) }] : prev)
  }, [montoFinal])

  const selectedMembership = activeMemberships?.find((m) => m.id === selectedMembershipId) ?? null
  const allowedServiceIds = selectedMembership?.plan?.allowed_service_ids ?? null

  const { data: allowedServiceNames = [] } = useQuery({
    queryKey: ['services-by-ids', allowedServiceIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('id, name')
        .in('id', allowedServiceIds!)
      if (error) throw error
      return data as { id: string; name: string }[]
    },
    enabled: Array.isArray(allowedServiceIds) && allowedServiceIds.length > 0,
  })

  const membershipServiceBlocked =
    paymentType === 'membresia' &&
    membershipSubOpt === 'use_existing' &&
    selectedMembership != null &&
    Array.isArray(allowedServiceIds) &&
    appt.service_id != null &&
    !allowedServiceIds.includes(appt.service_id)

  const [gcCode, setGcCode] = useState('')
  const [gcValid, setGcValid] = useState<ValidatedGiftCard | null>(null)
  const [gcError, setGcError] = useState<string | null>(null)
  const validateGC = useValidateGiftCard()
  const redeemGC = useRedeemGiftCard()

  const insertTx = useInsertTransaction()
  const updateStatus = useUpdateAppointmentStatus()

  async function handleValidateGC() {
    setGcError(null); setGcValid(null)
    try {
      const result = await validateGC.mutateAsync({
        code: gcCode,
        serviceId: appt.service_id ?? '',
        durationMinutes: appt.duration_minutes,
      })
      setGcValid(result)
    } catch (e) { setGcError((e as Error).message) }
  }

  function buildDescription(): string {
    const base = `Sesión: ${appt.service?.name ?? 'Servicio'} (${appt.duration_minutes}min)`
    const parts: string[] = []
    if (descAmtNum > 0) parts.push(`$${descAmtNum}`)
    if (descPctNum > 0) parts.push(`${descPctNum}%`)
    return parts.length > 0 ? `${base} - Descuento: ${parts.join(' + ')}` : base
  }

  async function handleConfirm() {
    setBusy(true); setError(null)
    const today = new Date().toISOString().split('T')[0]
    try {
      if (paymentType === 'efectivo_digital') {
        const desc = buildDescription()
        for (const row of splitRows) {
          await insertTx.mutateAsync({
            type: 'income', category: 'session', amount: Number(row.amount) || 0,
            payment_method: row.method, description: desc,
            date: today, user_id: user!.id, status: 'paid',
            is_recurring: false, appointment_id: appt.id,
          })
        }
      } else if (paymentType === 'gift_card' && gcValid) {
        await redeemGC.mutateAsync({ giftCardId: gcValid.id, clientId: appt.client_id ?? '', appointmentId: appt.id })
      }
      const membershipId =
        paymentType === 'membresia' && membershipSubOpt === 'use_existing' && selectedMembershipId
          ? selectedMembershipId
          : undefined
      await updateStatus.mutateAsync({ id: appt.id, status: 'completed', client_membership_id: membershipId })
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Error al cerrar la sesión')
    } finally { setBusy(false) }
  }

  const canConfirm = !busy && (
    (paymentType === 'efectivo_digital' && splitBalanced) ||
    (paymentType === 'membresia' && membershipSubOpt === 'use_existing' && !!selectedMembershipId && !membershipServiceBlocked) ||
    (paymentType === 'gift_card' && !!gcValid)
  )

  return (
    <div className="space-y-5">
      <div className="bg-plum-50 rounded-lg p-3 grid grid-cols-3 gap-2 text-sm">
        <div><p className="text-xs text-muted-foreground">Servicio</p><p className="font-medium text-plum-800">{appt.service?.name ?? '—'}</p></div>
        <div><p className="text-xs text-muted-foreground">Duración</p><p className="font-medium text-plum-800">{appt.duration_minutes} min</p></div>
        <div><p className="text-xs text-muted-foreground">Precio base</p><p className="font-medium text-plum-800">{formatCurrency(basePrice)}</p></div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm font-medium">Tipo de cobro</Label>
        <div className="flex flex-col gap-2">
          {([
            { value: 'efectivo_digital' as const, label: 'Efectivo / Digital', enabled: true },
            { value: 'membresia' as const, label: 'Membresía', enabled: true },
            { value: 'gift_card' as const, label: 'Gift Card', enabled: true },
          ] as const).map((opt) => (
            <label key={opt.value} className={cn(
              'flex items-center gap-2.5 p-3 border rounded-lg cursor-pointer transition-colors',
              !opt.enabled && 'opacity-40 cursor-not-allowed',
              paymentType === opt.value ? 'border-plum-800 bg-plum-50' : 'border-gray-200 hover:border-gray-300',
            )}>
              <input type="radio" name="paymentType" value={opt.value}
                checked={paymentType === opt.value} disabled={!opt.enabled}
                onChange={() => { if (opt.enabled) setPaymentType(opt.value) }}
                className="accent-plum-800" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {paymentType === 'efectivo_digital' && (
        <div className="space-y-3 border rounded-lg p-3 bg-gray-50">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label className="text-xs">Monto base</Label><Input type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Descuento $</Label><Input type="number" min="0" step="1" value={descAmt} onChange={(e) => setDescAmt(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Descuento %</Label><Input type="number" min="0" max="100" step="1" value={descPct} onChange={(e) => setDescPct(e.target.value)} /></div>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-plum-800">A cobrar:</span>
            <span className="text-lg font-bold text-plum-800">{formatCurrency(montoFinal)}</span>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Métodos de pago</Label>
            {splitRows.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select
                  className={cn(SELECT_CLS, 'flex-1')}
                  value={row.method}
                  onChange={(e) => setSplitRows(prev => prev.map((r, j) => j === i ? { ...r, method: e.target.value } : r))}
                >
                  {PAYMENT_METHODS.map((pm) => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                </select>
                <Input
                  type="number" min="0" step="1"
                  className="w-28"
                  value={row.amount}
                  onChange={(e) => setSplitRows(prev => prev.map((r, j) => j === i ? { ...r, amount: e.target.value } : r))}
                />
                {splitRows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSplitRows(prev => prev.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-red-600 px-1 text-base leading-none"
                  >✕</button>
                )}
              </div>
            ))}
            {splitRows.length < 3 && (
              <button
                type="button"
                onClick={() => setSplitRows(prev => [...prev, { method: 'transfer', amount: '0' }])}
                className="text-xs text-plum-800 hover:underline"
              >+ Agregar método de pago</button>
            )}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className={splitBalanced ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
              Ingresado: {formatCurrency(splitTotal)}
            </span>
            {!splitBalanced && (
              <span className="text-red-600">debe sumar {formatCurrency(montoFinal)}</span>
            )}
          </div>
        </div>
      )}

      {paymentType === 'membresia' && (
        <div className="border rounded-lg p-3 bg-gray-50 space-y-3">
          {/* Sub-opción A: Usar membresía existente */}
          <label className={cn(
            'flex items-start gap-2.5 p-3 border rounded-lg cursor-pointer transition-colors bg-white',
            membershipSubOpt === 'use_existing' ? 'border-plum-800' : 'border-gray-200 hover:border-gray-300',
          )}>
            <input type="radio" name="membershipSub" value="use_existing"
              checked={membershipSubOpt === 'use_existing'}
              onChange={() => setMembershipSubOpt('use_existing')}
              className="accent-plum-800 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Usar membresía existente</p>
              {membershipSubOpt === 'use_existing' && (
                <div className="mt-2 space-y-2">
                  {!activeMemberships || activeMemberships.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sin membresías activas para este cliente.</p>
                  ) : activeMemberships.length === 1 ? (
                    (() => {
                      const m = activeMemberships[0]
                      const rem = Math.max(0, (m.plan?.sessions_qty ?? 0) - (m.sessions_used ?? 0))
                      return (
                        <div className={cn('border rounded-lg p-2.5 space-y-0.5', membershipServiceBlocked ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50')}>
                          <p className={cn('text-sm font-medium', membershipServiceBlocked ? 'text-red-800' : 'text-green-800')}>{m.plan?.name ?? 'Membresía activa'}</p>
                          <p className={cn('text-xs', membershipServiceBlocked ? 'text-red-700' : 'text-green-700')}>
                            {rem} sesiones restantes · vence {m.expires_at ? formatDate(m.expires_at) : '—'}
                          </p>
                          {!membershipServiceBlocked && <p className="text-xs text-green-600">No se registra cobro — se descuenta una sesión.</p>}
                        </div>
                      )
                    })()
                  ) : (
                    <select
                      className={SELECT_CLS}
                      value={selectedMembershipId ?? ''}
                      onChange={(e) => setSelectedMembershipId(e.target.value || null)}
                    >
                      <option value="">Seleccionar membresía...</option>
                      {activeMemberships.map((m) => {
                        const rem = Math.max(0, (m.plan?.sessions_qty ?? 0) - (m.sessions_used ?? 0))
                        return (
                          <option key={m.id} value={m.id}>
                            {m.plan?.name ?? 'Membresía'} — {rem} ses. · vence {m.expires_at ? formatDate(m.expires_at) : '—'}
                          </option>
                        )
                      })}
                    </select>
                  )}
                  {membershipServiceBlocked && (
                    <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                      <p className="font-medium mb-1">
                        Este servicio no está incluido en el plan &ldquo;{selectedMembership?.plan?.name}&rdquo;.
                      </p>
                      <p>Servicios habilitados:</p>
                      <ul className="mt-0.5 space-y-0.5 pl-3 list-disc">
                        {allowedServiceNames.length > 0
                          ? allowedServiceNames.map((s) => <li key={s.id}>{s.name}</li>)
                          : <li className="text-red-500">Sin servicios configurados</li>
                        }
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </label>

          {/* Sub-opción B: Vender nueva membresía */}
          <label className={cn(
            'flex items-start gap-2.5 p-3 border rounded-lg cursor-pointer transition-colors bg-white',
            membershipSubOpt === 'sell_new' ? 'border-plum-800' : 'border-gray-200 hover:border-gray-300',
          )}>
            <input type="radio" name="membershipSub" value="sell_new"
              checked={membershipSubOpt === 'sell_new'}
              onChange={() => setMembershipSubOpt('sell_new')}
              className="accent-plum-800 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Vender nueva membresía ahora</p>
              {membershipSubOpt === 'sell_new' && (
                <div className="mt-2 space-y-1.5">
                  <Button type="button" size="sm" className="gap-1.5"
                    onClick={() => setShowVenderModal(true)}>
                    <CreditCard className="w-3.5 h-3.5" /> Vender membresía
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    El precio de la membresía cubre esta sesión. No se genera cobro adicional.
                  </p>
                </div>
              )}
            </div>
          </label>
        </div>
      )}

      {paymentType === 'gift_card' && (
        <div className="space-y-2 border rounded-lg p-3 bg-gray-50">
          <div className="flex gap-2">
            <Input placeholder="LUV-XXXX-XXXX" value={gcCode}
              onChange={(e) => { setGcCode(e.target.value.toUpperCase()); setGcValid(null); setGcError(null) }}
              className="font-mono uppercase" />
            <Button type="button" variant="outline" size="sm"
              onClick={handleValidateGC} disabled={!gcCode || validateGC.isPending}>
              {validateGC.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Validar'}
            </Button>
          </div>
          {gcValid && (
            <div className="flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle className="w-4 h-4" />
              Gift card válida · {formatCurrency(gcValid.amount)}
              {gcValid.expires_at ? ` · Vence ${formatDate(gcValid.expires_at)}` : ''}
            </div>
          )}
          {gcError && <p className="text-sm text-red-600">{gcError}</p>}
        </div>
      )}

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      <Button onClick={handleConfirm} className="w-full" disabled={!canConfirm}>
        {busy ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Cerrando sesión...</> : 'Confirmar y cerrar sesión'}
      </Button>

      {showVenderModal && (
        <VenderMembresiaModal
          open={showVenderModal}
          onClose={() => setShowVenderModal(false)}
          preSelectedClientId={appt.client_id ?? ''}
          preSelectedAppointmentId={appt.id}
          restrictToServiceId={appt.service_id ?? undefined}
          restrictToServiceName={appt.service?.name}
          onSuccess={async () => {
            setShowVenderModal(false)
            setBusy(true)
            try {
              await updateStatus.mutateAsync({ id: appt.id, status: 'completed' })
              onClose()
            } catch (e) {
              setError((e as Error).message || 'Error al cerrar la sesión')
              setBusy(false)
            }
          }}
        />
      )}
    </div>
  )
}

// ── EditarTurnoForm ───────────────────────────────────────────────────────────

function EditarTurnoForm({ appt, onCancel, onSaved }: { appt: Appointment; onCancel: () => void; onSaved: () => void }) {
  const { data: services } = useServices()
  const { data: therapists } = useTherapists()
  const updateAppt = useUpdateAppointment()

  const dt = new Date(appt.scheduled_at)
  const [form, setForm] = useState({
    service_id: appt.service_id ?? '',
    therapist_id: appt.therapist_id,
    duration_minutes: (appt.duration_minutes ?? 60) as 60 | 90,
    box_number: (appt.box_number ?? 1) as 1 | 2 | 3,
    date: `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    time: `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`,
  })
  const [formError, setFormError] = useState<string | null>(null)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    try {
      const service = services?.find(s => s.id === form.service_id)
      const price_charged = form.service_id
        ? (form.duration_minutes === 90 ? (service?.price_90 ?? service?.price_60) : (service?.price_60 ?? service?.price_90))
        : undefined
      await updateAppt.mutateAsync({
        id: appt.id,
        service_id: form.service_id,
        therapist_id: form.therapist_id,
        scheduled_at: new Date(`${form.date}T${form.time}:00`).toISOString(),
        duration_minutes: form.duration_minutes,
        box_number: form.box_number,
        price_charged,
      })
      onSaved()
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      if (msg.includes('box') || msg.includes('conflict') || msg.includes('overlap') || msg.includes('ocupado') || msg.includes('duplicate') || msg.includes('unique')) {
        setFormError('Box ocupado en ese horario. Elegí otro horario o box disponible.')
      } else {
        setFormError((err instanceof Error && err.message) ? err.message : 'No se pudo guardar el turno. Intentá de nuevo.')
      }
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 mt-2">
      <div className="space-y-1.5">
        <Label>Servicio</Label>
        <select value={form.service_id} onChange={e => set('service_id', e.target.value)} required className={SELECT_CLS}>
          <option value="">Seleccionar servicio...</option>
          {services?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label>Terapeuta</Label>
        <select value={form.therapist_id} onChange={e => set('therapist_id', e.target.value)} required className={SELECT_CLS}>
          <option value="">Seleccionar terapeuta...</option>
          {therapists?.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Duración</Label>
          <select value={form.duration_minutes} onChange={e => set('duration_minutes', Number(e.target.value) as 60 | 90)} className={SELECT_CLS}>
            <option value={60}>60 minutos</option>
            <option value={90}>90 minutos</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Box</Label>
          <select value={form.box_number} onChange={e => set('box_number', Number(e.target.value) as 1 | 2 | 3)} className={SELECT_CLS}>
            <option value={1}>Box 1</option>
            <option value={2}>Box 2</option>
            <option value={3}>Box 3</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Fecha</Label>
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Hora</Label>
          <Input type="time" value={form.time} onChange={e => set('time', e.target.value)} required />
        </div>
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
      <div className="flex gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
        <Button type="submit" className="flex-1" disabled={updateAppt.isPending}>
          {updateAppt.isPending
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
            : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

// ── AppointmentDetailModal ────────────────────────────────────────────────────

const LUVIRA_ADDRESS = 'Bauness 2325, Villa Urquiza, Ciudad Autónoma de Buenos Aires, Argentina'

function buildWhatsAppUrl(appt: Appointment): string {
  const dt = new Date(appt.scheduled_at)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yyyy = dt.getFullYear()
  const hh = String(dt.getHours()).padStart(2, '0')
  const min = String(dt.getMinutes()).padStart(2, '0')

  const nombre = [appt.client?.first_name, appt.client?.last_name].filter(Boolean).join(' ') || 'cliente'
  const text =
    `Hola ${nombre}, recordá que tenés una cita en MASAJES LUVIRA WELLNESS el día ${dd}/${mm}/${yyyy} a las ${hh}:${min}.\n\n` +
    `Servicio: ${appt.service?.name ?? '—'} ${appt.duration_minutes} Min\n` +
    `Profesional: ${appt.therapist?.full_name ?? '—'}\n` +
    `Dirección: ${LUVIRA_ADDRESS}\n` +
    `Cómo llegar: https://maps.app.goo.gl/S8ngyx1fioo7xHv3A`

  const encoded = encodeURIComponent(text)
  const phone = appt.client?.phone?.replace(/\D/g, '')
  return phone
    ? `https://web.whatsapp.com/send?phone=54${phone}&text=${encoded}`
    : `https://web.whatsapp.com/send?text=${encoded}`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-sm">{value}</p>
    </div>
  )
}

function AppointmentDetailModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const updateStatus = useUpdateAppointmentStatus()
  const [showPayment, setShowPayment] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  async function changeStatus(status: AppointmentStatus) {
    await updateStatus.mutateAsync({ id: appt.id, status })
    onClose()
  }

  if (appt.status === 'blocked') {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Bloqueo de horario</DialogTitle>
            <DialogDescription>{formatDate(appt.scheduled_at)} · {formatTime(appt.scheduled_at)}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Terapeuta" value={appt.therapist?.full_name ?? '—'} />
              <Field label="Duración" value={`${appt.duration_minutes} min`} />
            </div>
            {appt.notes && <Field label="Motivo" value={appt.notes} />}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
              <Button variant="destructive" size="sm"
                onClick={() => changeStatus('cancelled')} disabled={updateStatus.isPending}>
                {updateStatus.isPending && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
                Eliminar bloqueo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{showEdit ? `Editar turno — ${clientName(appt)}` : showPayment ? `Cerrar sesión — ${clientName(appt)}` : 'Detalle del Turno'}</DialogTitle>
          <DialogDescription>{formatDate(appt.scheduled_at)} · {formatTime(appt.scheduled_at)}</DialogDescription>
        </DialogHeader>

        {showEdit ? (
          <EditarTurnoForm appt={appt} onCancel={() => setShowEdit(false)} onSaved={onClose} />
        ) : showPayment ? (
          <CerrarSesionStep appt={appt} onClose={onClose} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Cliente" value={clientName(appt)} />
              <Field label="Servicio" value={appt.service?.name ?? '—'} />
              <Field label="Terapeuta" value={appt.therapist?.full_name ?? '—'} />
              <Field label="Duración" value={`${appt.duration_minutes} min`} />
              {appt.box_number != null && <Field label="Box" value={`Box ${appt.box_number}`} />}
              {appt.price_charged != null && <Field label="Precio" value={formatCurrency(appt.price_charged)} />}
              {appt.deposit_amount != null && appt.deposit_amount > 0 && (
                <Field label="Seña" value={`${formatCurrency(appt.deposit_amount)} · ${appt.deposit_paid ? 'Cobrada' : 'Pendiente'}`} />
              )}
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground mb-1">Estado</p>
                <span className={cn('inline-flex text-xs font-semibold px-2 py-0.5 rounded-full', STATUS_PILL[appt.status])}>
                  {STATUS_LABELS[appt.status]}
                </span>
              </div>
              {appt.notes && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Notas</p>
                  <p className="text-sm">{appt.notes}</p>
                </div>
              )}
            </div>

            {!TERMINAL.includes(appt.status) && (
              <div className="border-t pt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Cambiar estado:</p>
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white"
                    onClick={() => setShowPayment(true)} disabled={updateStatus.isPending}>
                    Completar
                  </Button>
                  <Button size="sm" variant="outline"
                    onClick={() => setShowEdit(true)} disabled={updateStatus.isPending}>
                    <Pencil className="w-3.5 h-3.5 mr-1.5" />Editar turno
                  </Button>
                  <Button size="sm" variant="destructive"
                    onClick={() => changeStatus('cancelled')} disabled={updateStatus.isPending}>
                    Cancelado
                  </Button>
                  <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={() => changeStatus('no_show')} disabled={updateStatus.isPending}>
                    No se presentó
                  </Button>
                </div>
              </div>
            )}

            <div className="border-t pt-4 space-y-1.5">
              <a
                href={buildWhatsAppUrl(appt)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#25D366' }}
              >
                <MessageCircle className="w-4 h-4" />
                Enviar recordatorio
              </a>
              {!appt.client?.phone && (
                <p className="text-xs text-muted-foreground">
                  Este cliente no tiene teléfono registrado
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── ClientSearch ──────────────────────────────────────────────────────────────

function ClientSearch({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: clients } = useClients(inputValue.length >= 1 ? inputValue : undefined)

  useEffect(() => { if (!selectedId) setInputValue('') }, [selectedId])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function handleSelect(c: Client) {
    setInputValue([c.first_name, c.last_name].filter(Boolean).join(' '))
    setOpen(false)
    onSelect(c.id)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input value={inputValue}
        onChange={(e) => { setInputValue(e.target.value); setOpen(e.target.value.length >= 1); if (!e.target.value) onSelect('') }}
        placeholder="Buscar cliente por nombre o teléfono..."
        autoComplete="off" />
      {open && clients && clients.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {clients.map(c => (
            <button key={c.id} type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b last:border-b-0"
              onMouseDown={e => e.preventDefault()}
              onClick={() => handleSelect(c)}>
              <p className="font-medium text-plum-800">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</p>
              {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── NuevoTurnoModal ───────────────────────────────────────────────────────────

type TurnoForm = {
  client_id: string; service_id: string; therapist_id: string
  duration_minutes: 60 | 90; box_number: 1 | 2 | 3
  date: string; time: string; deposit_amount: string; deposit_paid: boolean; notes: string
}

function NuevoTurnoModal({
  open, onClose, prefill, isSobreTurno,
}: {
  open: boolean; onClose: () => void
  prefill?: TurnoPrefill | null; isSobreTurno?: boolean
}) {
  const [form, setForm] = useState<TurnoForm>({
    client_id: '', service_id: '',
    therapist_id: prefill?.therapistId ?? '',
    duration_minutes: 60, box_number: 1,
    date: prefill?.date ?? new Date().toISOString().split('T')[0],
    time: prefill?.time ?? '10:00',
    deposit_amount: '', deposit_paid: false, notes: '',
  })
  const [formError, setFormError] = useState<string | null>(null)
  const createAppt = useCreateAppointment()
  const { data: services } = useServices()
  const { data: therapists } = useTherapists()
  const { data: employeeSchedules } = useEmployeeSchedules()

  const createClient = useCreateClient()
  const [showQuickCreate, setShowQuickCreate] = useState(false)
  const [qcFirst, setQcFirst] = useState('')
  const [qcLast, setQcLast] = useState('')
  const [qcPhone, setQcPhone] = useState('')
  const [qcSource, setQcSource] = useState<'instagram' | 'google' | 'referral' | 'whatsapp' | 'in_person' | 'other'>('whatsapp')
  const [qcError, setQcError] = useState<string | null>(null)

  function set<K extends keyof TurnoForm>(key: K, value: TurnoForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleQuickCreate() {
    if (!qcFirst.trim() || !qcPhone.trim()) return
    setQcError(null)
    try {
      const newClient = await createClient.mutateAsync({
        first_name: qcFirst.trim(),
        last_name: qcLast.trim() || undefined,
        phone: qcPhone.trim(),
        source: qcSource,
      })
      set('client_id', newClient.id)
      setShowQuickCreate(false)
      setQcFirst(''); setQcLast(''); setQcPhone(''); setQcSource('whatsapp')
    } catch (err) {
      setQcError(err instanceof Error ? err.message : 'Error al crear el cliente. Intentá de nuevo.')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.client_id) { setFormError('Por favor seleccioná un cliente.'); return }

    if (!isSobreTurno && form.therapist_id && form.date && form.time) {
      const ws = employeeSchedules?.get(form.therapist_id)
      if (ws) {
        const dayKey = WEEKLY_DAY_KEYS[new Date(form.date).getDay()] as keyof WeeklySchedule
        const intervals = ws[dayKey] ?? []
        if (intervals.length === 0) {
          setFormError("La terapeuta no trabaja en ese horario. Usá 'Sobreturno' para agendar fuera de su schedule.")
          return
        }
        const [h, m] = form.time.split(':').map(Number)
        const apptMins = h * 60 + m
        const fits = intervals.some(iv => {
          const [fh, fm] = iv.from.split(':').map(Number)
          const [th, tm] = iv.to.split(':').map(Number)
          return apptMins >= fh * 60 + fm && apptMins < th * 60 + tm
        })
        if (!fits) {
          setFormError("La terapeuta no trabaja en ese horario. Usá 'Sobreturno' para agendar fuera de su schedule.")
          return
        }
      }
    }

    const service = services?.find(s => s.id === form.service_id)
    try {
      const scheduledAtValue = new Date(`${form.date}T${form.time}:00`).toISOString()
      await createAppt.mutateAsync({
        client_id: form.client_id,
        service_id: form.service_id,
        therapist_id: form.therapist_id,
        scheduled_at: scheduledAtValue,
        duration_minutes: form.duration_minutes,
        box_number: form.box_number,
        status: 'pending',
        source: isSobreTurno ? 'override' : 'manual',
        price_charged: form.duration_minutes === 90
          ? (service?.price_90 ?? service?.price_60) : (service?.price_60 ?? service?.price_90),
        deposit_amount: form.deposit_amount ? Number(form.deposit_amount) : 0,
        deposit_paid: form.deposit_paid,
        notes: form.notes || undefined,
      })
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : ''
      if (msg.includes('box') || msg.includes('conflict') || msg.includes('ocupado') || msg.includes('duplicate') || msg.includes('unique')) {
        setFormError('Box ocupado en ese horario. Elegí otro horario o box disponible.')
      } else {
        setFormError((err instanceof Error && err.message) ? err.message : 'No se pudo guardar el turno. Intentá de nuevo.')
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v && !createAppt.isPending) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Turno</DialogTitle>
          <DialogDescription>Completá los datos del nuevo turno.</DialogDescription>
        </DialogHeader>

        {isSobreTurno && (
          <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-lg mt-2">
            <span className="text-amber-500 mt-0.5 text-sm">⚠️</span>
            <p className="text-xs text-amber-700 font-medium">
              Sobre turno: se está asignando fuera del horario regular o en un horario ocupado.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <ClientSearch
                  selectedId={form.client_id}
                  onSelect={id => { set('client_id', id); if (id) setShowQuickCreate(false) }}
                />
              </div>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 flex-shrink-0"
                onClick={() => setShowQuickCreate(v => !v)}
                title="Crear nuevo cliente">
                <UserPlus className="w-4 h-4" />
              </Button>
            </div>

            {showQuickCreate && (
              <div className="border rounded-lg p-3 bg-slate-50 space-y-3 mt-1">
                <p className="text-xs font-semibold text-plum-800">Crear nuevo cliente</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Nombre *</Label>
                    <Input value={qcFirst} onChange={e => setQcFirst(e.target.value)} placeholder="Nombre" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Apellido</Label>
                    <Input value={qcLast} onChange={e => setQcLast(e.target.value)} placeholder="Apellido" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Teléfono *</Label>
                  <Input type="tel" value={qcPhone} onChange={e => setQcPhone(e.target.value)} placeholder="Ej: 11-2345-6789" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Canal</Label>
                  <select className={SELECT_CLS} value={qcSource}
                    onChange={e => setQcSource(e.target.value as typeof qcSource)}>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="google">Google</option>
                    <option value="referral">Referido</option>
                    <option value="in_person">Presencial</option>
                    <option value="other">Otro</option>
                  </select>
                </div>
                {qcError && <p className="text-xs text-red-600">{qcError}</p>}
                <div className="flex items-center gap-3">
                  <Button type="button" size="sm" className="flex-1"
                    disabled={!qcFirst.trim() || !qcPhone.trim() || createClient.isPending}
                    onClick={handleQuickCreate}>
                    {createClient.isPending
                      ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Creando...</>
                      : 'Crear y seleccionar'}
                  </Button>
                  <button type="button" className="text-xs text-muted-foreground hover:underline"
                    onClick={() => { setShowQuickCreate(false); setQcError(null) }}>
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Servicio *</Label>
            <select value={form.service_id} onChange={e => set('service_id', e.target.value)} required className={SELECT_CLS}>
              <option value="">Seleccionar servicio...</option>
              {services?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Terapeuta *</Label>
            <select value={form.therapist_id} onChange={e => set('therapist_id', e.target.value)} required className={SELECT_CLS}>
              <option value="">Seleccionar terapeuta...</option>
              {therapists?.map(t => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Duración</Label>
              <select value={form.duration_minutes} onChange={e => set('duration_minutes', Number(e.target.value) as 60 | 90)} className={SELECT_CLS}>
                <option value={60}>60 minutos</option>
                <option value={90}>90 minutos</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Box</Label>
              <select value={form.box_number} onChange={e => set('box_number', Number(e.target.value) as 1 | 2 | 3)} className={SELECT_CLS}>
                <option value={1}>Box 1</option>
                <option value={2}>Box 2</option>
                <option value={3}>Box 3</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha *</Label>
              <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Hora *</Label>
              <Input type="time" value={form.time} onChange={e => set('time', e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Seña (monto)</Label>
              <Input type="number" min="0" value={form.deposit_amount} onChange={e => set('deposit_amount', e.target.value)} placeholder="0" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.deposit_paid} onChange={e => set('deposit_paid', e.target.checked)} className="w-4 h-4 rounded" />
                Seña cobrada
              </label>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Observaciones opcionales" />
          </div>
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={createAppt.isPending}>
              {createAppt.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar Turno'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── BloqueoModal ──────────────────────────────────────────────────────────────

function BloqueoModal({ slot, therapists, onClose }: {
  slot: SlotTarget; therapists: Therapist[]; onClose: () => void
}) {
  const { user } = useAuth()
  const createAppt = useCreateAppointment()
  const createAbsence = useCreateAbsence()
  const { data: services } = useServices()
  const therapist = therapists.find(t => t.id === slot.therapistId)

  const [duration, setDuration] = useState(60)
  const [boxNumber, setBoxNumber] = useState<1 | 2 | 3>(1)
  const [motivo, setMotivo] = useState('')
  const [tipo, setTipo] = useState<BloqueoTipo>('descanso')
  const [deductFromSalary, setDeductFromSalary] = useState(true)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  async function handleSave() {
    setError('')
    const notesValue = `${tipo === 'ausencia' ? 'Ausencia' : 'Descanso'}: ${motivo.trim()}`
    try {
      const newAppt = await createAppt.mutateAsync({
        therapist_id: slot.therapistId,
        client_id: null,
        service_id: services?.[0]?.id ?? null,
        scheduled_at: new Date(`${slot.date}T${fmtSlot(slot.hour, slot.minute)}:00`).toISOString(),
        duration_minutes: duration as number,
        box_number: boxNumber,
        status: 'blocked' as const,
        source: 'manual',
        notes: notesValue,
        deposit_amount: 0,
        deposit_paid: false,
      }) as { id: string }

      if (tipo === 'ausencia') {
        const hoursAbsent = Math.round((duration / 60) * 100) / 100
        try {
          await createAbsence.mutateAsync({
            user_id: slot.therapistId,
            date: slot.date,
            hours_absent: hoursAbsent,
            type: 'absence',
            reason: motivo.trim() || undefined,
            deduct_from_salary: deductFromSalary,
            registered_by: user!.id,
            appointment_id: newAppt.id,
          })
          const hrsLabel = hoursAbsent % 1 === 0 ? `${hoursAbsent}` : hoursAbsent.toFixed(1)
          setSuccessMsg(
            `Ausencia registrada. Se descontarán ${hrsLabel}hs de la liquidación de ${therapist?.full_name ?? 'la terapeuta'}.`
          )
        } catch (absErr: unknown) {
          await supabase.from('appointments').delete().eq('id', newAppt.id)
          setError(`Error al registrar la ausencia: ${absErr instanceof Error ? absErr.message : 'Error desconocido'}. El bloqueo fue revertido.`)
        }
      } else {
        onClose()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear el bloqueo')
    }
  }

  const busy = createAppt.isPending || createAbsence.isPending

  if (successMsg) {
    return (
      <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-sm">
          <div className="py-6 text-center space-y-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-plum-800 px-2">{successMsg}</p>
            <Button variant="outline" size="sm" onClick={onClose}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bloquear horario</DialogTitle>
          <DialogDescription>El bloqueo reserva el tiempo sin asignar un turno.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Terapeuta</span>
              <span className="font-medium">{therapist?.full_name ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha</span>
              <span className="font-medium">{slot.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Hora de inicio</span>
              <span className="font-medium">{fmtSlot(slot.hour, slot.minute)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as BloqueoTipo)}
              className={SELECT_CLS}
            >
              <option value="descanso">Descanso</option>
              <option value="ausencia">Ausencia</option>
            </select>
          </div>

          {tipo === 'ausencia' && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3">
              <p className="text-xs font-semibold text-red-700 mb-2">⚠️ Se registrará una ausencia en RRHH</p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={deductFromSalary}
                  onChange={(e) => setDeductFromSalary(e.target.checked)} className="w-4 h-4" />
                Descontar del sueldo
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bloqueo-duration">Duración</Label>
              <select
                id="bloqueo-duration"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className={SELECT_CLS}
              >
                {[15, 30, 45, 60, 75, 90, 105, 120].map(d => (
                  <option key={d} value={d}>{d} minutos</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bloqueo-box">Box</Label>
              <select
                id="bloqueo-box"
                value={boxNumber}
                onChange={(e) => setBoxNumber(Number(e.target.value) as 1 | 2 | 3)}
                className={SELECT_CLS}
              >
                <option value={1}>Box 1</option>
                <option value={2}>Box 2</option>
                <option value={3}>Box 3</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bloqueo-motivo">Motivo (opcional)</Label>
            <Input
              id="bloqueo-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={tipo === 'ausencia' ? 'Ej: visita médica, enfermedad...' : 'Ej: preparación de sala...'}
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={busy}>
              {busy
                ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Guardando...</>
                : 'Guardar bloqueo'
              }
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── SlotMenu ──────────────────────────────────────────────────────────────────

function SlotMenu({ target, therapists, onNewTurno, onBloqueo, onSobreTurno, onClose }: {
  target: SlotTarget; therapists: Therapist[]
  onNewTurno: () => void; onBloqueo: () => void; onSobreTurno: () => void; onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [onClose])

  const therapist = therapists.find(t => t.id === target.therapistId)
  const past = isPast(target.date, target.hour, target.minute)
  const canNew = !past
  const disabledReason = past ? 'El horario ya pasó' : ''

  const menuX = Math.min(target.x + 8, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 210)
  const menuY = Math.min(target.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 160)

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 w-52"
      style={{ left: menuX, top: menuY }}
    >
      <p className="text-[11px] text-muted-foreground px-3 py-1 font-medium border-b mb-1">
        {fmtSlot(target.hour, target.minute)} · {therapist?.full_name?.split(' ')[0]}
      </p>
      <button
        className={cn(
          'w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors',
          canNew ? 'hover:bg-green-50 text-green-700' : 'text-gray-300 cursor-not-allowed',
        )}
        disabled={!canNew}
        title={disabledReason || undefined}
        onClick={() => { if (canNew) { onNewTurno(); onClose() } }}
      >
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        Nuevo turno
        {!canNew && disabledReason && (
          <span className="ml-auto text-[10px] text-gray-400 truncate max-w-[80px]">{disabledReason}</span>
        )}
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-red-50 text-red-700 transition-colors"
        onClick={() => { onBloqueo(); onClose() }}
      >
        <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
        Bloqueo
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-amber-50 text-amber-700 transition-colors"
        onClick={() => { onSobreTurno(); onClose() }}
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
        Sobre turno
      </button>
    </div>
  )
}

// ── DayView ───────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

function DayView({
  date, therapists, appointments, showCancelled, onSlotClick, onAppointmentClick,
}: {
  date: Date; therapists: Therapist[]; appointments: Appointment[]
  showCancelled: boolean
  onSlotClick: (t: SlotTarget) => void; onAppointmentClick: (a: Appointment) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [nowY, setNowY] = useState<number | null>(null)
  const [nowLabel, setNowLabel] = useState('')

  function updateNow() {
    const n = new Date()
    const h = n.getHours(); const m = n.getMinutes()
    if (h >= START_HOUR && h < END_HOUR) {
      setNowY(timeToY(h, m))
      setNowLabel(fmtSlot(h, m))
    } else { setNowY(null) }
  }

  useEffect(() => {
    updateNow()
    const id = setInterval(updateNow, 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!scrollRef.current) return
    const now = new Date()
    const h = now.getHours(); const m = now.getMinutes()
    if (h >= START_HOUR && h < END_HOUR) {
      scrollRef.current.scrollTop = Math.max(0, timeToY(h, m) - 200)
    } else {
      scrollRef.current.scrollTop = timeToY(8, 0)
    }
  }, []) // scroll to now once on mount

  const { data: employeeSchedules } = useEmployeeSchedules()

  const dateStr = dateKey(date)
  const dayAppts = appointments.filter(a =>
    dateKey(new Date(a.scheduled_at)) === dateStr &&
    (showCancelled || (a.status !== 'cancelled' && a.status !== 'no_show'))
  )

  function handleColumnClick(e: React.MouseEvent<HTMLDivElement>, therapistId: string) {
    const rect = e.currentTarget.getBoundingClientRect()
    const relY = e.clientY - rect.top
    const raw15 = Math.floor(relY / (HOUR_PX / 60) / 15) * 15
    const totalMins = Math.max(0, raw15)
    const hour = START_HOUR + Math.floor(totalMins / 60)
    const minute = totalMins % 60
    if (hour >= START_HOUR && hour < END_HOUR) {
      onSlotClick({ therapistId, date: dateStr, hour, minute, x: e.clientX, y: e.clientY })
    }
  }

  return (
    <div className="flex flex-col rounded-xl border bg-white overflow-hidden" style={{ height: 'calc(100vh - 9rem)' }}>
      {/* Therapist headers */}
      <div className="flex flex-none border-b bg-white">
        <div className="w-14 flex-shrink-0 border-r bg-gray-50" />
        {therapists.map((t, i) => {
          const color = therapistColor(t, i)
          const initials = t.full_name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
          return (
            <div key={t.id} className="flex-1 flex items-center gap-2.5 px-4 py-3 border-l first:border-l-0 min-w-0">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                style={{ backgroundColor: color }}>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-plum-800 truncate">{t.full_name}</p>
                <div className="w-2 h-2 rounded-full mt-0.5" style={{ backgroundColor: color }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: TOTAL_HEIGHT }}>

          {/* Time axis */}
          <div className="w-14 flex-shrink-0 relative border-r bg-gray-50">
            {nowY !== null && (
              <div className="absolute right-1.5 z-10 text-[10px] font-semibold text-red-500 -translate-y-1/2 leading-none"
                style={{ top: nowY }}>
                {nowLabel}
              </div>
            )}
            {HOURS.map(h => (
              <div key={h} className="absolute left-0 right-0 flex justify-end pr-2"
                style={{ top: timeToY(h, 0) }}>
                <span className="text-[10px] text-muted-foreground -mt-2 font-medium">{fmtHour(h)}</span>
              </div>
            ))}
          </div>

          {/* Columns + current time line */}
          <div className="relative flex flex-1">
            {/* Current time red line */}
            {nowY !== null && (
              <div className="absolute left-0 right-0 z-20 pointer-events-none flex items-center"
                style={{ top: nowY }}>
                <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -translate-y-1/2" />
                <div className="flex-1 h-px bg-red-500" />
              </div>
            )}

            {therapists.map((t, i) => {
              const color = therapistColor(t, i)
              const colAppts = dayAppts.filter(a => a.therapist_id === t.id)

              const unavailableSegs = getUnavailableSegments(t.schedule, date)
              const weeklyUnavailableSegs = getWeeklyScheduleUnavailableSegs(
                employeeSchedules?.get(t.id),
                date,
              )

              return (
                <div key={t.id}
                  className="flex-1 relative border-l cursor-crosshair"
                  style={{ height: TOTAL_HEIGHT }}
                  onClick={(e) => handleColumnClick(e, t.id)}>

                  {/* Hour grid lines */}
                  {HOURS.map(h => (
                    <div key={h} className="absolute left-0 right-0 border-t border-gray-100 pointer-events-none"
                      style={{ top: timeToY(h, 0) }} />
                  ))}
                  {HOURS.map(h => (
                    <div key={`${h}h`} className="absolute left-0 right-0 border-t border-gray-50 pointer-events-none"
                      style={{ top: timeToY(h, 30) }} />
                  ))}

                  {/* Unavailability shading (users.schedule) */}
                  {unavailableSegs.map((seg, idx) => (
                    <div key={idx} className="absolute left-0 right-0 pointer-events-none"
                      style={{ top: seg.top, height: seg.height, backgroundColor: '#F3F4F6' }} />
                  ))}

                  {/* Weekly schedule shading (employee_profiles.weekly_schedule) */}
                  {weeklyUnavailableSegs.map((seg, idx) => (
                    <div key={`ws-${idx}`} className="absolute left-0 right-0 pointer-events-none"
                      style={{ top: seg.top, height: seg.height, backgroundColor: 'rgba(0,0,0,0.04)' }} />
                  ))}

                  {/* Appointment blocks */}
                  {colAppts.map(appt => (
                    <DayApptBlock key={appt.id} appt={appt} color={color}
                      onClick={() => onAppointmentClick(appt)} />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── WeekView ──────────────────────────────────────────────────────────────────

function WeekView({
  weekStart, appointments, showCancelled, onDayClick, onAppointmentClick,
}: {
  weekStart: Date; appointments: Appointment[]
  showCancelled: boolean
  onDayClick: (d: Date) => void; onAppointmentClick: (a: Appointment) => void
}) {
  const today = new Date(); today.setHours(0,0,0,0)
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d })
  function dayAppts(day: Date) {
    const dk = dateKey(day)
    return appointments
      .filter(a =>
        dateKey(new Date(a.scheduled_at)) === dk &&
        (showCancelled || (a.status !== 'cancelled' && a.status !== 'no_show'))
      )
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  }

  return (
    <div className="grid grid-cols-7 gap-0 rounded-xl border overflow-hidden bg-white" style={{ minHeight: '70vh' }}>
      {days.map((day, idx) => {
        const appts = dayAppts(day)
        const isToday = day.getTime() === today.getTime()
        return (
          <div key={idx} className="flex flex-col border-r last:border-r-0">
            {/* Day header */}
            <button
              className={cn(
                'flex flex-col items-center py-3 px-2 border-b transition-colors hover:bg-gray-50',
                isToday ? 'bg-plum-800' : 'bg-white',
              )}
              onClick={() => onDayClick(day)}
            >
              <span className={cn('text-[11px] font-medium uppercase tracking-wide', isToday ? 'text-plum-200' : 'text-muted-foreground')}>
                {DAY_NAMES_SHORT[idx === 6 ? 0 : idx + 1] /* Mon=1 → index 0 → DAY_NAMES_SHORT[1] */}
              </span>
              <span className={cn(
                'text-xl font-bold mt-0.5 w-8 h-8 flex items-center justify-center rounded-full',
                isToday ? 'bg-gold-500 text-plum-900' : 'text-plum-800',
              )}>
                {day.getDate()}
              </span>
              {appts.length > 0 && (
                <span className={cn('text-[10px] font-medium mt-1 px-1.5 py-0.5 rounded-full', isToday ? 'bg-plum-700 text-plum-200' : 'bg-plum-100 text-plum-700')}>
                  {appts.length}
                </span>
              )}
            </button>
            {/* Appointments */}
            <div className="flex-1 p-2 space-y-1.5 overflow-y-auto">
              {appts.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center pt-4 italic">Sin turnos</p>
              ) : (
                appts.map(appt => {
                  const color = appt.therapist?.color_hex ?? '#7c3aed'
                  const isCancelled = appt.status === 'cancelled' || appt.status === 'no_show'
                  const isCompleted = appt.status === 'completed'
                  return (
                    <button key={appt.id}
                      className="w-full text-left rounded-lg p-2 hover:opacity-80 transition-opacity"
                      style={{
                        backgroundColor: isCancelled ? '#f3f4f6' : isCompleted ? '#2563EB18' : `${color}18`,
                        borderLeft: `3px solid ${isCancelled ? '#9ca3af' : isCompleted ? '#2563EB' : color}`,
                        opacity: isCancelled ? 0.6 : 1,
                      }}
                      onClick={() => onAppointmentClick(appt)}>
                      <p className="text-[10px] font-semibold text-gray-700 truncate">{formatTime(appt.scheduled_at)}</p>
                      <p className={cn('text-[11px] font-bold truncate mt-0.5', isCancelled ? 'text-gray-400 line-through' : 'text-plum-800')}>
                        {appt.status === 'blocked' ? '🚫 Bloqueado' : clientName(appt)}
                      </p>
                      {isCancelled && (
                        <p className="text-[10px] text-gray-400">{appt.status === 'cancelled' ? 'Cancelado' : 'No se presentó'}</p>
                      )}
                      {!isCancelled && appt.service && (
                        <p className="text-[10px] text-gray-500 truncate">{appt.service.name}</p>
                      )}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Agenda (main) ─────────────────────────────────────────────────────────────

export default function Agenda() {
  const [view, setView] = useState<'day' | 'week'>('day')
  const [currentDate, setCurrentDate] = useState<Date>(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d
  })
  const [slotTarget, setSlotTarget] = useState<SlotTarget | null>(null)
  const [bloqueoSlot, setBloqueoSlot] = useState<SlotTarget | null>(null)
  const [newTurnoOpen, setNewTurnoOpen] = useState(false)
  const [bloqueoOpen, setBloqueoOpen] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)
  const [isSobreTurno, setIsSobreTurno] = useState(false)
  const [prefill, setPrefill] = useState<TurnoPrefill | null>(null)
  const [showCancelled, setShowCancelled] = useState(false)

  const { data: therapists = [] } = useTherapists()

  const [startISO, endISO] = useMemo(() => {
    const dk = dateKey(currentDate)
    if (view === 'day') {
      // dk is a UTC date string; ART is UTC-3.
      // 07:00 ART = 10:00 UTC; 23:59 ART = 02:59 UTC next day.
      // Use next calendar day + T03:00:00 UTC to cover the full ART business day.
      const nextDay = new Date(currentDate)
      nextDay.setDate(nextDay.getDate() + 1)
      return [`${dk}T10:00:00`, `${dateKey(nextDay)}T03:00:00`]
    }
    const mon = getMonday(currentDate)
    const sun = new Date(mon); sun.setDate(sun.getDate() + 6); sun.setHours(23, 59, 59)
    return [`${dateKey(mon)}T00:00:00`, sun.toISOString()]
  }, [view, currentDate])

  const { data: appointments = [], isLoading } = useAppointments(startISO, endISO)

  function goToday() {
    const d = new Date(); d.setHours(0,0,0,0); setCurrentDate(d)
  }

  function prevPeriod() {
    setCurrentDate(d => {
      const n = new Date(d)
      view === 'day' ? n.setDate(n.getDate() - 1) : n.setDate(n.getDate() - 7)
      return n
    })
  }

  function nextPeriod() {
    setCurrentDate(d => {
      const n = new Date(d)
      view === 'day' ? n.setDate(n.getDate() + 1) : n.setDate(n.getDate() + 7)
      return n
    })
  }

  function openNewTurno(slot: SlotTarget, sobre = false) {
    setIsSobreTurno(sobre)
    setPrefill({ date: slot.date, time: fmtSlot(slot.hour, slot.minute), therapistId: slot.therapistId })
    setNewTurnoOpen(true)
  }

  const dateLabel = view === 'day'
    ? fmtDayHeader(currentDate)
    : fmtWeekRange(getMonday(currentDate))

  return (
    <div className="flex flex-col h-screen lg:h-screen overflow-hidden">
      {/* Top navigation bar */}
      <div className="flex-none flex items-center justify-between px-6 py-3 bg-white border-b z-20">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" className="w-8 h-8" onClick={prevPeriod}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" className="w-8 h-8" onClick={nextPeriod}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <h2 className="text-sm font-semibold text-plum-800 capitalize hidden sm:block">{dateLabel}</h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCancelled(v => !v)}
            className={cn(
              'text-xs px-2.5 py-1.5 rounded-md border font-medium transition-colors',
              showCancelled
                ? 'bg-gray-100 text-gray-700 border-gray-300'
                : 'bg-white text-muted-foreground border-input hover:bg-gray-50',
            )}
          >
            {showCancelled ? 'Ocultar cancelados' : 'Ver cancelados'}
          </button>
          <Button size="sm" onClick={() => { setPrefill(null); setIsSobreTurno(false); setNewTurnoOpen(true) }}>
            <Plus className="w-4 h-4 mr-1.5" />
            Nuevo turno
          </Button>
          <div className="flex border rounded-lg overflow-hidden text-sm">
            <button
              className={cn('px-3 py-1.5 font-medium transition-colors', view === 'day' ? 'bg-plum-800 text-white' : 'text-muted-foreground hover:bg-gray-50')}
              onClick={() => setView('day')}>
              Día
            </button>
            <button
              className={cn('px-3 py-1.5 font-medium transition-colors border-l', view === 'week' ? 'bg-plum-800 text-white' : 'text-muted-foreground hover:bg-gray-50')}
              onClick={() => setView('week')}>
              Semana
            </button>
          </div>
        </div>
      </div>

      {/* Date label mobile */}
      <div className="sm:hidden px-6 py-1.5 bg-white border-b">
        <p className="text-xs font-medium text-plum-800 capitalize">{dateLabel}</p>
      </div>

      {/* Calendar body */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4 pt-3 lg:px-6 lg:pb-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
          </div>
        ) : view === 'day' ? (
          <DayView
            date={currentDate}
            therapists={therapists}
            appointments={appointments}
            showCancelled={showCancelled}
            onSlotClick={setSlotTarget}
            onAppointmentClick={setSelectedAppt}
          />
        ) : (
          <WeekView
            weekStart={getMonday(currentDate)}
            appointments={appointments}
            showCancelled={showCancelled}
            onDayClick={(d) => { setCurrentDate(d); setView('day') }}
            onAppointmentClick={setSelectedAppt}
          />
        )}
      </div>

      {/* Slot popup menu */}
      {slotTarget && (
        <SlotMenu
          target={slotTarget}
          therapists={therapists}
          onNewTurno={() => openNewTurno(slotTarget, false)}
          onBloqueo={() => { setBloqueoSlot(slotTarget); setBloqueoOpen(true) }}
          onSobreTurno={() => openNewTurno(slotTarget, true)}
          onClose={() => setSlotTarget(null)}
        />
      )}

      {newTurnoOpen && (
        <NuevoTurnoModal
          open={newTurnoOpen}
          prefill={prefill}
          isSobreTurno={isSobreTurno}
          onClose={() => { setNewTurnoOpen(false); setSlotTarget(null); setPrefill(null) }}
        />
      )}
      {bloqueoOpen && bloqueoSlot && (
        <BloqueoModal
          slot={bloqueoSlot}
          therapists={therapists}
          onClose={() => { setBloqueoOpen(false); setBloqueoSlot(null) }}
        />
      )}
      {selectedAppt && (
        <AppointmentDetailModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Plus, Loader2 } from 'lucide-react'
import {
  useAppointments, useCreateAppointment, useUpdateAppointmentStatus,
  useServices, useTherapists,
} from '@/hooks/useAppointments'
import { useClients } from '@/hooks/useClients'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn, getWeekDays, formatTime, formatDate, DAYS_ES, MONTHS_ES } from '@/lib/utils'
import { Appointment, AppointmentStatus, Client } from '@/types'

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No presentado',
}

const STATUS_PILL: Record<AppointmentStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-orange-100 text-orange-700',
}

const TERMINAL: AppointmentStatus[] = ['completed', 'cancelled', 'no_show']

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

// ── Helpers ───────────────────────────────────────────────────────────────────

function clientFullName(client?: Appointment['client']) {
  if (!client) return 'Cliente'
  return [client.first_name, client.last_name].filter(Boolean).join(' ') || 'Cliente'
}

function apptEndTime(appt: Appointment) {
  const end = new Date(new Date(appt.scheduled_at).getTime() + appt.duration_minutes * 60_000)
  return formatTime(end)
}

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1))
  d.setHours(0, 0, 0, 0)
  return d
}

// ── AppointmentCard ───────────────────────────────────────────────────────────

function AppointmentCard({ appt, onClick }: { appt: Appointment; onClick: () => void }) {
  const color = appt.therapist?.color_hex ?? '#6b21a8'
  return (
    <div
      onClick={onClick}
      className="rounded-lg p-2.5 bg-white border border-gray-200 hover:shadow-md transition-shadow cursor-pointer"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <span className="text-[11px] font-medium text-plum-800">
          {formatTime(appt.scheduled_at)} – {apptEndTime(appt)}
        </span>
        <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap', STATUS_PILL[appt.status])}>
          {STATUS_LABELS[appt.status]}
        </span>
      </div>
      <p className="text-xs font-semibold text-plum-900 truncate">{clientFullName(appt.client)}</p>
      {appt.service && (
        <p className="text-[10px] text-muted-foreground truncate">{appt.service.name}</p>
      )}
      <div className="flex gap-2 mt-1 text-[10px] text-muted-foreground">
        <span>{appt.duration_minutes} min</span>
        {appt.box_number != null && <span>· Box {appt.box_number}</span>}
      </div>
    </div>
  )
}

// ── AppointmentDetailModal ────────────────────────────────────────────────────

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

  async function changeStatus(status: AppointmentStatus) {
    await updateStatus.mutateAsync({ id: appt.id, status })
    onClose()
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalle del Turno</DialogTitle>
          <DialogDescription>
            {formatDate(appt.scheduled_at)} · {formatTime(appt.scheduled_at)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Cliente" value={clientFullName(appt.client)} />
          <Field label="Servicio" value={appt.service?.name ?? '—'} />
          <Field label="Terapeuta" value={appt.therapist?.full_name ?? '—'} />
          <Field label="Duración" value={`${appt.duration_minutes} min`} />
          {appt.box_number != null && <Field label="Box" value={`Box ${appt.box_number}`} />}
          {appt.price_charged != null && (
            <Field label="Precio" value={`$${appt.price_charged}`} />
          )}
          {appt.deposit_amount != null && appt.deposit_amount > 0 && (
            <Field
              label="Seña"
              value={`$${appt.deposit_amount} · ${appt.deposit_paid ? 'Cobrada' : 'Pendiente'}`}
            />
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
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => changeStatus('completed')}
                disabled={updateStatus.isPending}
              >
                Completado
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => changeStatus('cancelled')}
                disabled={updateStatus.isPending}
              >
                Cancelado
              </Button>
              <Button
                size="sm"
                className="bg-orange-500 hover:bg-orange-600 text-white"
                onClick={() => changeStatus('no_show')}
                disabled={updateStatus.isPending}
              >
                No se presentó
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── ClientSearch ──────────────────────────────────────────────────────────────

function ClientSearch({
  selectedId,
  onSelect,
}: {
  selectedId: string
  onSelect: (id: string) => void
}) {
  const [inputValue, setInputValue] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const { data: clients } = useClients(inputValue.length >= 1 ? inputValue : undefined)

  useEffect(() => {
    if (!selectedId) setInputValue('')
  }, [selectedId])

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setInputValue(val)
    setOpen(val.length >= 1)
    if (!val) onSelect('')
  }

  function handleSelect(c: Client) {
    const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
    setInputValue(name)
    setOpen(false)
    onSelect(c.id)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={inputValue}
        onChange={handleChange}
        placeholder="Buscar cliente por nombre o teléfono..."
        autoComplete="off"
      />
      {open && clients && clients.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
          {clients.map(c => {
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
            return (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b last:border-b-0"
                onMouseDown={e => e.preventDefault()}
                onClick={() => handleSelect(c)}
              >
                <p className="font-medium text-plum-800">{name}</p>
                {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── NuevoTurnoModal ───────────────────────────────────────────────────────────

type TurnoForm = {
  client_id: string
  service_id: string
  therapist_id: string
  duration_minutes: 60 | 90
  box_number: 1 | 2 | 3
  date: string
  time: string
  deposit_amount: string
  deposit_paid: boolean
  notes: string
}

function NuevoTurnoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<TurnoForm>(() => ({
    client_id: '',
    service_id: '',
    therapist_id: '',
    duration_minutes: 60,
    box_number: 1,
    date: new Date().toISOString().split('T')[0],
    time: '10:00',
    deposit_amount: '',
    deposit_paid: false,
    notes: '',
  }))
  const [formError, setFormError] = useState<string | null>(null)
  const createAppt = useCreateAppointment()
  const { data: services } = useServices()
  const { data: therapists } = useTherapists()

  function set<K extends keyof TurnoForm>(key: K, value: TurnoForm[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.client_id) {
      setFormError('Por favor seleccioná un cliente.')
      return
    }
    const service = services?.find(s => s.id === form.service_id)
    try {
      await createAppt.mutateAsync({
        client_id: form.client_id,
        service_id: form.service_id,
        therapist_id: form.therapist_id,
        scheduled_at: new Date(`${form.date}T${form.time}:00`).toISOString(),
        duration_minutes: form.duration_minutes,
        box_number: form.box_number,
        status: 'pending',
        source: 'manual',
        price_charged: form.duration_minutes === 90 ? (service?.price_90 ?? service?.price_60) : (service?.price_60 ?? service?.price_90),
        deposit_amount: form.deposit_amount ? Number(form.deposit_amount) : 0,
        deposit_paid: form.deposit_paid,
        notes: form.notes || undefined,
      })
      onClose()
    } catch {
      setFormError('No se pudo guardar el turno. Intentá de nuevo.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo Turno</DialogTitle>
          <DialogDescription>Completá los datos del nuevo turno.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">

          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <ClientSearch selectedId={form.client_id} onSelect={id => set('client_id', id)} />
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
              {createAppt.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                : 'Guardar Turno'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Agenda (main) ─────────────────────────────────────────────────────────────

export default function Agenda() {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [newTurnoOpen, setNewTurnoOpen] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null)

  const weekDays = getWeekDays(weekStart)
  const startISO = weekDays[0].toISOString()
  const endISO = (() => {
    const e = new Date(weekDays[6])
    e.setHours(23, 59, 59, 999)
    return e.toISOString()
  })()

  const { data: appointments, isLoading, isError } = useAppointments(startISO, endISO)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  function prevWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })
  }
  function nextWeek() {
    setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })
  }
  function goToday() { setWeekStart(getMonday(new Date())) }

  function getApptsByDay(day: Date) {
    if (!appointments) return []
    return appointments
      .filter(a => {
        const d = new Date(a.scheduled_at)
        return d.getDate() === day.getDate() && d.getMonth() === day.getMonth() && d.getFullYear() === day.getFullYear()
      })
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
  }

  const monthLabel = `${MONTHS_ES[weekDays[0].getMonth()]} ${weekDays[0].getFullYear()}`

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Agenda</h1>
          <p className="text-muted-foreground text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setNewTurnoOpen(true)} className="flex items-center gap-1.5">
            <Plus className="w-4 h-4" />
            Nuevo Turno
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={prevWeek} className="w-8 h-8">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={nextWeek} className="w-8 h-8">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        {weekDays[0].getDate()} – {weekDays[6].getDate()} de {MONTHS_ES[weekDays[6].getMonth()]}
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 text-destructive">
          <p className="font-medium">Error al cargar los turnos</p>
          <p className="text-sm mt-1 text-muted-foreground">Verificá tu conexión e intentá de nuevo</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-7 gap-3">
          {weekDays.map((day, idx) => {
            const dayAppts = getApptsByDay(day)
            const isToday = day.getTime() === today.getTime()
            return (
              <div key={idx} className={cn('min-h-36', isToday && 'ring-2 ring-gold-500 ring-offset-1 rounded-xl')}>
                <div className={cn(
                  'flex sm:flex-col items-center sm:items-start gap-2 sm:gap-0 px-3 py-2 rounded-t-xl',
                  isToday ? 'bg-gold-500' : 'bg-plum-800',
                )}>
                  <span className={cn('text-xs font-medium', isToday ? 'text-plum-900' : 'text-plum-200')}>
                    {DAYS_ES[idx]}
                  </span>
                  <span className={cn('text-lg sm:text-2xl font-bold', isToday ? 'text-plum-900' : 'text-white')}>
                    {day.getDate()}
                  </span>
                  {dayAppts.length > 0 && (
                    <span className={cn(
                      'ml-auto sm:ml-0 text-xs font-medium px-1.5 py-0.5 rounded-full',
                      isToday ? 'bg-plum-800 text-white' : 'bg-plum-700 text-plum-200',
                    )}>
                      {dayAppts.length}
                    </span>
                  )}
                </div>
                <div className="bg-gray-50 rounded-b-xl p-2 space-y-2 min-h-24">
                  {dayAppts.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center pt-3 italic">Sin turnos</p>
                  ) : (
                    dayAppts.map(appt => (
                      <AppointmentCard key={appt.id} appt={appt} onClick={() => setSelectedAppt(appt)} />
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {newTurnoOpen && (
        <NuevoTurnoModal open={newTurnoOpen} onClose={() => setNewTurnoOpen(false)} />
      )}
      {selectedAppt && (
        <AppointmentDetailModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  )
}

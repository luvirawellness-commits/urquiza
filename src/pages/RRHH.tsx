import { useState, useEffect, useMemo, useRef } from 'react'
import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  Plus, Pencil, Loader2, Download, Check, ChevronLeft, ChevronRight, UserCheck, Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getArgentinaDateString } from '../utils/dateUtils'
import {
  useJobPositions, useEmployeeProfiles, useAllTenantUsers,
  useAbsences, useCCSSByMonth, useCompletedApptsByTherapist, useAbsencesByMonth, useNonCancelledApptsByTherapist,
  useHolidaysForYear, useHolidaysForMonth,
  useCreateJobPosition, useUpdateJobPosition,
  useCreateEmployee, useUpdateEmployee,
  useCreateAbsence, useUpsertCCSS, useUpdateCCSSStatus,
  useCreateHoliday, useDeleteHoliday,
  useSalaryIncreases, useBonusPayments, useVacationRecords,
  useCreateSalaryIncrease, useRegisterBonusPayment, useRegisterVacationPayment,
  calcMonthScheduleHours, calcHolidayBonus,
  type JobPosition, type EmployeeProfile, type EmployeeCCSS, type Holiday, type HolidayDetail,
  type WeeklySchedule, type SalaryIncrease,
} from '@/hooks/useRRHH'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn, MONTHS_ES, exportToExcel } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

const RRHH_PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'safe', label: 'Caja fuerte 🔒' },
]

const ABSENCE_LABELS: Record<string, string> = {
  absence: 'Ausencia', vacation: 'Vacaciones', medical: 'Médica', other: 'Otro',
}
const ABSENCE_COLORS: Record<string, string> = {
  absence: 'bg-red-100 text-red-700',
  vacation: 'bg-blue-100 text-blue-700',
  medical: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
}

function fmtARS(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

function initials(name?: string | null) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function fmtHolidayDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

// ── Tab 1: Puestos ────────────────────────────────────────────────────────────

type PuestoForm = {
  name: string
  contract_type: 'hourly' | 'monthly'
  hourly_rate: string
  monthly_salary: string
  expected_monthly_hours: string
  active: boolean
}

function PuestoModal({
  open, onClose, editing,
}: { open: boolean; onClose: () => void; editing?: JobPosition | null }) {
  const [form, setForm] = useState<PuestoForm>({
    name: '', contract_type: 'hourly', hourly_rate: '', monthly_salary: '',
    expected_monthly_hours: '160', active: true,
  })
  const [error, setError] = useState('')
  const createPos = useCreateJobPosition()
  const updatePos = useUpdateJobPosition()

  useEffect(() => {
    if (editing) {
      setForm({
        name: editing.name,
        contract_type: editing.contract_type,
        hourly_rate: editing.hourly_rate?.toString() ?? '',
        monthly_salary: editing.monthly_salary?.toString() ?? '',
        expected_monthly_hours: editing.expected_monthly_hours.toString(),
        active: editing.active,
      })
    } else {
      setForm({ name: '', contract_type: 'hourly', hourly_rate: '', monthly_salary: '', expected_monthly_hours: '160', active: true })
    }
    setError('')
  }, [editing, open])

  function set<K extends keyof PuestoForm>(k: K, v: PuestoForm[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio'); return }
    setError('')
    const payload = {
      name: form.name.trim(),
      contract_type: form.contract_type,
      hourly_rate: form.contract_type === 'hourly' && form.hourly_rate ? parseFloat(form.hourly_rate) : null,
      monthly_salary: form.contract_type === 'monthly' && form.monthly_salary ? parseFloat(form.monthly_salary) : null,
      expected_monthly_hours: parseFloat(form.expected_monthly_hours) || 160,
      active: form.active,
    }
    try {
      if (editing) {
        await updatePos.mutateAsync({ id: editing.id, ...payload })
      } else {
        await createPos.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  const busy = createPos.isPending || updatePos.isPending

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Puesto' : 'Nuevo Puesto'}</DialogTitle>
          <DialogDescription>Configurá el tipo de contrato y la tarifa.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Nombre del puesto *</Label>
            <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ej: Masoterapeuta" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de contrato</Label>
            <div className="flex gap-3">
              {(['hourly', 'monthly'] as const).map(ct => (
                <label key={ct} className={cn(
                  'flex items-center gap-2 px-3 py-2 border rounded-lg cursor-pointer text-sm flex-1 justify-center',
                  form.contract_type === ct ? 'border-plum-800 bg-plum-50' : 'hover:bg-gray-50',
                )}>
                  <input type="radio" name="ct" value={ct} checked={form.contract_type === ct}
                    onChange={() => set('contract_type', ct)} className="accent-plum-800" />
                  {ct === 'hourly' ? 'Por hora' : 'Mensual fijo'}
                </label>
              ))}
            </div>
          </div>
          {form.contract_type === 'hourly' ? (
            <div className="space-y-1.5">
              <Label>Tarifa por hora ($)</Label>
              <Input type="number" min="0" step="0.01" value={form.hourly_rate}
                onChange={e => set('hourly_rate', e.target.value)} placeholder="7320.40" />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Sueldo mensual ($)</Label>
              <Input type="number" min="0" step="1" value={form.monthly_salary}
                onChange={e => set('monthly_salary', e.target.value)} placeholder="350000" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Horas mensuales esperadas</Label>
            <Input type="number" min="0" max="300" value={form.expected_monthly_hours}
              onChange={e => set('expected_monthly_hours', e.target.value)} />
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="w-4 h-4" />
              Puesto activo
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {editing ? 'Guardar cambios' : 'Crear puesto'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PuestosTab() {
  const { data: positions = [], isLoading } = useJobPositions()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<JobPosition | null>(null)
  const updatePos = useUpdateJobPosition()

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true) }}>
          <Plus className="w-4 h-4 mr-1.5" />Nuevo Puesto
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Nombre', 'Tipo', 'Tarifa / Sueldo', 'Hs mensuales', 'Activo', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-plum-800">{p.name}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={p.contract_type === 'hourly' ? 'border-amber-300 text-amber-700' : 'border-blue-300 text-blue-700'}>
                      {p.contract_type === 'hourly' ? 'Por hora' : 'Mensual fijo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {p.contract_type === 'hourly'
                      ? `${fmtARS(p.hourly_rate ?? 0)}/h`
                      : fmtARS(p.monthly_salary ?? 0)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{p.expected_monthly_hours}h</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updatePos.mutate({ id: p.id, active: !p.active })}
                      className={cn(
                        'w-10 h-5 rounded-full transition-colors relative',
                        p.active ? 'bg-green-500' : 'bg-gray-200',
                      )}>
                      <span className={cn(
                        'absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform',
                        p.active ? 'translate-x-5' : 'translate-x-0.5',
                      )} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="w-8 h-8"
                      onClick={() => { setEditing(p); setModalOpen(true) }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PuestoModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  )
}

// ── Tab 2: Empleados ──────────────────────────────────────────────────────────

type EmpleadoForm = {
  user_id: string; job_position_id: string; start_date: string
  expected_monthly_hours: string
  productivity_threshold_1: string; productivity_bonus_1: string
  productivity_threshold_2: string; productivity_bonus_2: string
  notes: string; active: boolean
  weekly_schedule: WeeklySchedule
}

const WEEK_DAYS: { key: keyof WeeklySchedule; label: string }[] = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
]

function EmpleadoModal({
  open, onClose, editing,
}: { open: boolean; onClose: () => void; editing?: EmployeeProfile | null }) {
  const { data: users = [] } = useAllTenantUsers()
  const { data: positions = [] } = useJobPositions()
  const { data: employees = [] } = useEmployeeProfiles()
  const createEmp = useCreateEmployee()
  const updateEmp = useUpdateEmployee()

  const [form, setForm] = useState<EmpleadoForm>({
    user_id: '', job_position_id: '', start_date: getArgentinaDateString(),
    expected_monthly_hours: '160',
    productivity_threshold_1: '', productivity_bonus_1: '',
    productivity_threshold_2: '', productivity_bonus_2: '',
    notes: '', active: true, weekly_schedule: {},
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (editing) {
      setForm({
        user_id: editing.user_id,
        job_position_id: editing.job_position_id,
        start_date: editing.start_date,
        expected_monthly_hours: editing.expected_monthly_hours.toString(),
        productivity_threshold_1: editing.productivity_threshold_1?.toString() ?? '',
        productivity_bonus_1: editing.productivity_bonus_1?.toString() ?? '',
        productivity_threshold_2: editing.productivity_threshold_2?.toString() ?? '',
        productivity_bonus_2: editing.productivity_bonus_2?.toString() ?? '',
        notes: editing.notes ?? '',
        active: editing.active,
        weekly_schedule: editing.weekly_schedule ?? {},
      })
    } else {
      setForm({
        user_id: '', job_position_id: '', start_date: getArgentinaDateString(),
        expected_monthly_hours: '160',
        productivity_threshold_1: '', productivity_bonus_1: '',
        productivity_threshold_2: '', productivity_bonus_2: '',
        notes: '', active: true, weekly_schedule: {},
      })
    }
    setError('')
  }, [editing, open])

  const existingUserIds = employees.map(e => e.user_id)
  const availableUsers = editing
    ? users
    : users.filter(u => !existingUserIds.includes(u.id))

  function set<K extends keyof EmpleadoForm>(k: K, v: EmpleadoForm[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  function onPositionChange(posId: string) {
    const pos = positions.find(p => p.id === posId)
    setForm(p => ({
      ...p,
      job_position_id: posId,
      expected_monthly_hours: pos ? pos.expected_monthly_hours.toString() : p.expected_monthly_hours,
    }))
  }

  async function handleSave() {
    if (!form.user_id) { setError('Seleccioná un usuario'); return }
    if (!form.job_position_id) { setError('Seleccioná un puesto'); return }
    setError('')
    const payload = {
      user_id: form.user_id,
      job_position_id: form.job_position_id,
      start_date: form.start_date,
      expected_monthly_hours: parseFloat(form.expected_monthly_hours) || 160,
      productivity_threshold_1: form.productivity_threshold_1 ? parseFloat(form.productivity_threshold_1) : null,
      productivity_bonus_1: form.productivity_bonus_1 ? parseFloat(form.productivity_bonus_1) : null,
      productivity_threshold_2: form.productivity_threshold_2 ? parseFloat(form.productivity_threshold_2) : null,
      productivity_bonus_2: form.productivity_bonus_2 ? parseFloat(form.productivity_bonus_2) : null,
      notes: form.notes || null,
      weekly_schedule: Object.keys(form.weekly_schedule).length > 0 ? form.weekly_schedule : null,
    }
    try {
      if (editing) {
        await updateEmp.mutateAsync({ id: editing.id, ...payload, active: form.active })
      } else {
        await createEmp.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  const busy = createEmp.isPending || updateEmp.isPending

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar Empleado' : 'Nuevo Empleado'}</DialogTitle>
          <DialogDescription>Configurá el perfil laboral del empleado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Usuario *</Label>
              <select value={form.user_id} onChange={e => set('user_id', e.target.value)}
                disabled={!!editing} className={SELECT_CLS}>
                <option value="">Seleccionar...</option>
                {availableUsers.map(u => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Puesto *</Label>
              <select value={form.job_position_id} onChange={e => onPositionChange(e.target.value)} className={SELECT_CLS}>
                <option value="">Seleccionar...</option>
                {positions.filter(p => p.active).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha de inicio</Label>
              <Input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Horas mensuales esperadas</Label>
              <Input type="number" min="0" value={form.expected_monthly_hours}
                onChange={e => set('expected_monthly_hours', e.target.value)} />
            </div>
          </div>
          <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Productividad</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Umbral 1 (sesiones)</Label>
                <Input type="number" min="0" placeholder="ej: 40"
                  value={form.productivity_threshold_1} onChange={e => set('productivity_threshold_1', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bono 1 ($)</Label>
                <Input type="number" min="0" placeholder="ej: 15000"
                  value={form.productivity_bonus_1} onChange={e => set('productivity_bonus_1', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Umbral 2 (sesiones)</Label>
                <Input type="number" min="0" placeholder="ej: 55"
                  value={form.productivity_threshold_2} onChange={e => set('productivity_threshold_2', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Bono 2 ($)</Label>
                <Input type="number" min="0" placeholder="ej: 25000"
                  value={form.productivity_bonus_2} onChange={e => set('productivity_bonus_2', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Horario semanal</p>
            {WEEK_DAYS.map(({ key, label }) => {
              const intervals = form.weekly_schedule[key] ?? []
              const enabled = intervals.length > 0
              return (
                <div key={key} className="flex items-start gap-3 py-1 border-b border-gray-100 last:border-b-0">
                  <label className="flex items-center gap-2 w-28 flex-shrink-0 pt-1.5 cursor-pointer">
                    <input type="checkbox" checked={enabled}
                      onChange={e => {
                        if (e.target.checked) {
                          setForm(p => ({ ...p, weekly_schedule: { ...p.weekly_schedule, [key]: [{ from: '09:00', to: '18:00' }] } }))
                        } else {
                          setForm(p => {
                            const { [key]: _removed, ...rest } = p.weekly_schedule
                            return { ...p, weekly_schedule: rest }
                          })
                        }
                      }}
                      className="w-4 h-4 rounded" />
                    <span className="text-sm">{label}</span>
                  </label>
                  {enabled && (
                    <div className="flex-1 space-y-1.5">
                      {intervals.map((interval, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input type="time" value={interval.from}
                            onChange={e => {
                              const updated = intervals.map((iv, i) => i === idx ? { ...iv, from: e.target.value } : iv)
                              setForm(p => ({ ...p, weekly_schedule: { ...p.weekly_schedule, [key]: updated } }))
                            }}
                            className="h-8 text-sm w-28" />
                          <span className="text-muted-foreground text-xs">–</span>
                          <Input type="time" value={interval.to}
                            onChange={e => {
                              const updated = intervals.map((iv, i) => i === idx ? { ...iv, to: e.target.value } : iv)
                              setForm(p => ({ ...p, weekly_schedule: { ...p.weekly_schedule, [key]: updated } }))
                            }}
                            className="h-8 text-sm w-28" />
                          {intervals.length > 1 && (
                            <button type="button"
                              onClick={() => {
                                const updated = intervals.filter((_, i) => i !== idx)
                                setForm(p => ({ ...p, weekly_schedule: { ...p.weekly_schedule, [key]: updated } }))
                              }}
                              className="text-muted-foreground hover:text-red-500 text-lg leading-none">×</button>
                          )}
                        </div>
                      ))}
                      <button type="button"
                        onClick={() => {
                          setForm(p => ({ ...p, weekly_schedule: { ...p.weekly_schedule, [key]: [...intervals, { from: '09:00', to: '18:00' }] } }))
                        }}
                        className="text-xs text-plum-700 hover:underline">+ Agregar intervalo</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Input value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Observaciones..." />
          </div>
          {editing && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} className="w-4 h-4" />
              Empleado activo
            </label>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              {editing ? 'Guardar cambios' : 'Crear empleado'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EmpleadosTab() {
  const { data: employees = [], isLoading } = useEmployeeProfiles()
  const updateEmp = useUpdateEmployee()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeProfile | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            exportToExcel(
              employees.map((emp) => ({
                'Empleado': emp.user?.full_name ?? '',
                'Puesto': emp.position?.name ?? '',
                'Contrato': emp.position?.contract_type === 'hourly' ? 'Por hora' : 'Mensual',
                'Inicio': emp.start_date ?? '',
                'Hs/mes': emp.expected_monthly_hours ?? '',
                'Umbral 1 (ses.)': emp.productivity_threshold_1 ?? '',
                'Bono 1': emp.productivity_bonus_1 ?? '',
                'Umbral 2 (ses.)': emp.productivity_threshold_2 ?? '',
                'Bono 2': emp.productivity_bonus_2 ?? '',
                'Activo': emp.active ? 'Sí' : 'No',
              })),
              'empleados.xlsx',
              'Empleados',
            )
          }
          disabled={employees.length === 0}
        >
          <Download className="w-4 h-4 mr-1.5" />
          Exportar Excel
        </Button>
        <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true) }}>
          <Plus className="w-4 h-4 mr-1.5" />Nuevo Empleado
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
      ) : (
        <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Empleado', 'Puesto', 'Inicio', 'Hs/mes', 'Umbral 1', 'Umbral 2', 'Activo', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}>
                        {initials(emp.user?.full_name)}
                      </div>
                      <div>
                        <p className="font-medium text-plum-800">{emp.user?.full_name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{emp.position?.contract_type === 'hourly' ? 'Por hora' : 'Mensual'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{emp.position?.name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{emp.start_date}</td>
                  <td className="px-4 py-3 tabular-nums">{emp.expected_monthly_hours}h</td>
                  <td className="px-4 py-3 text-xs">
                    {emp.productivity_threshold_1
                      ? <span>{emp.productivity_threshold_1} ses → {fmtARS(emp.productivity_bonus_1 ?? 0)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {emp.productivity_threshold_2
                      ? <span>{emp.productivity_threshold_2} ses → {fmtARS(emp.productivity_bonus_2 ?? 0)}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => updateEmp.mutate({ id: emp.id, active: !emp.active })}
                      className={cn('w-10 h-5 rounded-full transition-colors relative', emp.active ? 'bg-green-500' : 'bg-gray-200')}>
                      <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform', emp.active ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="w-8 h-8"
                      onClick={() => { setEditing(emp); setModalOpen(true) }}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EmpleadoModal open={modalOpen} onClose={() => setModalOpen(false)} editing={editing} />
    </div>
  )
}

// ── Tab 3: Liquidación ────────────────────────────────────────────────────────

type CardData = {
  emp: EmployeeProfile
  horasEsperadas: number
  horasSchedule: number
  horasAusentes: number
  horasNetas: number
  sessionCount: number
  sessionHours: number
  bonus1Earned: boolean
  bonus2Earned: boolean
  bonusTotal: number
  baseSueldo: number
  holidayDetails: HolidayDetail[]
  holidayHours: number
  holidayBonus: number
  subtotal: number
  ccssEntry?: EmployeeCCSS
}

function computeCard(
  emp: EmployeeProfile,
  year: number, month: number,
  appts: { therapist_id: string; duration_minutes: number }[],
  absences: { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[],
  ccssData: EmployeeCCSS[],
  holidays: Holiday[],
): CardData {
  const horasEsperadas = emp.expected_monthly_hours
  const horasSchedule = calcMonthScheduleHours(emp.user?.schedule, year, month) || horasEsperadas

  const empAppts = appts.filter(a => a.therapist_id === emp.user_id)
  const sessionCount = empAppts.length
  const sessionHours = Math.round(empAppts.reduce((s, a) => s + a.duration_minutes / 60, 0) * 100) / 100

  const empAbsDeductible = absences.filter(a => a.user_id === emp.user_id && a.deduct_from_salary)
  const empAbsAll = absences.filter(a => a.user_id === emp.user_id)
  const horasAusentes = Math.round(empAbsAll.reduce((s, a) => s + a.hours_absent, 0) * 100) / 100
  const horasDeductibles = Math.round(empAbsDeductible.reduce((s, a) => s + a.hours_absent, 0) * 100) / 100
  const horasNetas = Math.max(0, Math.round((horasSchedule - horasDeductibles) * 100) / 100)

  const bonus1Earned = emp.productivity_threshold_1 != null && sessionCount >= emp.productivity_threshold_1
  const bonus2Earned = emp.productivity_threshold_2 != null && sessionCount >= emp.productivity_threshold_2
  const bonusTotal = (bonus1Earned ? (emp.productivity_bonus_1 ?? 0) : 0) + (bonus2Earned ? (emp.productivity_bonus_2 ?? 0) : 0)

  let baseSueldo = 0
  if (emp.position?.contract_type === 'hourly') {
    baseSueldo = Math.round(horasNetas * (emp.position.hourly_rate ?? 0))
  } else {
    const sal = emp.position?.monthly_salary ?? 0
    const hrs = emp.expected_monthly_hours || 160
    baseSueldo = Math.round(sal - (sal / hrs) * horasDeductibles)
  }

  const employeeAbsences = absences
    .filter(a => a.user_id === emp.user_id)
    .map(a => ({ date: a.date, deduct_from_salary: a.deduct_from_salary }))
  const holidayDetails = emp.position?.contract_type === 'hourly'
    ? calcHolidayBonus(emp.user?.schedule, emp.position.hourly_rate ?? 0, holidays, employeeAbsences)
    : []
  const holidayHours = Math.round(holidayDetails.reduce((s, h) => s + h.hours, 0) * 100) / 100
  const holidayBonus = holidayDetails.reduce((s, h) => s + h.bonus, 0)
  const subtotal = baseSueldo + holidayBonus + bonusTotal
  const ccssEntry = ccssData.find(c => c.user_id === emp.user_id)
  return { emp, horasEsperadas, horasSchedule, horasAusentes, horasNetas, sessionCount, sessionHours, bonus1Earned, bonus2Earned, bonusTotal, baseSueldo, holidayDetails, holidayHours, holidayBonus, subtotal, ccssEntry }
}

function CcssSection({ card, yearMonth }: { card: CardData; yearMonth: string }) {
  const [inputAmt, setInputAmt] = useState('')
  const [editMode, setEditMode] = useState(false)
  const upsertCCSS = useUpsertCCSS()
  const updateStatus = useUpdateCCSSStatus()

  const ccss = card.ccssEntry
  const ccssAmount = ccss?.amount ?? 0
  const total = card.subtotal + ccssAmount

  async function handleSaveCCSS() {
    const amt = parseFloat(inputAmt)
    if (isNaN(amt) || amt < 0) return
    await upsertCCSS.mutateAsync({
      user_id: card.emp.user_id,
      period_month: `${yearMonth}-01`,
      amount: amt,
    })
    setEditMode(false)
    setInputAmt('')
  }

  return (
    <>
      {/* CCSS */}
      <div className="border-t pt-3 mt-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CCSS</p>
        {!ccss || editMode ? (
          <div className="flex gap-2 items-center">
            <Input type="number" min="0" step="1" placeholder="Monto CCSS..."
              value={inputAmt} onChange={e => setInputAmt(e.target.value)}
              className="h-8 text-sm" />
            <Button size="sm" onClick={handleSaveCCSS} disabled={upsertCCSS.isPending}>
              {upsertCCSS.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Guardar'}
            </Button>
            {editMode && <Button size="sm" variant="ghost" onClick={() => setEditMode(false)}>Cancelar</Button>}
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium tabular-nums">{fmtARS(ccss.amount)}</span>
              <button
                onClick={() => updateStatus.mutateAsync({ id: ccss.id, status: ccss.status === 'paid' ? 'pending' : 'paid' })}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full font-medium border transition-colors',
                  ccss.status === 'paid' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200',
                )}>
                {ccss.status === 'paid' ? 'Pagado' : 'Pendiente'}
              </button>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setInputAmt(ccss.amount.toString()); setEditMode(true) }}>
              Editar
            </Button>
          </div>
        )}
      </div>

      {/* Total */}
      <div className="border-t border-gold-300 pt-3 mt-2 bg-gold-50 -mx-4 px-4 pb-3 rounded-b-xl">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-plum-800">Total a cobrar</span>
          <span className="text-xl font-bold text-gold-600 tabular-nums">{fmtARS(total)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 flex justify-between">
          <span>Subtotal bruto: {fmtARS(card.subtotal)}</span>
          <span>CCSS: {fmtARS(ccssAmount)}</span>
        </div>
      </div>
    </>
  )
}

function EmployeeLiquidacionCard({ card, yearMonth }: { card: CardData; yearMonth: string }) {
  const emp = card.emp
  const isHourly = emp.position?.contract_type === 'hourly'
  const cardRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pdfLoading, setPdfLoading] = useState(false)

  async function downloadPDF() {
    if (!cardRef.current) return
    setPdfLoading(true)
    if (btnRef.current) btnRef.current.style.visibility = 'hidden'
    try {
      const canvas = await html2canvas(cardRef.current, { scale: 2, useCORS: true })
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageWidth = pdf.internal.pageSize.getWidth()
      const margin = 10
      const imgWidth = pageWidth - margin * 2
      const imgHeight = (canvas.height * imgWidth) / canvas.width
      pdf.addImage(imgData, 'PNG', margin, margin, imgWidth, imgHeight)
      const [y, m] = yearMonth.split('-')
      const monthName = MONTHS_ES[parseInt(m) - 1]?.toLowerCase() ?? m
      const safeName = (emp.user?.full_name ?? 'empleado')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '_')
      pdf.save(`liquidacion_${safeName}_${monthName}_${y}.pdf`)
    } finally {
      if (btnRef.current) btnRef.current.style.visibility = ''
      setPdfLoading(false)
    }
  }

  return (
    <Card ref={cardRef}>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}>
              {initials(emp.user?.full_name)}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-plum-800 truncate">{emp.user?.full_name}</p>
              <p className="text-xs text-muted-foreground">{emp.position?.name} · {isHourly ? 'Por hora' : 'Mensual'}</p>
            </div>
          </div>
          <Button
            ref={btnRef}
            variant="outline"
            size="sm"
            onClick={downloadPDF}
            disabled={pdfLoading}
            className="flex-shrink-0"
          >
            {pdfLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <><Download className="w-4 h-4 mr-1.5" />Descargar PDF</>
            }
          </Button>
        </div>

        {/* Horas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Hs esperadas', value: `${card.horasEsperadas}h` },
            { label: 'Hs schedule', value: `${card.horasSchedule}h` },
            { label: 'Hs ausentes', value: `${card.horasAusentes}h`, red: card.horasAusentes > 0 },
            { label: 'Hs netas', value: `${card.horasNetas}h`, bold: true },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 rounded-lg p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">{item.label}</p>
              <p className={cn('text-sm font-semibold mt-0.5', item.bold ? 'text-plum-800' : '', item.red ? 'text-red-600' : '')}>
                {item.value}
              </p>
            </div>
          ))}
        </div>

        {/* Sesiones */}
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sesiones</p>
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <span className="text-2xl font-bold text-plum-800">{card.sessionCount}</span>
              <span className="text-xs text-muted-foreground ml-1">sesiones · {card.sessionHours}h</span>
            </div>
            {emp.productivity_threshold_1 != null && (
              <div className={cn('flex items-center gap-1.5 text-sm', card.bonus1Earned ? 'text-green-700' : 'text-muted-foreground')}>
                {card.bonus1Earned ? <Check className="w-4 h-4" /> : <span className="w-4 h-4 text-center text-xs">○</span>}
                <span>{emp.productivity_threshold_1} ses → {fmtARS(emp.productivity_bonus_1 ?? 0)}</span>
              </div>
            )}
            {emp.productivity_threshold_2 != null && (
              <div className={cn('flex items-center gap-1.5 text-sm', card.bonus2Earned ? 'text-green-700' : 'text-muted-foreground')}>
                {card.bonus2Earned ? <Check className="w-4 h-4" /> : <span className="w-4 h-4 text-center text-xs">○</span>}
                <span>{emp.productivity_threshold_2} ses → {fmtARS(emp.productivity_bonus_2 ?? 0)}</span>
              </div>
            )}
            {card.bonusTotal > 0 && (
              <Badge className="bg-green-100 text-green-800 border-green-200">
                Bono: {fmtARS(card.bonusTotal)}
              </Badge>
            )}
          </div>
        </div>

        {/* Sueldo */}
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Liquidación</p>
          <div className="space-y-1 text-sm">
            {isHourly ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Horas normales: {card.horasNetas}h × {fmtARS(emp.position?.hourly_rate ?? 0)}/h</span>
                  <span className="tabular-nums">{fmtARS(card.baseSueldo)}</span>
                </div>
                {card.holidayDetails.length > 0 && (
                  <div className="space-y-0.5">
                    <div className="flex justify-between text-amber-700">
                      <span>Adicional feriados: {card.holidayHours}h × {fmtARS(emp.position?.hourly_rate ?? 0)}/h</span>
                      <span className="tabular-nums">+{fmtARS(card.holidayBonus)}</span>
                    </div>
                    {card.holidayDetails.map(hd => (
                      <div key={hd.date} className="flex justify-between text-xs text-amber-600 pl-3">
                        <span>{hd.date.slice(5).replace('-', '/')} {hd.name}: {hd.hours}hs</span>
                        <span className="tabular-nums">{fmtARS(hd.bonus)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sueldo mensual</span>
                  <span className="tabular-nums">{fmtARS(emp.position?.monthly_salary ?? 0)}</span>
                </div>
                {card.horasAusentes > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Descuento ausencias ({card.horasAusentes}h)</span>
                    <span className="tabular-nums">-{fmtARS((emp.position?.monthly_salary ?? 0) - card.baseSueldo)}</span>
                  </div>
                )}
              </>
            )}
            {card.bonusTotal > 0 && (
              <div className="flex justify-between text-green-700">
                <span>Bono productividad</span>
                <span className="tabular-nums">+{fmtARS(card.bonusTotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t pt-1">
              <span>Subtotal bruto</span>
              <span className="tabular-nums text-plum-800">{fmtARS(card.subtotal)}</span>
            </div>
          </div>
        </div>

        <CcssSection card={card} yearMonth={yearMonth} />
      </CardContent>
    </Card>
  )
}

function exportExcel(cards: CardData[], yearMonth: string) {
  const data = cards.map(c => ({
    'Empleado': c.emp.user?.full_name ?? '',
    'Puesto': c.emp.position?.name ?? '',
    'Tipo': c.emp.position?.contract_type === 'hourly' ? 'Por hora' : 'Mensual',
    'H.Esperadas': c.horasEsperadas,
    'H.Schedule': c.horasSchedule,
    'H.Ausentes': c.horasAusentes,
    'H.Netas': c.horasNetas,
    'Sesiones': c.sessionCount,
    'Bono': c.bonusTotal,
    'Base Sueldo': c.baseSueldo,
    'Adicional Feriados': c.holidayBonus,
    'Subtotal': c.subtotal,
    'CCSS': c.ccssEntry?.amount ?? 0,
    'Total': c.subtotal + (c.ccssEntry?.amount ?? 0),
  }))
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Liquidación')
  XLSX.writeFile(wb, `liquidacion-${yearMonth}.xlsx`)
}

function LiquidacionTab() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`

  const { data: employees = [], isLoading: empLoading } = useEmployeeProfiles()
  const { data: appts = [], isLoading: apptLoading } = useCompletedApptsByTherapist(yearMonth)
  const { data: absenceData = [], isLoading: absLoading } = useAbsencesByMonth(yearMonth)
  const { data: ccssData = [], isLoading: ccssLoading } = useCCSSByMonth(yearMonth)
  const { data: holidays = [], isLoading: holLoading } = useHolidaysForMonth(yearMonth)

  const isLoading = empLoading || apptLoading || absLoading || ccssLoading || holLoading

  const activeEmployees = employees.filter(e => e.active)

  const cards = useMemo(() =>
    activeEmployees.map(emp => computeCard(emp, year, month, appts, absenceData, ccssData, holidays)),
    [activeEmployees, year, month, appts, absenceData, ccssData, holidays],
  )

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) } else setMonth(m => m + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={prevMonth}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-base font-semibold text-plum-800 min-w-[130px] text-center capitalize">
            {MONTHS_ES[month - 1]} {year}
          </span>
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={nextMonth}><ChevronRight className="w-4 h-4" /></Button>
        </div>
        <Button variant="outline" size="sm" onClick={() => exportExcel(cards, yearMonth)} disabled={cards.length === 0}>
          <Download className="w-4 h-4 mr-1.5" />Exportar resumen
        </Button>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800 space-y-0.5">
        <p className="font-semibold">Al registrar pagos de sueldos en Caja</p>
        <p>• Empleados por hora (masoterapeutas, recepción, yoga) → <strong>Sueldos Operativos</strong></p>
        <p>• Empleados mensuales (gestión, administración) → <strong>Sueldos Administrativos</strong></p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
      ) : activeEmployees.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay empleados activos</p>
          <p className="text-sm mt-1">Agregá empleados en la pestaña Empleados.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => (
            <EmployeeLiquidacionCard key={card.emp.id} card={card} yearMonth={yearMonth} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Tab 4: Ausencias ──────────────────────────────────────────────────────────

function AusenciaModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, profile } = useAuth()
  const { data: employees = [] } = useEmployeeProfiles()
  const createAbsence = useCreateAbsence()

  const isTherapist = profile?.role === 'therapist'
  const myProfile = employees.find(e => e.user_id === user?.id)

  const [form, setForm] = useState({
    user_id: isTherapist && myProfile ? myProfile.user_id : '',
    date: getArgentinaDateString(),
    type: 'absence' as const,
    hours_absent: '8',
    reason: '',
    deduct_from_salary: true,
  })
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      const autoUserId = isTherapist && myProfile ? myProfile.user_id : ''
      setForm({
        user_id: autoUserId, date: getArgentinaDateString(),
        type: 'absence', hours_absent: '8', reason: '', deduct_from_salary: true,
      })
      setError('')
    }
  }, [open, isTherapist, myProfile])

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function handleSave() {
    if (!form.user_id) { setError('Seleccioná un empleado'); return }
    const hrs = parseFloat(form.hours_absent)
    if (!hrs || hrs <= 0) { setError('Las horas ausentes deben ser mayor a 0'); return }
    setError('')
    try {
      await createAbsence.mutateAsync({
        user_id: form.user_id,
        date: form.date,
        type: form.type,
        hours_absent: hrs,
        reason: form.reason || undefined,
        deduct_from_salary: form.deduct_from_salary,
        registered_by: user!.id,
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al registrar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar Ausencia</DialogTitle>
          <DialogDescription>Registrá una ausencia o vacación del empleado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Empleado *</Label>
            <select value={form.user_id} onChange={e => set('user_id', e.target.value)}
              disabled={isTherapist} className={SELECT_CLS}>
              <option value="">Seleccionar...</option>
              {employees.map(e => (
                <option key={e.user_id} value={e.user_id}>{e.user?.full_name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Fecha</Label>
              <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Horas ausentes</Label>
              <Input type="number" min="0.5" max="24" step="0.5" value={form.hours_absent}
                onChange={e => set('hours_absent', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <select value={form.type} onChange={e => set('type', e.target.value as typeof form.type)} className={SELECT_CLS}>
              <option value="absence">Ausencia</option>
              <option value="vacation">Vacaciones</option>
              <option value="medical">Médica</option>
              <option value="other">Otro</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Motivo</Label>
            <Input value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Descripción opcional..." />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.deduct_from_salary} onChange={e => set('deduct_from_salary', e.target.checked)} className="w-4 h-4" />
            Descontar del sueldo
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={createAbsence.isPending}>
              {createAbsence.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Registrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AusenciasTab() {
  const { data: absences = [], isLoading } = useAbsences()
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" />Registrar Ausencia
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
      ) : (
        <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Empleado', 'Fecha', 'Horas', 'Tipo', 'Motivo', 'Descuenta', 'Registrado por'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {absences.length === 0 ? (
                <tr><td colSpan={7} className="py-10 text-center text-muted-foreground text-sm">Sin ausencias registradas</td></tr>
              ) : absences.map(a => (
                <tr key={a.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-plum-800">{a.employee_user?.full_name ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{a.date}</td>
                  <td className="px-4 py-3 tabular-nums">{a.hours_absent}h</td>
                  <td className="px-4 py-3">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ABSENCE_COLORS[a.type])}>
                      {ABSENCE_LABELS[a.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <div className="space-y-1">
                      {a.appointment_id && (
                        <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded font-medium bg-blue-100 text-blue-700">
                          Desde agenda
                        </span>
                      )}
                      <p className="text-sm text-muted-foreground truncate">{a.reason ?? '—'}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {a.deduct_from_salary
                      ? <span className="text-xs text-red-600 font-medium">Sí</span>
                      : <span className="text-xs text-muted-foreground">No</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{a.registrar?.full_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AusenciaModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

// ── Tab 5: Feriados ───────────────────────────────────────────────────────────

function AgregarFeriadoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const createHoliday = useCreateHoliday()
  const [date, setDate] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setDate(''); setName(''); setError('') }
  }, [open])

  async function handleSave() {
    if (!date) { setError('La fecha es obligatoria'); return }
    if (!name.trim()) { setError('El nombre es obligatorio'); return }
    setError('')
    try {
      await createHoliday.mutateAsync({ date, name: name.trim(), created_by: user!.id })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agregar Feriado</DialogTitle>
          <DialogDescription>Registrá un feriado nacional o local.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label>Fecha *</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Nombre *</Label>
            <Input value={name} onChange={e => setName(e.target.value)}
              placeholder="ej: Día de la Revolución de Mayo" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="button" onClick={handleSave} disabled={createHoliday.isPending}>
              {createHoliday.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function FeriadosTab() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [modalOpen, setModalOpen] = useState(false)
  const { data: holidays = [], isLoading } = useHolidaysForYear(year)
  const deleteHoliday = useDeleteHoliday()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-base font-semibold text-plum-800 min-w-[60px] text-center">{year}</span>
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <Button size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="w-4 h-4 mr-1.5" />Agregar Feriado
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Fecha', 'Nombre del feriado', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {holidays.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-10 text-center text-muted-foreground text-sm">
                    Sin feriados registrados para {year}
                  </td>
                </tr>
              ) : holidays.map(h => (
                <tr key={h.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-3 capitalize tabular-nums">{fmtHolidayDate(h.date)}</td>
                  <td className="px-4 py-3 font-medium text-plum-800">{h.name}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => deleteHoliday.mutate(h.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AgregarFeriadoModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── Tab 6: Productividad ──────────────────────────────────────────────────────

type ProdRating = {
  label: string
  bgClass: string
  textClass: string
  hexColor: string
}

function prodRating(index: number | null, sessionCount: number): ProdRating {
  if (sessionCount === 0 || index === null)
    return { label: 'Sin sesiones', bgClass: 'bg-gray-100', textClass: 'text-gray-600', hexColor: '#6b7280' }
  if (index <= 1.5)
    return { label: 'Excelente', bgClass: 'bg-green-100', textClass: 'text-green-700', hexColor: '#16a34a' }
  if (index <= 2.25)
    return { label: 'Bien', bgClass: 'bg-yellow-100', textClass: 'text-yellow-700', hexColor: '#ca8a04' }
  if (index <= 3.6)
    return { label: 'Regular', bgClass: 'bg-orange-100', textClass: 'text-orange-700', hexColor: '#ea580c' }
  return { label: 'Bajo', bgClass: 'bg-red-100', textClass: 'text-red-700', hexColor: '#dc2626' }
}

function ProductividadTab() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`

  const { data: employees = [], isLoading: empLoading } = useEmployeeProfiles()
  const { data: appts = [], isLoading: apptLoading } = useNonCancelledApptsByTherapist(yearMonth)
  const { data: absences = [], isLoading: absLoading } = useAbsencesByMonth(yearMonth)

  const isLoading = empLoading || apptLoading || absLoading
  const activeEmployees = employees.filter((e) => e.active)

  const rows = activeEmployees.map((emp) => {
    const horasSchedule = calcMonthScheduleHours(emp.user?.schedule, year, month) || emp.expected_monthly_hours
    const horasDeductibles = Math.round(
      absences
        .filter((a) => a.user_id === emp.user_id && a.deduct_from_salary)
        .reduce((s, a) => s + a.hours_absent, 0) * 100,
    ) / 100
    const horasNetas = Math.max(0, Math.round((horasSchedule - horasDeductibles) * 100) / 100)
    const sessionCount = appts.filter((a) => a.therapist_id === emp.user_id).length
    const index = sessionCount > 0 ? Math.round((horasNetas / sessionCount) * 100) / 100 : null
    return { emp, horasNetas, sessionCount, index }
  })

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) } else setMonth((m) => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear((y) => y + 1) } else setMonth((m) => m + 1)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={prevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-base font-semibold text-plum-800 min-w-[130px] text-center capitalize">
            {MONTHS_ES[month - 1]} {year}
          </span>
          <Button variant="outline" size="icon" className="w-8 h-8" onClick={nextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground italic">Índice = horas netas ÷ sesiones. Menor es mejor.</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
        </div>
      ) : activeEmployees.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay empleados activos</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ emp, horasNetas, sessionCount, index }) => {
            const rating = prodRating(index, sessionCount)
            return (
              <Card key={emp.id}>
                <CardContent className="p-4 space-y-3">
                  {/* Employee header */}
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                      style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}
                    >
                      {initials(emp.user?.full_name)}
                    </div>
                    <div>
                      <p className="font-semibold text-plum-800 text-sm">{emp.user?.full_name}</p>
                      <p className="text-xs text-muted-foreground">{emp.position?.name}</p>
                    </div>
                  </div>

                  {/* Metrics grid */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground">Sesiones</p>
                      <p className="text-xl font-bold text-plum-800 mt-0.5">{sessionCount}</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground">Horas netas</p>
                      <p className="text-xl font-bold text-plum-800 mt-0.5">{horasNetas}h</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                      <p className="text-[10px] text-muted-foreground">Índice</p>
                      <p className="text-xl font-bold mt-0.5" style={{ color: rating.hexColor }}>
                        {index !== null ? index.toFixed(2) : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Rating badge */}
                  <div className="flex justify-center pt-0.5">
                    <span className={cn('px-3 py-1 rounded-full text-xs font-semibold', rating.bgClass, rating.textClass)}>
                      {rating.label}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tab 7: Aumentos de sueldo ─────────────────────────────────────────────────

function getEmpRate(emp: EmployeeProfile): { rate: number; isHourly: boolean } {
  const isHourly = emp.position?.contract_type === 'hourly'
  return {
    isHourly,
    rate: isHourly ? (emp.position?.hourly_rate ?? 0) : (emp.position?.monthly_salary ?? 0),
  }
}

function getEmpMonthlyEquivalent(emp: EmployeeProfile): number {
  if (emp.position?.contract_type === 'hourly') {
    return Math.round((emp.position.hourly_rate ?? 0) * (emp.position.expected_monthly_hours || 160))
  }
  return emp.position?.monthly_salary ?? 0
}

function AumentosTab() {
  const { user } = useAuth()
  const today = getArgentinaDateString()
  const { data: employees = [], isLoading: empLoading } = useEmployeeProfiles()
  const [histFilterUser, setHistFilterUser] = useState('')
  const { data: allIncreases = [], isLoading: incLoading } = useSalaryIncreases(histFilterUser || undefined)
  const createIncrease = useCreateSalaryIncrease()
  const updateJobPos = useUpdateJobPosition()

  const [inflacion, setInflacion] = useState('')
  const [tipo, setTipo] = useState<'percentage' | 'fixed'>('percentage')
  const [pct, setPct] = useState('')
  const [fixedAmt, setFixedAmt] = useState('')
  const [scope, setScope] = useState<'all' | 'specific'>('all')
  const [selectedUserId, setSelectedUserId] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  const activeEmployees = employees.filter(e => e.active)
  const targetEmployees = scope === 'all'
    ? activeEmployees
    : activeEmployees.filter(e => e.user_id === selectedUserId)

  const preview = useMemo(() => {
    const pctVal = parseFloat(pct) || 0
    const fixedVal = parseFloat(fixedAmt) || 0
    return targetEmployees.map(emp => {
      const { rate, isHourly } = getEmpRate(emp)
      const increase = tipo === 'percentage' ? Math.round(rate * pctVal / 100) : fixedVal
      return { emp, rate, isHourly, increase, newRate: rate + increase }
    })
  }, [targetEmployees, tipo, pct, fixedAmt])

  async function handleApply() {
    if (preview.length === 0) { setApplyError('No hay empleados seleccionados'); return }
    if (tipo === 'percentage' && !pct) { setApplyError('Ingresá el porcentaje'); return }
    if (tipo === 'fixed' && !fixedAmt) { setApplyError('Ingresá el monto'); return }
    setApplyError('')
    setApplying(true)
    try {
      for (const { emp, rate, increase, newRate, isHourly } of preview) {
        if (increase <= 0) continue
        await createIncrease.mutateAsync({
          user_id: emp.user_id,
          type: tipo,
          percentage: tipo === 'percentage' ? parseFloat(pct) : null,
          fixed_amount: tipo === 'fixed' ? parseFloat(fixedAmt) : null,
          inflation_reference: inflacion ? parseFloat(inflacion) : null,
          previous_salary: rate,
          new_salary: newRate,
          effective_date: effectiveDate,
          notes: notes || null,
          applied_by: user!.id,
        })
        await updateJobPos.mutateAsync({
          id: emp.job_position_id,
          ...(isHourly ? { hourly_rate: newRate } : { monthly_salary: newRate }),
        })
      }
      setInflacion(''); setPct(''); setFixedAmt(''); setNotes('')
      setScope('all'); setSelectedUserId('')
    } catch (e: unknown) {
      setApplyError(e instanceof Error ? e.message : 'Error al aplicar')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-5 space-y-4">
          <p className="font-semibold text-plum-800">Aplicar aumento</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Inflación de referencia (%)</Label>
              <Input type="number" min="0" step="0.01" placeholder="ej: 8.5"
                value={inflacion}
                onChange={e => { setInflacion(e.target.value); if (tipo === 'percentage') setPct(e.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label>Fecha efectiva</Label>
              <Input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tipo de aumento</Label>
            <div className="flex gap-2">
              {(['percentage', 'fixed'] as const).map(t => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={cn(
                    'flex-1 py-2 px-3 text-sm border rounded-lg transition-colors',
                    tipo === t ? 'border-plum-800 bg-plum-50 text-plum-800 font-medium' : 'hover:bg-gray-50',
                  )}>
                  {t === 'percentage' ? 'Por porcentaje' : 'Monto fijo'}
                </button>
              ))}
            </div>
          </div>

          {tipo === 'percentage' ? (
            <div className="space-y-1.5">
              <Label>Porcentaje de aumento (%)</Label>
              <Input type="number" min="0" step="0.01" placeholder="ej: 8.5"
                value={pct} onChange={e => setPct(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>Monto fijo ($)</Label>
              <Input type="number" min="0" step="1" placeholder="ej: 50000"
                value={fixedAmt} onChange={e => setFixedAmt(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Aplicar a</Label>
            <div className="flex gap-2">
              {(['all', 'specific'] as const).map(s => (
                <button key={s} type="button" onClick={() => setScope(s)}
                  className={cn(
                    'flex-1 py-2 px-3 text-sm border rounded-lg transition-colors',
                    scope === s ? 'border-plum-800 bg-plum-50 text-plum-800 font-medium' : 'hover:bg-gray-50',
                  )}>
                  {s === 'all' ? 'Todos los empleados' : 'Empleado específico'}
                </button>
              ))}
            </div>
          </div>

          {scope === 'specific' && (
            <div className="space-y-1.5">
              <Label>Empleado</Label>
              <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className={SELECT_CLS}>
                <option value="">Seleccionar...</option>
                {activeEmployees.map(e => (
                  <option key={e.user_id} value={e.user_id}>{e.user?.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notas (opcional)</Label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Observaciones..."
              className="flex min-h-[72px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
          </div>

          {preview.length > 0 && (
            <div className="rounded-lg border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['Nombre', 'Tipo', 'Valor actual', 'Aumento', 'Nuevo valor'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map(({ emp, rate, isHourly, increase, newRate }) => (
                    <tr key={emp.id} className="border-b last:border-b-0">
                      <td className="px-3 py-2 font-medium text-plum-800">{emp.user?.full_name}</td>
                      <td className="px-3 py-2">
                        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', isHourly ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700')}>
                          {isHourly ? 'Por hora' : 'Mensual'}
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {fmtARS(rate)}{isHourly ? '/h' : ''}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-green-700">
                        +{fmtARS(increase)}{isHourly ? '/h' : ''}
                      </td>
                      <td className="px-3 py-2 tabular-nums font-semibold">
                        {fmtARS(newRate)}{isHourly ? '/h' : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {applyError && <p className="text-sm text-red-600">{applyError}</p>}
          <div className="flex justify-end">
            <Button onClick={handleApply} disabled={applying || empLoading || preview.length === 0}>
              {applying && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Aplicar aumento
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-semibold text-plum-800">Historial de aumentos</p>
            <div className="flex items-center gap-2">
              <select value={histFilterUser} onChange={e => setHistFilterUser(e.target.value)}
                className={cn(SELECT_CLS, 'w-auto')}>
                <option value="">Todos los empleados</option>
                {activeEmployees.map(e => (
                  <option key={e.user_id} value={e.user_id}>{e.user?.full_name}</option>
                ))}
              </select>
              <Button variant="outline" size="sm" disabled={allIncreases.length === 0}
                onClick={() => exportToExcel(
                  allIncreases.map((i: SalaryIncrease) => {
                    const emp = employees.find(e => e.user_id === i.user_id)
                    const diff = i.new_salary - i.previous_salary
                    return {
                      'Fecha': i.effective_date,
                      'Empleado': emp?.user?.full_name ?? i.user_id.slice(0, 8),
                      'Tipo': i.type === 'percentage' ? 'Porcentaje' : 'Monto fijo',
                      'Ref. inflación (%)': i.inflation_reference ?? '',
                      'Diferencia': diff,
                      'Valor anterior': i.previous_salary,
                      'Nuevo valor': i.new_salary,
                      'Notas': i.notes ?? '',
                    }
                  }),
                  'historial-aumentos.xlsx',
                  'Aumentos',
                )}>
                <Download className="w-4 h-4 mr-1.5" />Excel
              </Button>
            </div>
          </div>

          {incLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-plum-800" /></div>
          ) : allIncreases.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">Sin aumentos registrados</p>
          ) : (
            <div className="rounded-lg border overflow-hidden overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    {['Fecha', 'Empleado', 'Tipo', 'Ref. inflación', 'Diferencia', 'Valor ant.', 'Nuevo valor', 'Notas'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allIncreases.map((inc: SalaryIncrease) => {
                    const emp = employees.find(e => e.user_id === inc.user_id)
                    const diff = inc.new_salary - inc.previous_salary
                    const diffLabel = inc.type === 'percentage' && inc.percentage != null
                      ? `${inc.percentage}% (${diff >= 0 ? '+' : ''}${fmtARS(diff)})`
                      : `${diff >= 0 ? '+' : ''}${fmtARS(diff)}`
                    return (
                      <tr key={inc.id} className="border-b last:border-b-0 hover:bg-gray-50">
                        <td className="px-3 py-2 tabular-nums whitespace-nowrap">{inc.effective_date}</td>
                        <td className="px-3 py-2 font-medium text-plum-800">{emp?.user?.full_name ?? '—'}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={inc.type === 'percentage' ? 'border-blue-300 text-blue-700' : 'border-amber-300 text-amber-700'}>
                            {inc.type === 'percentage' ? 'Porcentaje' : 'Monto fijo'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 tabular-nums">{inc.inflation_reference != null ? `${inc.inflation_reference}%` : '—'}</td>
                        <td className="px-3 py-2 tabular-nums text-green-700 font-medium">{diffLabel}</td>
                        <td className="px-3 py-2 tabular-nums">{fmtARS(inc.previous_salary)}</td>
                        <td className="px-3 py-2 tabular-nums font-medium text-plum-800">{fmtARS(inc.new_salary)}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{inc.notes ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Tab 8: Aguinaldo ──────────────────────────────────────────────────────────

type BonusPayFormState = {
  monto: string
  paymentMethod: string
  paidDate: string
}

function AguinaldoTab() {
  const { user } = useAuth()
  const today = getArgentinaDateString()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  const { data: employees = [], isLoading: empLoading } = useEmployeeProfiles()
  const { data: allIncreases = [], isLoading: incLoading } = useSalaryIncreases()
  const { data: bonusData = [], isLoading: bonusLoading } = useBonusPayments(year)
  const registerBonus = useRegisterBonusPayment()

  const [payModal, setPayModal] = useState<{
    open: boolean; userId: string; employeeName: string
    period: 'june' | 'december'; bestSalary: number; amount: number
  }>({ open: false, userId: '', employeeName: '', period: 'june', bestSalary: 0, amount: 0 })
  const [payForm, setPayForm] = useState<BonusPayFormState>({ monto: '', paymentMethod: 'transfer', paidDate: today })
  const [payError, setPayError] = useState('')

  const activeEmployees = employees.filter(e => e.active)

  function getBestSalary(emp: EmployeeProfile, period: 'june' | 'december'): number {
    const [startMo, endMo] = period === 'june' ? ['01', '06'] : ['07', '12']
    const start = `${year}-${startMo}-01`
    const end = `${year}-${endMo}-30`
    const relevant = allIncreases.filter((i: SalaryIncrease) =>
      i.user_id === emp.user_id && i.effective_date >= start && i.effective_date <= end,
    )
    if (relevant.length === 0) return getEmpMonthlyEquivalent(emp)
    return Math.max(...relevant.map((i: SalaryIncrease) => i.new_salary))
  }

  function openPayModal(emp: EmployeeProfile, period: 'june' | 'december') {
    const bestSalary = getBestSalary(emp, period)
    const amount = Math.round(bestSalary / 2)
    setPayModal({ open: true, userId: emp.user_id, employeeName: emp.user?.full_name ?? '', period, bestSalary, amount })
    setPayForm({ monto: amount.toString(), paymentMethod: 'transfer', paidDate: today })
    setPayError('')
  }

  async function handleRegisterBonus() {
    const amount = parseFloat(payForm.monto)
    if (!amount || amount <= 0) { setPayError('El monto es obligatorio'); return }
    setPayError('')
    try {
      await registerBonus.mutateAsync({
        user_id: payModal.userId,
        period: payModal.period,
        year,
        best_salary: payModal.bestSalary,
        amount,
        paid_date: payForm.paidDate,
        payment_method: payForm.paymentMethod,
        applied_by: user!.id,
        logged_by_user_id: user!.id,
      })
      setPayModal(p => ({ ...p, open: false }))
    } catch (e: unknown) {
      setPayError(e instanceof Error ? e.message : 'Error al registrar')
    }
  }

  const isLoading = empLoading || incLoading || bonusLoading

  const PERIODS = [
    { key: 'june' as const, label: 'Primer semestre (Junio)', months: 'Enero – Junio' },
    { key: 'december' as const, label: 'Segundo semestre (Diciembre)', months: 'Julio – Diciembre' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-base font-semibold text-plum-800 min-w-[60px] text-center">{year}</span>
        <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
      ) : (
        PERIODS.map(({ key, label, months }) => {
          const existingMap = new Map(bonusData.filter(b => b.period === key).map(b => [b.user_id, b]))
          return (
            <Card key={key}>
              <CardContent className="p-5 space-y-3">
                <div>
                  <p className="font-semibold text-plum-800">{label}</p>
                  <p className="text-xs text-muted-foreground">{months} {year}</p>
                </div>
                <div className="rounded-lg border overflow-hidden overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        {['Empleado', 'Mejor sueldo semestre', 'Aguinaldo (÷2)', 'Estado', 'Fecha de pago', 'Acciones'].map(h => (
                          <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeEmployees.length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Sin empleados activos</td></tr>
                      ) : activeEmployees.map(emp => {
                        const bestSalary = getBestSalary(emp, key)
                        const amount = Math.round(bestSalary / 2)
                        const existing = existingMap.get(emp.user_id)
                        const isPaid = !!existing?.paid_date
                        return (
                          <tr key={emp.id} className="border-b last:border-b-0 hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                                  style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}>
                                  {initials(emp.user?.full_name)}
                                </div>
                                <span className="font-medium text-plum-800">{emp.user?.full_name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{fmtARS(existing?.best_salary ?? bestSalary)}</td>
                            <td className="px-3 py-2 tabular-nums font-semibold">{fmtARS(existing?.amount ?? amount)}</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                'text-xs px-2 py-0.5 rounded-full font-medium',
                                isPaid ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600',
                              )}>
                                {isPaid ? 'Pagado' : 'Pendiente'}
                              </span>
                            </td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{existing?.paid_date ?? '—'}</td>
                            <td className="px-3 py-2">
                              {!isPaid && (
                                <Button size="sm" variant="outline" className="h-7 text-xs"
                                  onClick={() => openPayModal(emp, key)}>
                                  Registrar pago
                                </Button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}

      <Dialog open={payModal.open} onOpenChange={v => { if (!v) setPayModal(p => ({ ...p, open: false })) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Registrar Pago de Aguinaldo</DialogTitle>
            <DialogDescription>
              {payModal.employeeName} · {payModal.period === 'june' ? '1er semestre' : '2do semestre'} {year}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Monto ($)</Label>
              <Input type="number" min="0" value={payForm.monto}
                onChange={e => setPayForm(p => ({ ...p, monto: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Medio de pago</Label>
              <select value={payForm.paymentMethod}
                onChange={e => setPayForm(p => ({ ...p, paymentMethod: e.target.value }))}
                className={SELECT_CLS}>
                {RRHH_PAYMENT_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Fecha de pago</Label>
              <Input type="date" value={payForm.paidDate}
                onChange={e => setPayForm(p => ({ ...p, paidDate: e.target.value }))} />
            </div>
            {payError && <p className="text-sm text-red-600">{payError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setPayModal(p => ({ ...p, open: false }))}>Cancelar</Button>
              <Button onClick={handleRegisterBonus} disabled={registerBonus.isPending}>
                {registerBonus.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirmar pago
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Tab 9: Vacaciones ─────────────────────────────────────────────────────────

function calcEntitledDays(hireDate: string | null | undefined): { days: number; seniority: number; hasHireDate: boolean } {
  if (!hireDate) return { days: 14, seniority: 0, hasHireDate: false }
  const hire = new Date(hireDate + 'T00:00:00')
  const now2 = new Date()
  const seniority = Math.floor((now2.getTime() - hire.getTime()) / (1000 * 60 * 60 * 24 * 365.25))
  let days = 14
  if (seniority >= 20) days = 35
  else if (seniority >= 10) days = 28
  else if (seniority >= 5) days = 21
  return { days, seniority, hasHireDate: true }
}

function calcDaysBetween(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start + 'T00:00:00')
  const e = new Date(end + 'T00:00:00')
  return Math.max(0, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1)
}

type VacPayFormState = {
  startDate: string; endDate: string; daysTaken: string
  dailySalary: string; amount: string; paymentMethod: string; paidDate: string
}

function VacacionesTab() {
  const { user } = useAuth()
  const today = getArgentinaDateString()
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  const { data: employees = [], isLoading: empLoading } = useEmployeeProfiles()
  const { data: vacData = [], isLoading: vacLoading } = useVacationRecords(year)
  const registerVacation = useRegisterVacationPayment()

  const [vacModal, setVacModal] = useState<{
    open: boolean; emp: EmployeeProfile | null; entitledDays: number; existingDaysTaken: number
  }>({ open: false, emp: null, entitledDays: 14, existingDaysTaken: 0 })
  const [vacForm, setVacForm] = useState<VacPayFormState>({
    startDate: '', endDate: '', daysTaken: '', dailySalary: '', amount: '', paymentMethod: 'transfer', paidDate: today,
  })
  const [vacError, setVacError] = useState('')

  function openVacModal(emp: EmployeeProfile) {
    const { days } = calcEntitledDays(emp.user?.hire_date)
    const existing = vacData.find(v => v.user_id === emp.user_id)
    const monthlyEquiv = getEmpMonthlyEquivalent(emp)
    const dailySalary = Math.round(monthlyEquiv / 25)
    setVacModal({ open: true, emp, entitledDays: days, existingDaysTaken: existing?.days_taken ?? 0 })
    setVacForm({ startDate: '', endDate: '', daysTaken: '', dailySalary: dailySalary.toString(), amount: '', paymentMethod: 'transfer', paidDate: today })
    setVacError('')
  }

  function updateVacDates(field: 'startDate' | 'endDate', value: string) {
    setVacForm(p => {
      const newStart = field === 'startDate' ? value : p.startDate
      const newEnd = field === 'endDate' ? value : p.endDate
      const days = calcDaysBetween(newStart, newEnd)
      const dailySal = parseFloat(p.dailySalary) || 0
      return { ...p, [field]: value, daysTaken: days > 0 ? days.toString() : '', amount: days > 0 ? (days * dailySal).toString() : p.amount }
    })
  }

  function updateDailySalary(value: string) {
    setVacForm(p => {
      const days = parseFloat(p.daysTaken) || 0
      return { ...p, dailySalary: value, amount: days > 0 ? (days * (parseFloat(value) || 0)).toString() : p.amount }
    })
  }

  async function handleRegisterVacation() {
    if (!vacModal.emp) return
    const days = parseFloat(vacForm.daysTaken)
    const amount = parseFloat(vacForm.amount)
    if (!vacForm.startDate || !vacForm.endDate) { setVacError('Las fechas son obligatorias'); return }
    if (!days || days <= 0) { setVacError('Ingresá los días tomados'); return }
    if (!amount || amount <= 0) { setVacError('El monto es obligatorio'); return }
    const existing = vacData.find(v => v.user_id === vacModal.emp!.user_id)
    const newTotal = (existing?.days_taken ?? 0) + days
    setVacError('')
    try {
      await registerVacation.mutateAsync({
        user_id: vacModal.emp.user_id,
        year,
        entitled_days: vacModal.entitledDays,
        days_taken: newTotal,
        start_date: vacForm.startDate,
        end_date: vacForm.endDate,
        daily_salary: parseFloat(vacForm.dailySalary) || 0,
        amount,
        paid_date: vacForm.paidDate,
        payment_method: vacForm.paymentMethod,
        applied_by: user!.id,
        logged_by_user_id: user!.id,
        employee_name: vacModal.emp.user?.full_name ?? '',
      })
      setVacModal(p => ({ ...p, open: false }))
    } catch (e: unknown) {
      setVacError(e instanceof Error ? e.message : 'Error al registrar')
    }
  }

  const isLoading = empLoading || vacLoading
  const activeEmployees = employees.filter(e => e.active)

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y - 1)}><ChevronLeft className="w-4 h-4" /></Button>
        <span className="text-base font-semibold text-plum-800 min-w-[60px] text-center">{year}</span>
        <Button variant="outline" size="icon" className="w-8 h-8" onClick={() => setYear(y => y + 1)}><ChevronRight className="w-4 h-4" /></Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
      ) : activeEmployees.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <UserCheck className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No hay empleados activos</p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-gray-50 border-b">
              <tr>
                {['Empleado', 'Antigüedad', 'Días legales', 'Días tomados', 'Días restantes', 'Estado', 'Acciones'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeEmployees.map(emp => {
                const { days: entitledDays, seniority, hasHireDate } = calcEntitledDays(emp.user?.hire_date)
                const existing = vacData.find(v => v.user_id === emp.user_id)
                const daysTaken = existing?.days_taken ?? 0
                const daysRemaining = entitledDays - daysTaken
                const isComplete = daysTaken >= entitledDays
                return (
                  <tr key={emp.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}>
                          {initials(emp.user?.full_name)}
                        </div>
                        <span className="font-medium text-plum-800">{emp.user?.full_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {hasHireDate
                        ? `${seniority} año${seniority !== 1 ? 's' : ''}`
                        : <span className="text-muted-foreground text-xs">Sin fecha de ingreso</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{entitledDays}d</span>
                      {!hasHireDate && <span className="text-[10px] text-amber-600 ml-1">(sin antigüedad)</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{daysTaken}d</td>
                    <td className="px-4 py-3 tabular-nums">
                      <span className={cn('font-medium', daysRemaining <= 0 ? 'text-green-600' : daysRemaining <= 7 ? 'text-amber-600' : '')}>
                        {Math.max(0, daysRemaining)}d
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        isComplete ? 'bg-green-100 text-green-700' : daysTaken > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600',
                      )}>
                        {isComplete ? 'Completo' : daysTaken > 0 ? 'Parcial' : 'Pendiente'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {!isComplete && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openVacModal(emp)}>
                          Registrar vacaciones
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={vacModal.open} onOpenChange={v => { if (!v) setVacModal(p => ({ ...p, open: false })) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar Vacaciones</DialogTitle>
            <DialogDescription>
              {vacModal.emp?.user?.full_name} · {year} · {vacModal.entitledDays} días legales
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Fecha de inicio *</Label>
                <Input type="date" value={vacForm.startDate} onChange={e => updateVacDates('startDate', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de fin *</Label>
                <Input type="date" value={vacForm.endDate} onChange={e => updateVacDates('endDate', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Días tomados</Label>
                <Input type="number" min="1" value={vacForm.daysTaken}
                  onChange={e => {
                    const d = parseFloat(e.target.value) || 0
                    const s = parseFloat(vacForm.dailySalary) || 0
                    setVacForm(p => ({ ...p, daysTaken: e.target.value, amount: d > 0 ? (d * s).toString() : p.amount }))
                  }} />
              </div>
              <div className="space-y-1.5">
                <Label>Sueldo diario ($)</Label>
                <Input type="number" min="0" value={vacForm.dailySalary} onChange={e => updateDailySalary(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Monto a pagar ($)</Label>
              <Input type="number" min="0" value={vacForm.amount}
                onChange={e => setVacForm(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Medio de pago</Label>
                <select value={vacForm.paymentMethod}
                  onChange={e => setVacForm(p => ({ ...p, paymentMethod: e.target.value }))}
                  className={SELECT_CLS}>
                  {RRHH_PAYMENT_METHODS.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Fecha de pago</Label>
                <Input type="date" value={vacForm.paidDate}
                  onChange={e => setVacForm(p => ({ ...p, paidDate: e.target.value }))} />
              </div>
            </div>
            {vacError && <p className="text-sm text-red-600">{vacError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setVacModal(p => ({ ...p, open: false }))}>Cancelar</Button>
              <Button onClick={handleRegisterVacation} disabled={registerVacation.isPending}>
                {registerVacation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

type RRHHTab = 'puestos' | 'empleados' | 'liquidacion' | 'ausencias' | 'feriados' | 'productividad' | 'aumentos' | 'aguinaldo' | 'vacaciones'

type RRHHTabDef = { key: RRHHTab; label: string; ownerOnly?: boolean }

const ALL_TABS: RRHHTabDef[] = [
  { key: 'puestos', label: 'Puestos' },
  { key: 'empleados', label: 'Empleados' },
  { key: 'liquidacion', label: 'Liquidación Mensual' },
  { key: 'ausencias', label: 'Ausencias' },
  { key: 'feriados', label: 'Feriados' },
  { key: 'productividad', label: 'Productividad' },
  { key: 'aumentos', label: 'Aumentos', ownerOnly: true },
  { key: 'aguinaldo', label: 'Aguinaldo', ownerOnly: true },
  { key: 'vacaciones', label: 'Vacaciones', ownerOnly: true },
]

export default function RRHH() {
  const { profile } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [tab, setTab] = useState<RRHHTab>('puestos')
  const tabs = ALL_TABS.filter(t => !t.ownerOnly || isOwner)

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Recursos Humanos</h1>
        <p className="text-muted-foreground text-sm mt-1">Puestos, empleados, liquidaciones y ausencias.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-0 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
              tab === t.key
                ? 'border-plum-800 text-plum-800'
                : 'border-transparent text-muted-foreground hover:text-plum-700',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'puestos' && <PuestosTab />}
      {tab === 'empleados' && <EmpleadosTab />}
      {tab === 'liquidacion' && <LiquidacionTab />}
      {tab === 'ausencias' && <AusenciasTab />}
      {tab === 'feriados' && <FeriadosTab />}
      {tab === 'productividad' && <ProductividadTab />}
      {tab === 'aumentos' && isOwner && <AumentosTab />}
      {tab === 'aguinaldo' && isOwner && <AguinaldoTab />}
      {tab === 'vacaciones' && isOwner && <VacacionesTab />}
    </div>
  )
}

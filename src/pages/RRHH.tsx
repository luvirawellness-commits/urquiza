import { useState, useEffect, useMemo } from 'react'
import {
  Plus, Pencil, Loader2, Download, Check, ChevronLeft, ChevronRight, UserCheck,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  useJobPositions, useEmployeeProfiles, useAllTenantUsers,
  useAbsences, useCCSSByMonth, useCompletedApptsByTherapist, useAbsencesByMonth,
  useCreateJobPosition, useUpdateJobPosition,
  useCreateEmployee, useUpdateEmployee,
  useCreateAbsence, useUpsertCCSS, useUpdateCCSSStatus,
  calcMonthScheduleHours,
  type JobPosition, type EmployeeProfile, type EmployeeCCSS,
} from '@/hooks/useRRHH'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn, MONTHS_ES } from '@/lib/utils'

// ── Constants ─────────────────────────────────────────────────────────────────

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

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
}

function EmpleadoModal({
  open, onClose, editing,
}: { open: boolean; onClose: () => void; editing?: EmployeeProfile | null }) {
  const { data: users = [] } = useAllTenantUsers()
  const { data: positions = [] } = useJobPositions()
  const { data: employees = [] } = useEmployeeProfiles()
  const createEmp = useCreateEmployee()
  const updateEmp = useUpdateEmployee()

  const [form, setForm] = useState<EmpleadoForm>({
    user_id: '', job_position_id: '', start_date: new Date().toISOString().split('T')[0],
    expected_monthly_hours: '160',
    productivity_threshold_1: '', productivity_bonus_1: '',
    productivity_threshold_2: '', productivity_bonus_2: '',
    notes: '', active: true,
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
      })
    } else {
      setForm({
        user_id: '', job_position_id: '', start_date: new Date().toISOString().split('T')[0],
        expected_monthly_hours: '160',
        productivity_threshold_1: '', productivity_bonus_1: '',
        productivity_threshold_2: '', productivity_bonus_2: '',
        notes: '', active: true,
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
      <div className="flex justify-end">
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
  subtotal: number
  ccssEntry?: EmployeeCCSS
}

function computeCard(
  emp: EmployeeProfile,
  year: number, month: number,
  appts: { therapist_id: string; duration_minutes: number }[],
  absences: { user_id: string; hours_absent: number; deduct_from_salary: boolean }[],
  ccssData: EmployeeCCSS[],
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

  const subtotal = baseSueldo + bonusTotal
  const ccssEntry = ccssData.find(c => c.user_id === emp.user_id)
  return { emp, horasEsperadas, horasSchedule, horasAusentes, horasNetas, sessionCount, sessionHours, bonus1Earned, bonus2Earned, bonusTotal, baseSueldo, subtotal, ccssEntry }
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

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
            style={{ backgroundColor: emp.user?.color_hex ?? '#7c3aed' }}>
            {initials(emp.user?.full_name)}
          </div>
          <div>
            <p className="font-semibold text-plum-800">{emp.user?.full_name}</p>
            <p className="text-xs text-muted-foreground">{emp.position?.name} · {isHourly ? 'Por hora' : 'Mensual'}</p>
          </div>
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">{card.horasNetas}h × {fmtARS(emp.position?.hourly_rate ?? 0)}/h</span>
                <span className="tabular-nums">{fmtARS(card.baseSueldo)}</span>
              </div>
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

function exportCSV(cards: CardData[], yearMonth: string) {
  const header = ['Empleado', 'Puesto', 'Tipo', 'H.Esperadas', 'H.Schedule', 'H.Ausentes', 'H.Netas', 'Sesiones', 'Bono', 'Base Sueldo', 'Subtotal', 'CCSS', 'Total']
  const rows = cards.map(c => [
    c.emp.user?.full_name ?? '',
    c.emp.position?.name ?? '',
    c.emp.position?.contract_type === 'hourly' ? 'Por hora' : 'Mensual',
    c.horasEsperadas,
    c.horasSchedule,
    c.horasAusentes,
    c.horasNetas,
    c.sessionCount,
    c.bonusTotal,
    c.baseSueldo,
    c.subtotal,
    c.ccssEntry?.amount ?? 0,
    c.subtotal + (c.ccssEntry?.amount ?? 0),
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `liquidacion-${yearMonth}.csv`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
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

  const isLoading = empLoading || apptLoading || absLoading || ccssLoading

  const activeEmployees = employees.filter(e => e.active)

  const cards = useMemo(() =>
    activeEmployees.map(emp => computeCard(emp, year, month, appts, absenceData, ccssData)),
    [activeEmployees, year, month, appts, absenceData, ccssData],
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
        <Button variant="outline" size="sm" onClick={() => exportCSV(cards, yearMonth)} disabled={cards.length === 0}>
          <Download className="w-4 h-4 mr-1.5" />Exportar resumen
        </Button>
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
    date: new Date().toISOString().split('T')[0],
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
        user_id: autoUserId, date: new Date().toISOString().split('T')[0],
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
                  <td className="px-4 py-3 text-muted-foreground max-w-[150px] truncate">{a.reason ?? '—'}</td>
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

// ── Main ──────────────────────────────────────────────────────────────────────

type RRHHTab = 'puestos' | 'empleados' | 'liquidacion' | 'ausencias'

const TABS: { key: RRHHTab; label: string }[] = [
  { key: 'puestos', label: 'Puestos' },
  { key: 'empleados', label: 'Empleados' },
  { key: 'liquidacion', label: 'Liquidación Mensual' },
  { key: 'ausencias', label: 'Ausencias' },
]

export default function RRHH() {
  const [tab, setTab] = useState<RRHHTab>('puestos')

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Recursos Humanos</h1>
        <p className="text-muted-foreground text-sm mt-1">Puestos, empleados, liquidaciones y ausencias.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b gap-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
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
    </div>
  )
}

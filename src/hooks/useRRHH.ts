import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { getArgentinaMonthEnd } from '../utils/dateUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

export type WeeklyScheduleInterval = { from: string; to: string }
export type WeeklySchedule = {
  monday?: WeeklyScheduleInterval[]
  tuesday?: WeeklyScheduleInterval[]
  wednesday?: WeeklyScheduleInterval[]
  thursday?: WeeklyScheduleInterval[]
  friday?: WeeklyScheduleInterval[]
  saturday?: WeeklyScheduleInterval[]
  sunday?: WeeklyScheduleInterval[]
}

export type JobPosition = {
  id: string; tenant_id: string; name: string
  contract_type: 'hourly' | 'monthly'
  hourly_rate?: number | null; monthly_salary?: number | null
  expected_monthly_hours: number; active: boolean
  created_at: string; updated_at: string
}

export type EmployeeUser = {
  id: string; full_name: string; color_hex?: string | null
  schedule?: Record<string, { start: string; end: string }[]> | null
  hire_date?: string | null
}

export type EmployeeProfile = {
  id: string; tenant_id: string; user_id: string; job_position_id: string
  start_date: string; expected_monthly_hours: number
  productivity_threshold_1?: number | null; productivity_bonus_1?: number | null
  productivity_threshold_2?: number | null; productivity_bonus_2?: number | null
  active: boolean; notes?: string | null; weekly_schedule?: WeeklySchedule | null
  created_at: string; updated_at: string
  user?: EmployeeUser | null
  position?: JobPosition | null
}

export type EmployeeAbsence = {
  id: string; tenant_id: string; user_id: string
  date: string; hours_absent: number; reason?: string | null
  type: 'absence' | 'vacation' | 'medical' | 'other'
  deduct_from_salary: boolean; registered_by?: string | null
  appointment_id?: string | null; created_at: string
  employee_user?: { full_name: string } | null
  registrar?: { full_name: string } | null
}

export type EmployeeCCSS = {
  id: string; tenant_id: string; user_id: string
  period_month: string; amount: number
  status: 'pending' | 'paid'; notes?: string | null; created_at: string
}

export type Holiday = {
  id: string; tenant_id: string; date: string; name: string
  created_by?: string | null; created_at: string
}

export type HolidayDetail = {
  date: string; name: string; hours: number; bonus: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_KEYS_SHORT = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

type OldSchedule = Record<string, { start: string; end: string }[]>

// Accepts either the legacy `users.schedule` shape (fixed weekly recurring hours) or, when
// `weeklySchedules` has at least one row for this employee, the new per-week
// `employee_weekly_schedules` data (already summed into `total_hours` per week).
export function calcMonthScheduleHours(
  schedule: OldSchedule | null | undefined,
  year: number,
  month: number,
  weeklySchedules?: EmployeeWeeklySchedule[],
): number {
  if (weeklySchedules && weeklySchedules.length > 0) {
    // A week's total_hours covers all 7 days, but a week can straddle two months
    // (e.g. week_start 2026-07-27 runs into August 1-2) — only count the days
    // that actually fall in the target month/year, not the week's full total.
    let total = 0
    for (const row of weeklySchedules) {
      const [wy, wm, wd] = row.week_start.split('-').map(Number)
      const weekStartDate = new Date(wy, wm - 1, wd) // week_start is always a Monday
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(weekStartDate)
        dayDate.setDate(dayDate.getDate() + i)
        if (dayDate.getFullYear() !== year || dayDate.getMonth() + 1 !== month) continue

        const dayKey = WEEKLY_SCHEDULE_DAY_KEYS[i] // index 0 = Monday, matching week_start
        const fromStr = row[`${dayKey}_from`]
        const toStr = row[`${dayKey}_to`]
        if (!fromStr || !toStr) continue

        const [fh, fm] = fromStr.split(':').map(Number)
        const [th, tm] = toStr.split(':').map(Number)
        total += (th * 60 + tm - fh * 60 - fm) / 60
      }
    }
    return Math.round(total * 100) / 100
  }
  if (!schedule) return 0
  const daysInMonth = new Date(year, month, 0).getDate()
  let total = 0
  for (let day = 1; day <= daysInMonth; day++) {
    const dayKey = DAY_KEYS_SHORT[new Date(year, month - 1, day).getDay()]
    const ranges = (schedule[dayKey] ?? []) as { start: string; end: string }[]
    for (const r of ranges) {
      const [sh, sm] = r.start.split(':').map(Number)
      const [eh, em] = r.end.split(':').map(Number)
      total += (eh * 60 + em - (sh * 60 + sm)) / 60
    }
  }
  return Math.round(total * 100) / 100
}

const HOLIDAY_DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

// Accepts either the legacy `users.schedule` shape or, when `weeklySchedules` has a row
// for the holiday's week, the new per-week `employee_weekly_schedules` data — same
// precedence as calcMonthScheduleHours, so the two stay consistent for a given employee.
export function calcHolidayBonus(
  schedule: Record<string, { start: string; end: string }[]> | null | undefined,
  hourlyRate: number,
  holidays: Holiday[],
  absences: { date: string; deduct_from_salary: boolean }[],
  weeklySchedules?: EmployeeWeeklySchedule[],
): HolidayDetail[] {
  if (!hourlyRate) return []
  const result: HolidayDetail[] = []
  for (const h of holidays) {
    const hasAbsence = absences.some(a => a.date === h.date)
    if (hasAbsence) continue

    const holidayDate = new Date(h.date + 'T12:00:00')
    const dayOfWeek = holidayDate.getDay() // 0 = Sunday .. 6 = Saturday

    let hours = 0
    let matched = false

    if (weeklySchedules && weeklySchedules.length > 0) {
      const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(holidayDate)
      monday.setDate(monday.getDate() + diff)
      const weekStart = monday.toISOString().split('T')[0]
      const row = weeklySchedules.find(s => s.week_start === weekStart)
      if (row) {
        matched = true
        const dayKey = HOLIDAY_DAY_KEYS[dayOfWeek]
        const fromStr = row[`${dayKey}_from`]
        const toStr = row[`${dayKey}_to`]
        if (fromStr && toStr) {
          const [fh, fm] = fromStr.split(':').map(Number)
          const [th, tm] = toStr.split(':').map(Number)
          hours = (th * 60 + tm - fh * 60 - fm) / 60
        }
      }
    }

    if (!matched) {
      if (!schedule) continue
      const dayKey = DAY_KEYS_SHORT[dayOfWeek]
      const ranges = (schedule[dayKey] ?? []) as { start: string; end: string }[]
      for (const r of ranges) {
        const [sh, sm] = r.start.split(':').map(Number)
        const [eh, em] = r.end.split(':').map(Number)
        hours += (eh * 60 + em - (sh * 60 + sm)) / 60
      }
    }

    if (hours > 0) {
      result.push({
        date: h.date, name: h.name,
        hours: Math.round(hours * 100) / 100,
        bonus: Math.round(hours * hourlyRate),
      })
    }
  }
  return result
}

// ── Read hooks ────────────────────────────────────────────────────────────────

export function useJobPositions() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['job-positions', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_positions').select('*').eq('tenant_id', tenantId).order('name')
      if (error) throw error
      return data as JobPosition[]
    },
    enabled: !!tenantId,
  })
}

export function useEmployeeProfiles() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-profiles', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_profiles')
        .select('*, user:users!employee_profiles_user_id_fkey(id,full_name,color_hex,schedule,hire_date), position:job_positions!employee_profiles_job_position_id_fkey(*)')
        .eq('tenant_id', tenantId)
        .order('created_at')
      if (error) throw error
      return data as EmployeeProfile[]
    },
    enabled: !!tenantId,
  })
}

export function useAllTenantUsers() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users').select('id,full_name,role,color_hex')
        .eq('tenant_id', tenantId).eq('active', true).order('full_name')
      if (error) throw error
      return data as { id: string; full_name: string; role: string; color_hex?: string | null }[]
    },
    enabled: !!tenantId,
  })
}

export function useAbsences(startDate?: string, endDate?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-absences', tenantId, startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('employee_absences')
        .select('*, employee_user:users!employee_absences_user_id_fkey(full_name), registrar:users!employee_absences_registered_by_fkey(full_name)')
        .eq('tenant_id', tenantId).order('date', { ascending: false })
      if (startDate) q = q.gte('date', startDate)
      if (endDate) q = q.lte('date', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as EmployeeAbsence[]
    },
    enabled: !!tenantId,
  })
}

export function useCCSSByMonth(yearMonth: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-ccss', tenantId, yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_ccss').select('*').eq('tenant_id', tenantId)
        .eq('period_month', `${yearMonth}-01`)
      if (error) throw error
      return data as EmployeeCCSS[]
    },
    enabled: !!yearMonth && !!tenantId,
  })
}

export function useCompletedApptsByTherapist(yearMonth: string) {
  const tenantId = useTenantId()
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = getArgentinaMonthEnd(y, m)
  return useQuery({
    queryKey: ['completed-appts-therapist-month', tenantId, yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments').select('therapist_id,duration_minutes,scheduled_at')
        .eq('tenant_id', tenantId).eq('status', 'completed')
        .gte('scheduled_at', `${yearMonth}-01T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (error) throw error
      return data as { therapist_id: string; duration_minutes: number; scheduled_at: string }[]
    },
    enabled: !!yearMonth && !!tenantId,
  })
}

export function useNonCancelledApptsByTherapist(yearMonth: string) {
  const tenantId = useTenantId()
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = getArgentinaMonthEnd(y, m)
  return useQuery({
    queryKey: ['non-cancelled-appts-therapist-month', tenantId, yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments').select('therapist_id,duration_minutes,scheduled_at')
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'confirmed', 'completed'])
        .gte('scheduled_at', `${yearMonth}-01T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (error) throw error
      return data as { therapist_id: string; duration_minutes: number; scheduled_at: string }[]
    },
    enabled: !!yearMonth && !!tenantId,
  })
}

export function useAbsencesByMonth(yearMonth: string) {
  const tenantId = useTenantId()
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = getArgentinaMonthEnd(y, m)
  return useQuery({
    queryKey: ['absences-month', tenantId, yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_absences').select('user_id,hours_absent,deduct_from_salary,date')
        .eq('tenant_id', tenantId)
        .gte('date', `${yearMonth}-01`).lte('date', endDate)
      if (error) throw error
      return data as { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[]
    },
    enabled: !!yearMonth && !!tenantId,
  })
}

export function useHolidaysForYear(year: number) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['holidays', tenantId, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays').select('*').eq('tenant_id', tenantId)
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
        .order('date')
      if (error) throw error
      return data as Holiday[]
    },
    enabled: !!tenantId,
  })
}

export function useHolidaysForMonth(yearMonth: string) {
  const tenantId = useTenantId()
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = getArgentinaMonthEnd(y, m)
  return useQuery({
    queryKey: ['holidays-month', tenantId, yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays').select('*').eq('tenant_id', tenantId)
        .gte('date', `${yearMonth}-01`).lte('date', endDate)
        .order('date')
      if (error) throw error
      return data as Holiday[]
    },
    enabled: !!yearMonth && !!tenantId,
  })
}

export function useCompletedApptsRange(startDate: string, endDate: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['completed-appts-range', tenantId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments').select('therapist_id,duration_minutes,scheduled_at')
        .eq('tenant_id', tenantId).eq('status', 'completed')
        .gte('scheduled_at', `${startDate}T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (error) throw error
      return data as { therapist_id: string; duration_minutes: number; scheduled_at: string }[]
    },
    enabled: !!tenantId,
  })
}

export function useAbsencesRange(startDate: string, endDate: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['absences-range', tenantId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_absences').select('user_id,hours_absent,deduct_from_salary,date')
        .eq('tenant_id', tenantId).gte('date', startDate).lte('date', endDate)
      if (error) throw error
      return data as { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[]
    },
    enabled: !!tenantId,
  })
}

export function usePaidCCSSForMonths(months: string[]) {
  const tenantId = useTenantId()
  const start = months[0] ? `${months[0]}-01` : '2000-01-01'
  const end = months[months.length - 1] ? `${months[months.length - 1]}-01` : '2099-12-01'
  return useQuery({
    queryKey: ['paid-ccss-months', tenantId, start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_ccss').select('user_id,period_month,amount')
        .eq('tenant_id', tenantId).eq('status', 'paid')
        .gte('period_month', start).lte('period_month', end)
      if (error) throw error
      return data as { user_id: string; period_month: string; amount: number }[]
    },
    enabled: months.length > 0 && !!tenantId,
  })
}

export function useRRHHCostByMonths(
  months: string[],
  employees: EmployeeProfile[] | undefined,
  appts: { therapist_id: string; duration_minutes: number; scheduled_at: string }[] | undefined,
  absences: { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[] | undefined,
  paidCCSS: { user_id: string; period_month: string; amount: number }[] | undefined,
): Record<string, { sueldos: number; ccss: number }> {
  const deps = [months, employees, appts, absences, paidCCSS]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => {
    if (!employees || !appts || !absences || !paidCCSS) return {}
    const result: Record<string, { sueldos: number; ccss: number }> = {}
    for (const yearMonth of months) {
      const [y, m] = yearMonth.split('-').map(Number)
      const startD = `${yearMonth}-01`
      const endD = getArgentinaMonthEnd(y, m)
      let sueldos = 0
      for (const emp of employees.filter(e => e.active)) {
        const schedHours = calcMonthScheduleHours(emp.user?.schedule, y, m) || emp.expected_monthly_hours
        const empAppts = appts.filter(a =>
          a.therapist_id === emp.user_id &&
          a.scheduled_at >= `${startD}T00:00:00` &&
          a.scheduled_at <= `${endD}T23:59:59`,
        )
        const sessionCount = empAppts.length
        const deductible = absences
          .filter(a => a.user_id === emp.user_id && a.date >= startD && a.date <= endD && a.deduct_from_salary)
          .reduce((s, a) => s + a.hours_absent, 0)
        const netHours = Math.max(0, schedHours - deductible)
        const b1 = emp.productivity_threshold_1 != null && sessionCount >= (emp.productivity_threshold_1 ?? Infinity) ? (emp.productivity_bonus_1 ?? 0) : 0
        const b2 = emp.productivity_threshold_2 != null && sessionCount >= (emp.productivity_threshold_2 ?? Infinity) ? (emp.productivity_bonus_2 ?? 0) : 0
        if (emp.position?.contract_type === 'hourly') {
          sueldos += netHours * (emp.position.hourly_rate ?? 0) + b1 + b2
        } else {
          const sal = emp.position?.monthly_salary ?? 0
          const hrs = emp.expected_monthly_hours || 160
          sueldos += sal - (sal / hrs) * deductible + b1 + b2
        }
      }
      const ccss = paidCCSS
        .filter(c => c.period_month.startsWith(yearMonth))
        .reduce((s, c) => s + c.amount, 0)
      result[yearMonth] = { sueldos, ccss }
    }
    return result
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

type CreatePositionInput = Omit<JobPosition, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>

export function useCreateJobPosition() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePositionInput) => {
      const { data, error } = await supabase
        .from('job_positions').insert({ ...input, tenant_id: tenantId }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-positions'] }),
  })
}

export function useUpdateJobPosition() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<CreatePositionInput> & { id: string }) => {
      const { error } = await supabase
        .from('job_positions').update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-positions'] }),
  })
}

type CreateEmployeeInput = {
  user_id: string; job_position_id: string; start_date: string
  expected_monthly_hours: number
  productivity_threshold_1?: number | null; productivity_bonus_1?: number | null
  productivity_threshold_2?: number | null; productivity_bonus_2?: number | null
  notes?: string | null
  weekly_schedule?: WeeklySchedule | null
}

export function useCreateEmployee() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEmployeeInput) => {
      const { data, error } = await supabase
        .from('employee_profiles').insert({ ...input, tenant_id: tenantId, active: true }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-profiles'] }),
  })
}

export function useUpdateEmployee() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<CreateEmployeeInput> & { id: string; active?: boolean }) => {
      const { error } = await supabase
        .from('employee_profiles').update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-profiles'] }),
  })
}

type CreateAbsenceInput = {
  user_id: string; date: string; hours_absent: number; reason?: string
  type: 'absence' | 'vacation' | 'medical' | 'other'
  deduct_from_salary: boolean; registered_by: string
  appointment_id?: string | null
}

export function useCreateAbsence() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAbsenceInput) => {
      const { data, error } = await supabase
        .from('employee_absences').insert({ ...input, tenant_id: tenantId }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-absences'] })
      qc.invalidateQueries({ queryKey: ['absences-month'] })
    },
  })
}

export function useUpsertCCSS() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ user_id, period_month, amount, notes }: { user_id: string; period_month: string; amount: number; notes?: string }) => {
      const { data, error } = await supabase
        .from('employee_ccss')
        .upsert({ user_id, period_month, amount, notes: notes ?? null, tenant_id: tenantId, status: 'pending' },
          { onConflict: 'tenant_id,user_id,period_month' })
        .select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-ccss'] }),
  })
}

export function useUpdateCCSSStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'pending' | 'paid' }) => {
      const { error } = await supabase.from('employee_ccss').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-ccss'] }),
  })
}

export function useCreateHoliday() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, name, created_by }: { date: string; name: string; created_by: string }) => {
      const { data, error } = await supabase
        .from('holidays').insert({ date, name, created_by, tenant_id: tenantId }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  })
}

export function useDeleteHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('holidays').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  })
}

export function useEmployeeSchedules() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-schedules', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_profiles')
        .select('user_id, weekly_schedule')
        .eq('tenant_id', tenantId)
        .eq('active', true)
      if (error) throw error
      const map = new Map<string, WeeklySchedule>()
      for (const row of (data ?? [])) {
        if (row.weekly_schedule) map.set(row.user_id, row.weekly_schedule as WeeklySchedule)
      }
      return map
    },
    enabled: !!tenantId,
  })
}

// ── Salary increases ──────────────────────────────────────────────────────────

export type SalaryIncrease = {
  id: string
  tenant_id: string
  user_id: string
  type: 'percentage' | 'fixed'
  percentage?: number | null
  fixed_amount?: number | null
  inflation_reference?: number | null
  previous_salary: number
  new_salary: number
  effective_date: string
  notes?: string | null
  applied_by?: string | null
  created_at: string
}

export function useSalaryIncreases(userId?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['salary-increases', tenantId, userId],
    queryFn: async () => {
      let q = supabase
        .from('salary_increases')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('effective_date', { ascending: false })
      if (userId) q = q.eq('user_id', userId)
      const { data, error } = await q
      if (error) throw error
      return data as SalaryIncrease[]
    },
    enabled: !!tenantId,
  })
}

type CreateSalaryIncreaseInput = {
  user_id: string
  type: 'percentage' | 'fixed'
  percentage?: number | null
  fixed_amount?: number | null
  inflation_reference?: number | null
  previous_salary: number
  new_salary: number
  effective_date: string
  notes?: string | null
  applied_by: string
}

export function useCreateSalaryIncrease() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateSalaryIncreaseInput) => {
      const { data, error } = await supabase
        .from('salary_increases')
        .insert({ ...input, tenant_id: tenantId })
        .select()
        .single()
      if (error) throw error
      return data as SalaryIncrease
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['salary-increases', tenantId] })
      qc.invalidateQueries({ queryKey: ['salary-increases', tenantId, vars.user_id] })
    },
  })
}

// ── Bonus payments (aguinaldo) ────────────────────────────────────────────────

export type BonusPayment = {
  id: string
  tenant_id: string
  user_id: string
  period: 'june' | 'december'
  year: number
  best_salary: number
  amount: number
  paid_date?: string | null
  payment_method?: string | null
  transaction_id?: string | null
  applied_by?: string | null
  created_at: string
}

export function useBonusPayments(year?: number) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['bonus-payments', tenantId, year],
    queryFn: async () => {
      let q = supabase
        .from('bonus_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('year', { ascending: false })
      if (year) q = q.eq('year', year)
      const { data, error } = await q
      if (error) throw error
      return data as BonusPayment[]
    },
    enabled: !!tenantId,
  })
}

type UpsertBonusPaymentInput = {
  user_id: string
  period: 'june' | 'december'
  year: number
  best_salary: number
  amount: number
  paid_date?: string | null
  payment_method?: string | null
  transaction_id?: string | null
  applied_by: string
}

export function useUpsertBonusPayment() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertBonusPaymentInput) => {
      const { data, error } = await supabase
        .from('bonus_payments')
        .upsert(
          { ...input, tenant_id: tenantId },
          { onConflict: 'tenant_id,user_id,period,year' },
        )
        .select()
        .single()
      if (error) throw error
      return data as BonusPayment
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['bonus-payments', tenantId] })
      qc.invalidateQueries({ queryKey: ['bonus-payments', tenantId, vars.year] })
    },
  })
}

// ── Vacation records ──────────────────────────────────────────────────────────

export type VacationRecord = {
  id: string
  tenant_id: string
  user_id: string
  year: number
  entitled_days: number
  days_taken: number
  days_remaining: number
  start_date?: string | null
  end_date?: string | null
  daily_salary?: number | null
  amount?: number | null
  paid_date?: string | null
  payment_method?: string | null
  transaction_id?: string | null
  applied_by?: string | null
  created_at: string
}

export function useVacationRecords(year?: number, userId?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['vacation-records', tenantId, year, userId],
    queryFn: async () => {
      let q = supabase
        .from('vacation_records')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('year', { ascending: false })
      if (year) q = q.eq('year', year)
      if (userId) q = q.eq('user_id', userId)
      const { data, error } = await q
      if (error) throw error
      return data as VacationRecord[]
    },
    enabled: !!tenantId,
  })
}

type UpsertVacationRecordInput = {
  user_id: string
  year: number
  entitled_days: number
  days_taken: number
  start_date?: string | null
  end_date?: string | null
  daily_salary?: number | null
  amount?: number | null
  paid_date?: string | null
  payment_method?: string | null
  transaction_id?: string | null
  applied_by: string
}

export function useUpsertVacationRecord() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertVacationRecordInput) => {
      const { data, error } = await supabase
        .from('vacation_records')
        .upsert(
          { ...input, tenant_id: tenantId },
          { onConflict: 'tenant_id,user_id,year' },
        )
        .select()
        .single()
      if (error) throw error
      return data as VacationRecord
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vacation-records', tenantId] })
      qc.invalidateQueries({ queryKey: ['vacation-records', tenantId, vars.year] })
      qc.invalidateQueries({ queryKey: ['vacation-records', tenantId, vars.year, vars.user_id] })
    },
  })
}

// ── Extended user data (salary + hire_date) ───────────────────────────────────

export type EmployeeUserExtended = {
  id: string
  full_name: string
  color_hex?: string | null
  salary?: number | null
  hire_date?: string | null
}

export function useEmployeeUsersWithSalary() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-users-extended', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, color_hex, salary, hire_date')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('full_name')
      if (error) throw error
      return data as EmployeeUserExtended[]
    },
    enabled: !!tenantId,
  })
}

export function useUpdateUserSalary() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, salary }: { userId: string; salary: number }) => {
      const { error } = await supabase
        .from('users')
        .update({ salary })
        .eq('id', userId)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-users-extended', tenantId] })
    },
  })
}

// ── Register bonus payment (aguinaldo) ────────────────────────────────────────

type RegisterBonusInput = {
  user_id: string
  period: 'june' | 'december'
  year: number
  best_salary: number
  amount: number
  paid_date: string
  payment_method: string
  applied_by: string
  logged_by_user_id: string
}

export function useRegisterBonusPayment() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RegisterBonusInput) => {
      const { data: bonus, error: bonusErr } = await supabase
        .from('bonus_payments')
        .upsert(
          {
            tenant_id: tenantId,
            user_id: input.user_id,
            period: input.period,
            year: input.year,
            best_salary: input.best_salary,
            amount: input.amount,
            paid_date: input.paid_date,
            payment_method: input.payment_method,
            applied_by: input.applied_by,
          },
          { onConflict: 'tenant_id,user_id,period,year' },
        )
        .select()
        .single()
      if (bonusErr) throw bonusErr

      const periodLabel = input.period === 'june' ? '1er semestre' : '2do semestre'
      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          tenant_id: tenantId,
          type: 'expense',
          category: 'aguinaldo',
          amount: input.amount,
          description: `Aguinaldo ${periodLabel} ${input.year}`,
          date: input.paid_date,
          user_id: input.logged_by_user_id,
          payment_method: input.payment_method,
          status: 'paid',
          is_recurring: false,
        })
        .select()
        .single()
      if (txErr) throw txErr

      await supabase
        .from('bonus_payments')
        .update({ transaction_id: tx.id })
        .eq('id', bonus.id)
        .eq('tenant_id', tenantId)

      return { bonus, tx }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['bonus-payments', tenantId] })
      qc.invalidateQueries({ queryKey: ['bonus-payments', tenantId, vars.year] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-transactions'] })
    },
  })
}

// ── Register vacation payment ─────────────────────────────────────────────────

type RegisterVacationInput = {
  user_id: string
  year: number
  entitled_days: number
  days_taken: number
  start_date: string
  end_date: string
  daily_salary: number
  amount: number
  paid_date: string
  payment_method: string
  applied_by: string
  logged_by_user_id: string
  employee_name: string
}

export function useRegisterVacationPayment() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: RegisterVacationInput) => {
      const { data: vac, error: vacErr } = await supabase
        .from('vacation_records')
        .upsert(
          {
            tenant_id: tenantId,
            user_id: input.user_id,
            year: input.year,
            entitled_days: input.entitled_days,
            days_taken: input.days_taken,
            start_date: input.start_date,
            end_date: input.end_date,
            daily_salary: input.daily_salary,
            amount: input.amount,
            paid_date: input.paid_date,
            payment_method: input.payment_method,
            applied_by: input.applied_by,
          },
          { onConflict: 'tenant_id,user_id,year' },
        )
        .select()
        .single()
      if (vacErr) throw vacErr

      const { data: tx, error: txErr } = await supabase
        .from('transactions')
        .insert({
          tenant_id: tenantId,
          type: 'expense',
          category: 'vacaciones',
          amount: input.amount,
          description: `Vacaciones ${input.year} - ${input.employee_name}`,
          date: input.paid_date,
          user_id: input.logged_by_user_id,
          payment_method: input.payment_method,
          status: 'paid',
          is_recurring: false,
        })
        .select()
        .single()
      if (txErr) throw txErr

      await supabase
        .from('vacation_records')
        .update({ transaction_id: tx.id })
        .eq('id', vac.id)
        .eq('tenant_id', tenantId)

      return { vac, tx }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['vacation-records', tenantId] })
      qc.invalidateQueries({ queryKey: ['vacation-records', tenantId, vars.year] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-transactions'] })
    },
  })
}

// ── Weekly schedules (Horarios tab) ───────────────────────────────────────────

export type WeeklyScheduleDayKey =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

export const WEEKLY_SCHEDULE_DAY_KEYS: WeeklyScheduleDayKey[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

// Date.getDay() (0 = Sunday) → column prefix in employee_weekly_schedules
export const JS_DAY_TO_SCHEDULE_KEY: Record<number, WeeklyScheduleDayKey> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday',
}

export type EmployeeWeeklySchedule = {
  id: string
  tenant_id: string
  user_id: string
  week_start: string
  monday_from?: string | null; monday_to?: string | null
  tuesday_from?: string | null; tuesday_to?: string | null
  wednesday_from?: string | null; wednesday_to?: string | null
  thursday_from?: string | null; thursday_to?: string | null
  friday_from?: string | null; friday_to?: string | null
  saturday_from?: string | null; saturday_to?: string | null
  sunday_from?: string | null; sunday_to?: string | null
  total_hours: number
  created_at: string
  updated_at: string
}

export function useEmployeeWeeklySchedules(weekStart: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-weekly-schedules', tenantId, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_weekly_schedules')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('week_start', weekStart)
      if (error) throw error
      return data as EmployeeWeeklySchedule[]
    },
    enabled: !!tenantId && !!weekStart,
  })
}

export function useEmployeeWeeklySchedulesRange(startDate: string, endDate: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['employee-weekly-schedules-range', tenantId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_weekly_schedules')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('week_start', startDate)
        .lte('week_start', endDate)
      if (error) throw error
      return data as EmployeeWeeklySchedule[]
    },
    enabled: !!tenantId && !!startDate && !!endDate,
  })
}

function mondayOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
  date.setHours(0, 0, 0, 0)
  return date
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Every Monday (week_start) that has at least one day falling in `year`-`month`.
// If the month starts mid-week, the first entry is the Monday before the 1st.
export function getMonthWeekStarts(year: number, month: number): string[] {
  const firstDay = new Date(year, month - 1, 1)
  const lastDay = new Date(year, month, 0)
  const cur = mondayOfWeek(firstDay)
  const result: string[] = []
  while (cur.getTime() <= lastDay.getTime()) {
    result.push(toDateKey(cur))
    cur.setDate(cur.getDate() + 7)
  }
  return result
}

export type EmployeeWeeklySchedulesMonth = {
  schedules: EmployeeWeeklySchedule[]
  weekStarts: string[]
  // user_id → week_start dates missing for that user (only users with at least one row
  // this month appear here; a user absent from `schedules` entirely isn't tracked).
  missingByUser: Map<string, string[]>
}

export function useEmployeeWeeklySchedulesMonth(year: number, month: number) {
  const tenantId = useTenantId()
  const weekStarts = useMemo(() => getMonthWeekStarts(year, month), [year, month])
  return useQuery({
    queryKey: ['employee-weekly-schedules-month', tenantId, year, month],
    queryFn: async (): Promise<EmployeeWeeklySchedulesMonth> => {
      const { data, error } = await supabase
        .from('employee_weekly_schedules')
        .select('*')
        .eq('tenant_id', tenantId)
        .in('week_start', weekStarts)
      if (error) throw error
      const schedules = (data ?? []) as EmployeeWeeklySchedule[]

      const weeksByUser = new Map<string, Set<string>>()
      for (const row of schedules) {
        if (!weeksByUser.has(row.user_id)) weeksByUser.set(row.user_id, new Set())
        weeksByUser.get(row.user_id)!.add(row.week_start)
      }
      const missingByUser = new Map<string, string[]>()
      for (const [userId, weeks] of weeksByUser) {
        const missing = weekStarts.filter(ws => !weeks.has(ws))
        if (missing.length > 0) missingByUser.set(userId, missing)
      }
      return { schedules, weekStarts, missingByUser }
    },
    enabled: !!tenantId && !!year && !!month,
  })
}

function scheduleTotalHours(row: Record<string, string | null>): number {
  let total = 0
  for (const day of WEEKLY_SCHEDULE_DAY_KEYS) {
    const from = row[`${day}_from`]
    const to = row[`${day}_to`]
    if (from && to) {
      const [fh, fm] = from.split(':').map(Number)
      const [th, tm] = to.split(':').map(Number)
      total += (th * 60 + tm - (fh * 60 + fm)) / 60
    }
  }
  return Math.round(total * 100) / 100
}

type UpsertWeeklyScheduleInput = {
  user_id: string
  week_start: string
  day: WeeklyScheduleDayKey
  from: string | null
  to: string | null
}

export function useUpsertWeeklySchedule() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpsertWeeklyScheduleInput) => {
      const { data: existing, error: fetchError } = await supabase
        .from('employee_weekly_schedules')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', input.user_id)
        .eq('week_start', input.week_start)
        .maybeSingle()
      if (fetchError) throw fetchError

      const row: Record<string, string | null> = {}
      for (const day of WEEKLY_SCHEDULE_DAY_KEYS) {
        row[`${day}_from`] = existing?.[`${day}_from`] ?? null
        row[`${day}_to`] = existing?.[`${day}_to`] ?? null
      }
      row[`${input.day}_from`] = input.from
      row[`${input.day}_to`] = input.to

      const { data, error } = await supabase
        .from('employee_weekly_schedules')
        .upsert(
          {
            tenant_id: tenantId,
            user_id: input.user_id,
            week_start: input.week_start,
            ...row,
            total_hours: scheduleTotalHours(row),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,user_id,week_start' },
        )
        .select()
        .single()
      if (error) throw error
      return data as EmployeeWeeklySchedule
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employee-weekly-schedules'] })
      qc.invalidateQueries({ queryKey: ['employee-weekly-schedules-month'] })
    },
  })
}

export type AppointmentHourCount = { hour: number; count: number }

export function useAppointmentsByDay(date: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['appointments-by-day', tenantId, date],
    queryFn: async (): Promise<AppointmentHourCount[]> => {
      // Argentina has no DST since 2009, so ART is a fixed UTC-3 offset:
      // ART midnight for `date` is `${date}T03:00:00Z`.
      const startUTC = `${date}T03:00:00.000Z`
      const nextDate = new Date(new Date(`${date}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10)
      const endUTC = `${nextDate}T03:00:00.000Z`

      const { data, error } = await supabase
        .from('appointments')
        .select('scheduled_at, duration_minutes')
        .eq('tenant_id', tenantId)
        .gte('scheduled_at', startUTC)
        .lt('scheduled_at', endUTC)
        .not('status', 'in', '(cancelled,no_show)')
      if (error) throw error

      const counts = new Array(24).fill(0)
      for (const row of (data ?? []) as { scheduled_at: string }[]) {
        const hour = Number(
          new Date(row.scheduled_at).toLocaleString('en-US', {
            timeZone: 'America/Argentina/Buenos_Aires',
            hour: 'numeric',
            hourCycle: 'h23',
          }),
        )
        counts[hour]++
      }
      return counts.map((count, hour) => ({ hour, count }))
    },
    enabled: !!tenantId && !!date,
  })
}

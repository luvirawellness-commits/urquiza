import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

export type EmployeeProfile = {
  id: string; tenant_id: string; user_id: string; job_position_id: string
  start_date: string; expected_monthly_hours: number
  productivity_threshold_1?: number | null; productivity_bonus_1?: number | null
  productivity_threshold_2?: number | null; productivity_bonus_2?: number | null
  active: boolean; notes?: string | null; created_at: string; updated_at: string
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

export function calcMonthScheduleHours(
  schedule: Record<string, { start: string; end: string }[]> | null | undefined,
  year: number,
  month: number, // 1-indexed
): number {
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

export function calcHolidayBonus(
  schedule: Record<string, { start: string; end: string }[]> | null | undefined,
  hourlyRate: number,
  holidays: Holiday[],
  absences: { date: string; deduct_from_salary: boolean }[],
): HolidayDetail[] {
  if (!schedule || !hourlyRate) return []
  const result: HolidayDetail[] = []
  for (const h of holidays) {
    const hasAbsence = absences.some(a => a.date === h.date)
    if (hasAbsence) continue
    const dayKey = DAY_KEYS_SHORT[new Date(h.date + 'T12:00:00').getDay()]
    const ranges = (schedule[dayKey] ?? []) as { start: string; end: string }[]
    let hours = 0
    for (const r of ranges) {
      const [sh, sm] = r.start.split(':').map(Number)
      const [eh, em] = r.end.split(':').map(Number)
      hours += (eh * 60 + em - (sh * 60 + sm)) / 60
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
  return useQuery({
    queryKey: ['job-positions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('job_positions').select('*').eq('tenant_id', TENANT_ID).order('name')
      if (error) throw error
      return data as JobPosition[]
    },
  })
}

export function useEmployeeProfiles() {
  return useQuery({
    queryKey: ['employee-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_profiles')
        .select('*, user:users!employee_profiles_user_id_fkey(id,full_name,color_hex,schedule), position:job_positions!employee_profiles_job_position_id_fkey(*)')
        .eq('tenant_id', TENANT_ID)
        .order('created_at')
      if (error) throw error
      return data as EmployeeProfile[]
    },
  })
}

export function useAllTenantUsers() {
  return useQuery({
    queryKey: ['tenant-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users').select('id,full_name,role,color_hex')
        .eq('tenant_id', TENANT_ID).eq('active', true).order('full_name')
      if (error) throw error
      return data as { id: string; full_name: string; role: string; color_hex?: string | null }[]
    },
  })
}

export function useAbsences(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['employee-absences', startDate, endDate],
    queryFn: async () => {
      let q = supabase
        .from('employee_absences')
        .select('*, employee_user:users!employee_absences_user_id_fkey(full_name), registrar:users!employee_absences_registered_by_fkey(full_name)')
        .eq('tenant_id', TENANT_ID).order('date', { ascending: false })
      if (startDate) q = q.gte('date', startDate)
      if (endDate) q = q.lte('date', endDate)
      const { data, error } = await q
      if (error) throw error
      return data as EmployeeAbsence[]
    },
  })
}

export function useCCSSByMonth(yearMonth: string) {
  return useQuery({
    queryKey: ['employee-ccss', yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_ccss').select('*').eq('tenant_id', TENANT_ID)
        .eq('period_month', `${yearMonth}-01`)
      if (error) throw error
      return data as EmployeeCCSS[]
    },
    enabled: !!yearMonth,
  })
}

export function useCompletedApptsByTherapist(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]
  return useQuery({
    queryKey: ['completed-appts-therapist-month', yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments').select('therapist_id,duration_minutes,scheduled_at')
        .eq('tenant_id', TENANT_ID).eq('status', 'completed')
        .gte('scheduled_at', `${yearMonth}-01T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (error) throw error
      return data as { therapist_id: string; duration_minutes: number; scheduled_at: string }[]
    },
    enabled: !!yearMonth,
  })
}

export function useAbsencesByMonth(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]
  return useQuery({
    queryKey: ['absences-month', yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_absences').select('user_id,hours_absent,deduct_from_salary,date')
        .eq('tenant_id', TENANT_ID)
        .gte('date', `${yearMonth}-01`).lte('date', endDate)
      if (error) throw error
      return data as { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[]
    },
    enabled: !!yearMonth,
  })
}

export function useHolidaysForYear(year: number) {
  return useQuery({
    queryKey: ['holidays', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays').select('*').eq('tenant_id', TENANT_ID)
        .gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
        .order('date')
      if (error) throw error
      return data as Holiday[]
    },
  })
}

export function useHolidaysForMonth(yearMonth: string) {
  const [y, m] = yearMonth.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]
  return useQuery({
    queryKey: ['holidays-month', yearMonth],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays').select('*').eq('tenant_id', TENANT_ID)
        .gte('date', `${yearMonth}-01`).lte('date', endDate)
        .order('date')
      if (error) throw error
      return data as Holiday[]
    },
    enabled: !!yearMonth,
  })
}

// For P&L multi-month RRHH cost computation
export function useCompletedApptsRange(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['completed-appts-range', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments').select('therapist_id,duration_minutes,scheduled_at')
        .eq('tenant_id', TENANT_ID).eq('status', 'completed')
        .gte('scheduled_at', `${startDate}T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (error) throw error
      return data as { therapist_id: string; duration_minutes: number; scheduled_at: string }[]
    },
  })
}

export function useAbsencesRange(startDate: string, endDate: string) {
  return useQuery({
    queryKey: ['absences-range', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_absences').select('user_id,hours_absent,deduct_from_salary,date')
        .eq('tenant_id', TENANT_ID).gte('date', startDate).lte('date', endDate)
      if (error) throw error
      return data as { user_id: string; hours_absent: number; deduct_from_salary: boolean; date: string }[]
    },
  })
}

export function usePaidCCSSForMonths(months: string[]) {
  const start = months[0] ? `${months[0]}-01` : '2000-01-01'
  const end = months[months.length - 1] ? `${months[months.length - 1]}-01` : '2099-12-01'
  return useQuery({
    queryKey: ['paid-ccss-months', start, end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_ccss').select('user_id,period_month,amount')
        .eq('tenant_id', TENANT_ID).eq('status', 'paid')
        .gte('period_month', start).lte('period_month', end)
      if (error) throw error
      return data as { user_id: string; period_month: string; amount: number }[]
    },
    enabled: months.length > 0,
  })
}

// Aggregated RRHH cost per month — used by P&L
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
      const endD = new Date(y, m, 0).toISOString().split('T')[0]
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreatePositionInput) => {
      const { data, error } = await supabase
        .from('job_positions').insert({ ...input, tenant_id: TENANT_ID }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-positions'] }),
  })
}

export function useUpdateJobPosition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<CreatePositionInput> & { id: string }) => {
      const { error } = await supabase
        .from('job_positions').update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', TENANT_ID)
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
}

export function useCreateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateEmployeeInput) => {
      const { data, error } = await supabase
        .from('employee_profiles').insert({ ...input, tenant_id: TENANT_ID, active: true }).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['employee-profiles'] }),
  })
}

export function useUpdateEmployee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<CreateEmployeeInput> & { id: string; active?: boolean }) => {
      const { error } = await supabase
        .from('employee_profiles').update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', TENANT_ID)
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateAbsenceInput) => {
      const { data, error } = await supabase
        .from('employee_absences').insert({ ...input, tenant_id: TENANT_ID }).select().single()
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ user_id, period_month, amount, notes }: { user_id: string; period_month: string; amount: number; notes?: string }) => {
      const { data, error } = await supabase
        .from('employee_ccss')
        .upsert({ user_id, period_month, amount, notes: notes ?? null, tenant_id: TENANT_ID, status: 'pending' },
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ date, name, created_by }: { date: string; name: string; created_by: string }) => {
      const { data, error } = await supabase
        .from('holidays').insert({ date, name, created_by, tenant_id: TENANT_ID }).select().single()
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

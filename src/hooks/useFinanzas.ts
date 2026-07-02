import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Appointment, Transaction } from '@/types'
import { getArgentinaDateString } from '../utils/dateUtils'

export function useTransactions(month?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['transactions', tenantId, month],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false })

      if (month) {
        const start = `${month}-01`
        const end = `${month}-31`
        query = query.gte('date', start).lte('date', end)
      }

      const { data, error } = await query
      if (error) throw error
      return data as Transaction[]
    },
    enabled: !!tenantId,
  })
}

export function useTodayTransactions() {
  const tenantId = useTenantId()
  const today = getArgentinaDateString()
  return useQuery({
    queryKey: ['transactions', tenantId, 'today', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
    refetchInterval: 30_000,
    enabled: !!tenantId,
  })
}

export function useTodayMetrics() {
  const tenantId = useTenantId()
  const today = getArgentinaDateString()
  return useQuery({
    queryKey: ['today-metrics', tenantId, today],
    queryFn: async () => {
      const [txRes, apptRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('amount, payment_method, type')
          .eq('tenant_id', tenantId)
          .eq('date', today)
          .eq('status', 'paid'),
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59`)
          .eq('status', 'completed'),
      ])

      const allTx = txRes.data ?? []
      const totalCobrado = allTx
        .filter((t) => t.type === 'income')
        .reduce((s, t) => s + (t.amount ?? 0), 0)
      const cashIncome = allTx
        .filter((t) => t.payment_method === 'cash' && t.type === 'income')
        .reduce((s, t) => s + (t.amount ?? 0), 0)
      const cashExpense = allTx
        .filter((t) => t.payment_method === 'cash' && t.type === 'expense')
        .reduce((s, t) => s + (t.amount ?? 0), 0)
      const efectivoEnCaja = cashIncome - cashExpense

      return {
        totalCobrado,
        sesionesCompletadas: apptRes.count ?? 0,
        efectivoEnCaja,
      }
    },
    refetchInterval: 30_000,
    enabled: !!tenantId,
  })
}

type InsertTransactionInput = {
  type: 'income' | 'expense'
  category: string
  amount: number
  payment_method: string
  description: string
  date: string
  user_id: string
  status: string
  is_recurring: boolean
  appointment_id?: string
}

export function useInsertTransaction() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { logAction } = useAuditLog()
  return useMutation({
    mutationFn: async (tx: InsertTransactionInput) => {
      const { data, error } = await supabase
        .from('transactions')
        .insert({ ...tx, tenant_id: tenantId })
        .select()
        .single()
      if (error) throw error
      return data as Transaction
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
      logAction({
        action: 'CREATE',
        module: 'finanzas',
        entityType: 'transaction',
        entityId: data.id,
        entityName: `${variables.description} $${variables.amount}`,
      })
    },
  })
}

export function useClientTransactions(clientId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['client-transactions', tenantId, clientId],
    queryFn: async () => {
      const { data: apptData } = await supabase
        .from('appointments')
        .select('id')
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .order('scheduled_at', { ascending: false })
        .limit(50)

      const apptIds = (apptData ?? []).map((a: { id: string }) => a.id)
      if (apptIds.length === 0) return [] as Transaction[]

      const { data, error } = await supabase
        .from('transactions')
        .select('id, date, type, category, amount, payment_method, description, created_at')
        .in('appointment_id', apptIds)
        .eq('tenant_id', tenantId)
        .order('date', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as Transaction[]
    },
    enabled: !!clientId && !!tenantId,
  })
}

export function useClientMembership(clientId: string | null) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['membership', tenantId, clientId],
    queryFn: async () => {
      if (!clientId) return null
      const { data } = await supabase
        .from('memberships')
        .select('id, status, expires_at')
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!clientId && !!tenantId,
    retry: 0,
    throwOnError: false,
  })
}

export function useTransactionsRange(
  startDate: string,
  endDate: string,
  filterByTenant = true,
  enabled = true,
) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['transactions', 'range', tenantId, startDate, endDate, filterByTenant],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
      if (filterByTenant) query = query.eq('tenant_id', tenantId)
      const { data, error } = await query
      if (error) throw error
      return data as Transaction[]
    },
    enabled: !!tenantId && enabled,
  })
}

export function useCompletedAppointmentsForCMV(startDate: string, endDate: string, filterByTenant = true) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['appointments', 'cmv', tenantId, startDate, endDate, filterByTenant],
    queryFn: async () => {
      let query = supabase
        .from('appointments')
        .select('id, service_id, duration_minutes, scheduled_at')
        .eq('status', 'completed')
        .gte('scheduled_at', `${startDate}T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (filterByTenant) query = query.eq('tenant_id', tenantId)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as { id: string; service_id: string; duration_minutes: number; scheduled_at: string }[]
    },
    enabled: !!tenantId,
  })
}

export function useDashboardMetrics() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['dashboard-metrics', tenantId],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      const monthStart = today.slice(0, 7) + '-01'

      const [sesionesRes, billingRes, clientsRes, membsRes] = await Promise.all([
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'completed')
          .gte('scheduled_at', `${today}T00:00:00`)
          .lte('scheduled_at', `${today}T23:59:59`),
        supabase
          .from('transactions')
          .select('amount')
          .eq('tenant_id', tenantId)
          .eq('type', 'income')
          .eq('status', 'paid')
          .gte('date', monthStart)
          .lte('date', today),
        supabase
          .from('clients')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'active'),
        supabase
          .from('client_memberships')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .gte('expires_at', today),
      ])

      const billingThisMonth = (billingRes.data ?? []).reduce(
        (sum, t) => sum + (t.amount ?? 0),
        0,
      )

      return {
        sesionesHoy: sesionesRes.count ?? 0,
        billingThisMonth,
        activeClients: clientsRes.count ?? 0,
        activeMemberships: membsRes.count ?? 0,
      }
    },
    enabled: !!tenantId,
    refetchInterval: 60_000,
  })
}

export function useMovimientosCaja(dateFrom: string, dateTo: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['transactions', 'movimientos', tenantId, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', tenantId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
    enabled: !!tenantId && !!dateFrom && !!dateTo && dateFrom <= dateTo,
  })
}

export function useLastCajaClose() {
  const tenantId = useTenantId()
  const today = getArgentinaDateString()
  return useQuery({
    queryKey: ['last-caja-close', tenantId, today],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('created_at')
        .eq('tenant_id', tenantId)
        .eq('date', today)
        .eq('type', 'expense')
        .eq('category', 'cash_transfer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data?.created_at ?? null
    },
    enabled: !!tenantId,
  })
}

export type ReservaRow = {
  id: string
  created_at: string
  source: string | null
  price_charged: number | null
  status: string
}

export function useReservasOnline(dateFrom: string, dateTo: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['reservas-online', tenantId, dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, created_at, source, price_charged, status')
        .eq('tenant_id', tenantId)
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as ReservaRow[]
    },
    enabled: !!tenantId && !!dateFrom && !!dateTo && dateFrom <= dateTo,
  })
}

export function useTodayAgenda() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['today-agenda', tenantId],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_at, status, box_number,
          client:clients!fk_apt_client(id, first_name, last_name),
          therapist:users!fk_apt_therapist(id, full_name, color_hex),
          service:services!fk_apt_service(id, name, emoji)
        `)
        .eq('tenant_id', tenantId)
        .in('status', ['pending', 'confirmed', 'completed'])
        .gte('scheduled_at', `${today}T00:00:00`)
        .lte('scheduled_at', `${today}T23:59:59`)
        .order('scheduled_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as Appointment[]
    },
    enabled: !!tenantId,
    refetchInterval: 60_000,
  })
}

type AtRiskClient = {
  id: string
  first_name: string
  last_name?: string | null
  phone?: string | null
  last_visit_at?: string | null
}

type AlertMembership = {
  id: string
  expires_at?: string | null
  sessions_used?: number | null
  client?: { id: string; first_name: string; last_name?: string | null } | null
  plan?: { id: string; name: string; sessions_qty?: number | null } | null
}

export type DashboardAlerts = {
  atRiskClients: AtRiskClient[]
  expiringMemberships: AlertMembership[]
  lowSessionMemberships: AlertMembership[]
}

export function useDashboardAlerts() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['dashboard-alerts', tenantId],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      const sevenDaysLater = (() => {
        const d = new Date()
        d.setDate(d.getDate() + 7)
        return d.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
      })()

      const membershipSelect = `id, expires_at, sessions_used, client:clients(id, first_name, last_name), plan:memberships!fk_cm_membership_id(id, name, sessions_qty)`

      const [atRiskRes, expiringRes, allActiveRes] = await Promise.all([
        supabase
          .from('clients')
          .select('id, first_name, last_name, phone, last_visit_at')
          .eq('tenant_id', tenantId)
          .eq('status', 'at_risk')
          .order('last_visit_at', { ascending: true })
          .limit(5),
        supabase
          .from('client_memberships')
          .select(membershipSelect)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .gte('expires_at', today)
          .lte('expires_at', sevenDaysLater)
          .order('expires_at', { ascending: true })
          .limit(5),
        supabase
          .from('client_memberships')
          .select(membershipSelect)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .gte('expires_at', today)
          .limit(100),
      ])

      const lowSessions = (allActiveRes.data ?? [])
        .filter((m) => {
          const qty = (m.plan as { sessions_qty?: number | null } | null)?.sessions_qty ?? 0
          if (qty === 0) return false
          return qty - (m.sessions_used ?? 0) <= 1
        })
        .slice(0, 5) as unknown as AlertMembership[]

      return {
        atRiskClients: (atRiskRes.data ?? []) as AtRiskClient[],
        expiringMemberships: (expiringRes.data ?? []) as unknown as AlertMembership[],
        lowSessionMemberships: lowSessions,
      }
    },
    enabled: !!tenantId,
  })
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'
import { Transaction } from '@/types'

export function useTransactions(month?: string) {
  return useQuery({
    queryKey: ['transactions', month],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', TENANT_ID)
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
  })
}

export function useTodayTransactions() {
  const today = new Date().toISOString().split('T')[0]
  return useQuery({
    queryKey: ['transactions', 'today', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .eq('date', today)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Transaction[]
    },
    refetchInterval: 30_000,
  })
}

export function useTodayMetrics() {
  const today = new Date().toISOString().split('T')[0]
  return useQuery({
    queryKey: ['today-metrics', today],
    queryFn: async () => {
      const [txRes, apptRes] = await Promise.all([
        supabase
          .from('transactions')
          .select('amount, payment_method, type')
          .eq('tenant_id', TENANT_ID)
          .eq('date', today)
          .eq('status', 'paid'),
        supabase
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', TENANT_ID)
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tx: InsertTransactionInput) => {
      const { data, error } = await supabase
        .from('transactions')
        .insert({ ...tx, tenant_id: TENANT_ID })
        .select()
        .single()
      if (error) throw error
      return data as Transaction
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
    },
  })
}

export function useClientMembership(clientId: string | null) {
  return useQuery({
    queryKey: ['membership', clientId],
    queryFn: async () => {
      if (!clientId) return null
      const { data } = await supabase
        .from('memberships')
        .select('id, status, expires_at')
        .eq('client_id', clientId)
        .eq('tenant_id', TENANT_ID)
        .eq('status', 'active')
        .maybeSingle()
      return data
    },
    enabled: !!clientId,
    retry: 0,
    throwOnError: false,
  })
}

export function useTransactionsRange(startDate: string, endDate: string, filterByTenant = true) {
  return useQuery({
    queryKey: ['transactions', 'range', startDate, endDate, filterByTenant],
    queryFn: async () => {
      let query = supabase
        .from('transactions')
        .select('*')
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true })
      if (filterByTenant) query = query.eq('tenant_id', TENANT_ID)
      const { data, error } = await query
      if (error) throw error
      return data as Transaction[]
    },
  })
}

export function useCompletedAppointmentsForCMV(startDate: string, endDate: string, filterByTenant = true) {
  return useQuery({
    queryKey: ['appointments', 'cmv', startDate, endDate, filterByTenant],
    queryFn: async () => {
      let query = supabase
        .from('appointments')
        .select('id, service_id, duration_minutes, scheduled_at')
        .eq('status', 'completed')
        .gte('scheduled_at', `${startDate}T00:00:00`)
        .lte('scheduled_at', `${endDate}T23:59:59`)
      if (filterByTenant) query = query.eq('tenant_id', TENANT_ID)
      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as { id: string; service_id: string; duration_minutes: number; scheduled_at: string }[]
    },
  })
}

export function useDashboardMetrics() {
  return useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const monthStart = today.slice(0, 7) + '-01'
      const weekStart = (() => {
        const d = new Date()
        const day = d.getDay()
        const diff = d.getDate() - day + (day === 0 ? -6 : 1)
        d.setDate(diff)
        return d.toISOString().split('T')[0]
      })()

      const [clientsRes, todayApptRes, monthRevRes, weekApptRes] = await Promise.all([
        supabase.from('clients').select('id', { count: 'exact', head: true }).eq('tenant_id', TENANT_ID),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('tenant_id', TENANT_ID)
          .gte('starts_at', `${today}T00:00:00`)
          .lte('starts_at', `${today}T23:59:59`),
        supabase.from('transactions').select('amount').eq('tenant_id', TENANT_ID)
          .eq('type', 'income').gte('date', monthStart).lte('date', today),
        supabase.from('appointments').select('id', { count: 'exact', head: true })
          .eq('tenant_id', TENANT_ID)
          .gte('starts_at', `${weekStart}T00:00:00`),
      ])

      const revenueThisMonth = (monthRevRes.data ?? []).reduce((sum, t) => sum + (t.amount ?? 0), 0)

      return {
        totalClients: clientsRes.count ?? 0,
        appointmentsToday: todayApptRes.count ?? 0,
        revenueThisMonth,
        appointmentsThisWeek: weekApptRes.count ?? 0,
      }
    },
  })
}

import { useQuery } from '@tanstack/react-query'
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

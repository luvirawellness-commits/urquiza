import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import type { SupplierInvoice } from '@/types'
import { getArgentinaDateString } from '../utils/dateUtils'

type InvoiceFilters = {
  from?: string
  to?: string
}

export function useSupplierInvoices(filters: InvoiceFilters = {}) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['supplier-invoices', tenantId, filters.from, filters.to],
    queryFn: async () => {
      let query = supabase
        .from('supplier_invoices')
        .select('*, supplier_invoice_payments(*)')
        .eq('tenant_id', tenantId)
        .order('due_date', { ascending: true })

      if (filters.from) query = query.gte('issue_date', filters.from)
      if (filters.to) query = query.lte('issue_date', filters.to)

      const { data, error } = await query
      if (error) throw error
      const today = getArgentinaDateString()
      return ((data ?? []) as SupplierInvoice[]).map((inv) => ({
        ...inv,
        isOverdue: inv.status === 'pending' && inv.due_date < today,
      }))
    },
    enabled: !!tenantId,
  })
}

type CreateInvoiceInput = {
  supplier_name: string
  invoice_number?: string
  description: string
  category: string
  amount: number
  issue_date: string
  due_date: string
  userId: string
  employee_user_id?: string | null
  salary_period_year?: number | null
  salary_period_month?: number | null
}

export function useCreateSupplierInvoice() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const { data: invoice, error: invError } = await supabase
        .from('supplier_invoices')
        .insert({
          tenant_id: tenantId,
          supplier_name: input.supplier_name,
          invoice_number: input.invoice_number ?? null,
          description: input.description,
          category: input.category,
          amount: input.amount,
          issue_date: input.issue_date,
          due_date: input.due_date,
          status: 'pending',
          employee_user_id: input.employee_user_id ?? null,
          salary_period_year: input.salary_period_year ?? null,
          salary_period_month: input.salary_period_month ?? null,
        })
        .select()
        .single()
      if (invError) throw invError

      const desc = input.invoice_number
        ? `${input.supplier_name} · Fac. ${input.invoice_number}: ${input.description}`
        : `${input.supplier_name}: ${input.description}`

      const { data: tx, error: txError } = await supabase
        .from('transactions')
        .insert({
          tenant_id: tenantId,
          type: 'expense',
          category: input.category,
          amount: input.amount,
          description: desc,
          date: input.issue_date,
          user_id: input.userId,
          status: 'pending',
          is_recurring: false,
          payment_method: 'transfer',
          employee_user_id: input.employee_user_id ?? null,
          salary_period_year: input.salary_period_year ?? null,
          salary_period_month: input.salary_period_month ?? null,
        })
        .select()
        .single()
      if (txError) throw txError

      await supabase
        .from('supplier_invoices')
        .update({ transaction_id: tx.id })
        .eq('id', invoice.id)
        .eq('tenant_id', tenantId)

      return { invoice, tx }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export interface PaymentSplit {
  paymentMethod: string
  amount: number
}

type MarkPaidInput = {
  invoiceId: string
  transactionId?: string | null
  splits: PaymentSplit[]
  paidDate: string
  category: string
  description: string
  userId: string
  employeeUserId?: string | null
  salaryPeriodYear?: number | null
  salaryPeriodMonth?: number | null
}

export function useMarkInvoicePaid() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: MarkPaidInput) => {
      const methodStr = input.splits.map(s => s.paymentMethod).join(',')

      const { error: invError } = await supabase
        .from('supplier_invoices')
        .update({
          status: 'paid',
          paid_date: input.paidDate,
          payment_method: methodStr,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.invoiceId)
        .eq('tenant_id', tenantId)
      if (invError) throw invError

      // The original transaction (input.transactionId) is intentionally left
      // untouched: it stays status 'pending', dated at issue_date, amount the
      // full invoice — that's what drives P&L for the month the invoice was
      // issued. Cash flow gets its own brand-new, is_cashflow_only transactions
      // dated at the actual paid_date, one per payment split.
      const description = `${input.description} (pago)`
      const { data: newTxs, error: txError } = await supabase
        .from('transactions')
        .insert(input.splits.map((split) => ({
          tenant_id: tenantId,
          type: 'expense',
          category: input.category,
          amount: split.amount,
          description,
          date: input.paidDate,
          user_id: input.userId,
          payment_method: split.paymentMethod,
          status: 'paid',
          is_cashflow_only: true,
          employee_user_id: input.employeeUserId ?? null,
          salary_period_year: input.salaryPeriodYear ?? null,
          salary_period_month: input.salaryPeriodMonth ?? null,
        })))
        .select('id')
      if (txError) throw txError

      const { error: sipError } = await supabase
        .from('supplier_invoice_payments')
        .insert(input.splits.map((split, i) => ({
          invoice_id: input.invoiceId,
          transaction_id: newTxs?.[i]?.id ?? null,
          payment_method: split.paymentMethod,
          amount: split.amount,
        })))
      if (sipError) throw sipError
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] })
      qc.invalidateQueries({ queryKey: ['today-transactions'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
    },
  })
}

type UpdateInvoiceInput = {
  invoiceId: string
  transactionId?: string | null
  supplier_name: string
  invoice_number?: string
  description: string
  category: string
  amount: number
  issue_date: string
  due_date: string
}

export function useUpdateSupplierInvoice() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: UpdateInvoiceInput) => {
      const { error: invError } = await supabase
        .from('supplier_invoices')
        .update({
          supplier_name: input.supplier_name,
          invoice_number: input.invoice_number ?? null,
          description: input.description,
          category: input.category,
          amount: input.amount,
          issue_date: input.issue_date,
          due_date: input.due_date,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.invoiceId)
        .eq('tenant_id', tenantId)
        .neq('status', 'paid')
      if (invError) throw invError

      if (!input.transactionId) {
        console.warn('[useUpdateSupplierInvoice] no transaction_id linked', input.invoiceId)
        return
      }

      const desc = input.invoice_number
        ? `${input.supplier_name} · Fac. ${input.invoice_number}: ${input.description}`
        : `${input.supplier_name}: ${input.description}`

      const { error: txError } = await supabase
        .from('transactions')
        .update({
          amount: input.amount,
          description: desc,
          date: input.issue_date,
          category: input.category,
        })
        .eq('id', input.transactionId)
        .eq('tenant_id', tenantId)
      if (txError) throw txError
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function useOverdueSupplierInvoicesCount(options?: { enabled?: boolean }) {
  const tenantId = useTenantId()
  const today = getArgentinaDateString()
  return useQuery({
    queryKey: ['supplier-invoices-overdue-count', tenantId, today],
    queryFn: async () => {
      const sevenDaysLater = new Date()
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)
      const sevenDaysLaterStr = sevenDaysLater.toLocaleDateString('sv-SE', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })

      const [overdueRes, soonRes] = await Promise.all([
        supabase
          .from('supplier_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'pending')
          .lt('due_date', today),
        supabase
          .from('supplier_invoices')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', tenantId)
          .eq('status', 'pending')
          .gte('due_date', today)
          .lte('due_date', sevenDaysLaterStr),
      ])

      return {
        overdue: overdueRes.count ?? 0,
        dueSoon: soonRes.count ?? 0,
      }
    },
    enabled: !!tenantId && (options?.enabled ?? true),
  })
}

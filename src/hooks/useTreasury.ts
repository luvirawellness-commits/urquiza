import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId, useAuth } from '@/contexts/AuthContext'
import { getArgentinaDateString } from '../utils/dateUtils'
import { getSettlementDate } from '../utils/settlementUtils'
import type { Transaction } from '@/types'

export type PaymentSettings = {
  id: string
  tenant_id: string
  qr_settlement_days: number
  qr_settlement_type: 'corridos' | 'habiles'
  debit_settlement_days: number
  debit_settlement_type: 'corridos' | 'habiles'
  credit_settlement_days: number
  credit_settlement_type: 'corridos' | 'habiles'
  created_at: string
  updated_at: string
}

export type MonthlyBalance = {
  id: string
  tenant_id: string
  year: number
  month: number
  opening_cash: number
  opening_safe: number
  opening_bank_transfer: number
  opening_bank_cards: number
  declared_by?: string | null
  declared_at: string
  notes?: string | null
  created_at: string
  updated_at: string
}

export type TreasuryDeclaration = {
  id: string
  tenant_id: string
  period_month: string
  declared_at: string
  declared_by: string
  notes: string | null
  created_at: string
}

export type TreasuryItem = {
  id: string
  declaration_id: string
  category: string
  label: string
  theoretical_amount: number
  declared_amount: number
  created_at: string
}

export function useTreasuryDeclarations(month: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['treasury_declarations', tenantId, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('treasury_declarations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('period_month', month)
        .order('declared_at', { ascending: false })
      if (error) throw error
      return data as TreasuryDeclaration[]
    },
    enabled: !!tenantId,
  })
}

export function useTreasuryItems(declarationId: string | null) {
  return useQuery({
    queryKey: ['treasury_items', declarationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('treasury_items')
        .select('*')
        .eq('declaration_id', declarationId as string)
        .order('created_at')
      if (error) throw error
      return data as TreasuryItem[]
    },
    enabled: !!declarationId,
  })
}

export function useTenantPaymentSettings() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['tenant-payment-settings', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_payment_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (error) throw error
      return data as PaymentSettings | null
    },
    enabled: !!tenantId,
  })
}

export function useUpdatePaymentSettings() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (settings: {
      qr_settlement_days: number
      qr_settlement_type: 'corridos' | 'habiles'
      debit_settlement_days: number
      debit_settlement_type: 'corridos' | 'habiles'
      credit_settlement_days: number
      credit_settlement_type: 'corridos' | 'habiles'
    }) => {
      const { data, error } = await supabase
        .from('tenant_payment_settings')
        .upsert(
          { tenant_id: tenantId, ...settings, updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id' },
        )
        .select()
        .single()
      if (error) throw error
      return data as PaymentSettings
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tenant-payment-settings', tenantId] })
    },
  })
}

export function useMonthlyBalances(year: number, month: number) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['monthly-balances', tenantId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('monthly_balances')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('year', year)
        .eq('month', month)
        .maybeSingle()
      if (error) throw error
      return data as MonthlyBalance | null
    },
    enabled: !!tenantId && !!year && !!month,
  })
}

export function useUpsertMonthlyBalance() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      year: number
      month: number
      opening_cash: number
      opening_safe: number
      opening_bank_transfer: number
      opening_bank_cards: number
      declared_by: string
      notes?: string
    }) => {
      const { data, error } = await supabase
        .from('monthly_balances')
        .upsert(
          {
            tenant_id: tenantId,
            year: payload.year,
            month: payload.month,
            opening_cash: payload.opening_cash,
            opening_safe: payload.opening_safe,
            opening_bank_transfer: payload.opening_bank_transfer,
            opening_bank_cards: payload.opening_bank_cards,
            declared_by: payload.declared_by,
            declared_at: new Date().toISOString(),
            notes: payload.notes ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,year,month' },
        )
        .select()
        .single()
      if (error) throw error
      return data as MonthlyBalance
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['monthly-balances', tenantId, vars.year, vars.month] })
    },
  })
}

export function useCreateTreasuryDeclaration() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      month: string
      declared_by: string
      notes?: string
      items: { category: string; label: string; theoretical_amount: number; declared_amount: number }[]
    }) => {
      const { data: decl, error: declErr } = await supabase
        .from('treasury_declarations')
        .insert({
          tenant_id: tenantId,
          declared_by: payload.declared_by,
          period_month: payload.month,
          notes: payload.notes ?? null,
        })
        .select()
        .single()
      if (declErr) throw declErr

      const items = payload.items.map((item) => ({
        declaration_id: decl.id,
        category: item.category,
        label: item.label,
        theoretical_amount: item.theoretical_amount,
        declared_amount: item.declared_amount,
      }))
      const { error: itemsErr } = await supabase.from('treasury_items').insert(items)
      if (itemsErr) throw itemsErr

      return decl
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['treasury_declarations', vars.month] })
    },
  })
}

export function useHolidays() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['holidays', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays')
        .select('date')
        .eq('tenant_id', tenantId)
      if (error) throw error
      return ((data ?? []) as { date: string }[]).map((r) => r.date)
    },
    enabled: !!tenantId,
  })
}

export type TreasuryAdjustment = {
  id: string
  tenant_id: string
  year: number
  month: number
  previous_cash: number
  previous_safe: number
  previous_bank_transfer: number
  previous_bank_cards: number
  new_cash: number
  new_safe: number
  new_bank_transfer: number
  new_bank_cards: number
  diff_cash: number
  diff_safe: number
  diff_bank_transfer: number
  diff_bank_cards: number
  declared_by?: string | null
  notes?: string | null
  declared_at: string
}

export function useTreasuryAdjustments(year: number, month: number) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['treasury-adjustments', tenantId, year, month],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('treasury_adjustments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('year', year)
        .eq('month', month)
        .order('declared_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as TreasuryAdjustment[]
    },
    enabled: !!tenantId,
  })
}

type RedeclareInput = {
  year: number
  month: number
  previous_cash: number
  previous_safe: number
  previous_transfer: number
  previous_cards: number
  new_cash: number
  new_safe: number
  new_transfer: number
  new_cards: number
  declared_by: string
  notes?: string
}

export function useRedeclareBalances() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { refreshTenants } = useAuth()
  return useMutation({
    mutationFn: async (input: RedeclareInput) => {
      const { error: adjError } = await supabase
        .from('treasury_adjustments')
        .insert({
          tenant_id: tenantId,
          year: input.year,
          month: input.month,
          previous_cash: input.previous_cash,
          previous_safe: input.previous_safe,
          previous_bank_transfer: input.previous_transfer,
          previous_bank_cards: input.previous_cards,
          new_cash: input.new_cash,
          new_safe: input.new_safe,
          new_bank_transfer: input.new_transfer,
          new_bank_cards: input.new_cards,
          diff_cash: input.new_cash - input.previous_cash,
          diff_safe: input.new_safe - input.previous_safe,
          diff_bank_transfer: input.new_transfer - input.previous_transfer,
          diff_bank_cards: input.new_cards - input.previous_cards,
          declared_by: input.declared_by,
          notes: input.notes ?? null,
          declared_at: new Date().toISOString(),
        })
      if (adjError) throw adjError

      const { error: balError } = await supabase
        .from('monthly_balances')
        .upsert(
          {
            tenant_id: tenantId,
            year: input.year,
            month: input.month,
            opening_cash: input.new_cash,
            opening_safe: input.new_safe,
            opening_bank_transfer: input.new_transfer,
            opening_bank_cards: input.new_cards,
            declared_by: input.declared_by,
            declared_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id,year,month' },
        )
      if (balError) throw balError

      // Redeclaring the Cajón balance is the source of truth for the tenant's
      // fixed cash fund too — keep tenants.caja_fondo_fijo in sync so Caja/Cierres
      // reflect the corrected amount immediately, not just monthly_balances.
      const { error: fondoError } = await supabase
        .from('tenants')
        .update({ caja_fondo_fijo: input.new_cash })
        .eq('id', tenantId)
      if (fondoError) throw fondoError
      await refreshTenants()
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['monthly-balances', tenantId, vars.year, vars.month] })
      qc.invalidateQueries({ queryKey: ['treasury-adjustments', tenantId, vars.year, vars.month] })
      qc.invalidateQueries({ queryKey: ['today-transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
    },
  })
}

export type PendingSettlement = {
  transaction: Transaction
  settlementDate: Date
  daysUntilSettlement: number
}

export type SettlementSplit = {
  settled: Transaction[]
  pending: PendingSettlement[]
}

export function usePendingSettlements(
  transactions: Transaction[],
  settings: PaymentSettings | null,
  holidays: string[],
): SettlementSplit {
  const today = getArgentinaDateString()
  return useMemo(() => {
    if (!settings) return { settled: transactions, pending: [] }
    const todayDate = new Date(today + 'T00:00:00')
    const settled: Transaction[] = []
    const pending: PendingSettlement[] = []
    for (const tx of transactions) {
      const pm = tx.payment_method ?? 'cash'
      const txDate = new Date((tx.date ?? today) + 'T00:00:00')
      const settlementDate = getSettlementDate(txDate, pm, settings, holidays)
      if (settlementDate <= todayDate) {
        settled.push(tx)
      } else {
        const msPerDay = 1000 * 60 * 60 * 24
        const daysUntilSettlement = Math.ceil(
          (settlementDate.getTime() - todayDate.getTime()) / msPerDay,
        )
        pending.push({ transaction: tx, settlementDate, daysUntilSettlement })
      }
    }
    return { settled, pending }
  }, [transactions, settings, holidays, today])
}

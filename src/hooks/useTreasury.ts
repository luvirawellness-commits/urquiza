import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'

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

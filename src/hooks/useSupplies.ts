import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import type { Supply, ServiceCostItem } from '@/types'

export function useSupplies() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['supplies', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplies')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name')
      if (error) throw error
      return data as Supply[]
    },
    enabled: !!tenantId,
  })
}

export function useSellableSupplies() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['supplies', tenantId, 'sellable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplies')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_sellable', true)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Supply[]
    },
    enabled: !!tenantId,
  })
}

type SupplyInput = Omit<Supply, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>

export function useCreateSupply() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SupplyInput) => {
      const { data, error } = await supabase
        .from('supplies')
        .insert({ ...input, tenant_id: tenantId })
        .select()
        .single()
      if (error) throw error
      return data as Supply
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useUpdateSupply() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: SupplyInput & { id: string }) => {
      const { data, error } = await supabase
        .from('supplies')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) throw error
      return data as Supply
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useDeleteSupply() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('supplies')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useAllServiceCostItems() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['service-cost-items', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_cost_structure')
        .select('*, supply:supply_id ( id, name, code, unit, unit_price )')
        .eq('tenant_id', tenantId)
      if (error) throw error
      return (data ?? []) as ServiceCostItem[]
    },
    enabled: !!tenantId,
  })
}

type AddCostItemInput = {
  service_id: string
  duration_minutes: 60 | 90
  supply_id: string
  quantity: number
}

export function useAddCostItem() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddCostItemInput) => {
      const { data, error } = await supabase
        .from('service_cost_structure')
        .insert({ ...input, tenant_id: tenantId })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-cost-items'] }),
  })
}

export function useRemoveCostItem() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('service_cost_structure')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-cost-items'] }),
  })
}

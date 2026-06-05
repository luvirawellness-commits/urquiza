import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'
import type { Supply, ServiceCostItem } from '@/types'

export function useSupplies() {
  return useQuery({
    queryKey: ['supplies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplies')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .order('name')
      if (error) throw error
      return data as Supply[]
    },
  })
}

export function useSellableSupplies() {
  return useQuery({
    queryKey: ['supplies', 'sellable'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplies')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .eq('is_sellable', true)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Supply[]
    },
  })
}

type SupplyInput = Omit<Supply, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>

export function useCreateSupply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SupplyInput) => {
      const { data, error } = await supabase
        .from('supplies')
        .insert({ ...input, tenant_id: TENANT_ID })
        .select()
        .single()
      if (error) throw error
      return data as Supply
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useUpdateSupply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: SupplyInput & { id: string }) => {
      const { data, error } = await supabase
        .from('supplies')
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
        .select()
        .single()
      if (error) throw error
      return data as Supply
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useDeleteSupply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('supplies')
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['supplies'] }),
  })
}

export function useAllServiceCostItems() {
  return useQuery({
    queryKey: ['service-cost-items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('service_cost_structure')
        .select('*, supply:supply_id ( id, name, code, unit, unit_price )')
        .eq('tenant_id', TENANT_ID)
      if (error) throw error
      return (data ?? []) as ServiceCostItem[]
    },
  })
}

type AddCostItemInput = {
  service_id: string
  duration_minutes: 60 | 90
  supply_id: string
  quantity: number
}

export function useAddCostItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: AddCostItemInput) => {
      const { data, error } = await supabase
        .from('service_cost_structure')
        .insert({ ...input, tenant_id: TENANT_ID })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-cost-items'] }),
  })
}

export function useRemoveCostItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('service_cost_structure')
        .delete()
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['service-cost-items'] }),
  })
}

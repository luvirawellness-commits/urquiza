import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'
import type { InventoryMovement, InventoryCount } from '@/types'

export function useInventoryMovements() {
  return useQuery({
    queryKey: ['inventory-movements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('*')
        .eq('tenant_id', TENANT_ID)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as InventoryMovement[]
    },
  })
}

export function useInventoryCounts() {
  return useQuery({
    queryKey: ['inventory-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .select('*, counted_by_user:counted_by ( full_name )')
        .eq('tenant_id', TENANT_ID)
        .order('counted_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as (InventoryCount & { counted_by_user?: { full_name: string } | null })[]
    },
  })
}

export function useCountItems(countId: string | null) {
  return useQuery({
    queryKey: ['inventory-count-items', countId],
    queryFn: async () => {
      if (!countId) return []
      const { data, error } = await supabase
        .from('inventory_count_items')
        .select('*, supply:supply_id ( id, name, code, unit )')
        .eq('count_id', countId)
      if (error) throw error
      return data ?? []
    },
    enabled: !!countId,
  })
}

export function useConfirmedCountsWithItems() {
  return useQuery({
    queryKey: ['inventory-counts', 'confirmed', 'items'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_counts')
        .select('id, counted_at, inventory_count_items ( supply_id, physical_qty, difference )')
        .eq('tenant_id', TENANT_ID)
        .eq('status', 'confirmed')
        .order('counted_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return data ?? []
    },
  })
}

type InsertMovementInput = {
  supply_id: string
  type: 'entry' | 'sale' | 'session' | 'adjustment' | 'loss'
  quantity: number
  unit_cost?: number
  reference_id?: string
  notes?: string
  counted_by?: string
}

export function useInsertMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InsertMovementInput) => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .insert({ ...input, tenant_id: TENANT_ID })
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-movements'] })
    },
  })
}

type CreateCountInput = {
  userId: string
  notes: string
  status: 'draft' | 'confirmed'
  rows: { supplyId: string; theoretical: number; physical: number }[]
}

export function useCreateCount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, notes, status, rows }: CreateCountInput) => {
      const { data: count, error: cErr } = await supabase
        .from('inventory_counts')
        .insert({ tenant_id: TENANT_ID, counted_by: userId, notes: notes || null, status })
        .select()
        .single()
      if (cErr) throw cErr

      const items = rows.map((r) => ({
        count_id: count.id,
        supply_id: r.supplyId,
        theoretical_qty: r.theoretical,
        physical_qty: r.physical,
      }))
      if (items.length > 0) {
        const { error: iErr } = await supabase.from('inventory_count_items').insert(items)
        if (iErr) throw iErr
      }

      if (status === 'confirmed') {
        const adjustments = rows
          .filter((r) => Math.abs(r.physical - r.theoretical) > 0.0001)
          .map((r) => ({
            tenant_id: TENANT_ID,
            supply_id: r.supplyId,
            type: 'adjustment' as const,
            quantity: r.physical - r.theoretical,
            reference_id: count.id,
            counted_by: userId,
            notes: 'Ajuste por conteo físico confirmado',
          }))
        if (adjustments.length > 0) {
          const { error: aErr } = await supabase.from('inventory_movements').insert(adjustments)
          if (aErr) throw aErr
        }
      }

      return count
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-counts'] })
      qc.invalidateQueries({ queryKey: ['inventory-movements'] })
    },
  })
}

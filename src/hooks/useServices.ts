import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ServiceRow = {
  id: string
  tenant_id: string
  name: string
  emoji: string | null
  description: string | null
  price_60: number | null
  price_90: number | null
  category: string | null
  requires_two_therapists: boolean
  available_in_memberships: boolean
  active: boolean
  sort_order: number | null
}

export type ServiceForm = {
  name: string
  emoji: string
  description: string
  price_60: string
  price_90: string
  category: string
  requires_two_therapists: boolean
  available_in_memberships: boolean
  active: boolean
}

export const EMPTY_SERVICE_FORM: ServiceForm = {
  name: '',
  emoji: '',
  description: '',
  price_60: '',
  price_90: '',
  category: 'standard',
  requires_two_therapists: false,
  available_in_memberships: true,
  active: true,
}

export function serviceRowToForm(s: ServiceRow): ServiceForm {
  return {
    name: s.name,
    emoji: s.emoji ?? '',
    description: s.description ?? '',
    price_60: s.price_60 != null ? String(s.price_60) : '',
    price_90: s.price_90 != null ? String(s.price_90) : '',
    category: s.category ?? 'standard',
    requires_two_therapists: s.requires_two_therapists,
    available_in_memberships: s.available_in_memberships,
    active: s.active,
  }
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAdminServices() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['admin-services', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name')
      if (error) throw error
      return (data ?? []) as ServiceRow[]
    },
    enabled: !!tenantId,
  })
}

export function useCreateService() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (form: ServiceForm) => {
      const { error } = await supabase.from('services').insert({
        tenant_id: tenantId,
        name: form.name.trim(),
        emoji: form.emoji.trim() || null,
        description: form.description.trim() || null,
        price_60: form.price_60 !== '' ? parseFloat(form.price_60) : 0,
        price_90: form.price_90 !== '' ? parseFloat(form.price_90) : null,
        category: form.category || null,
        requires_two_therapists: form.requires_two_therapists,
        available_in_memberships: form.available_in_memberships,
        active: form.active,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] })
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}

export function useUpdateService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, form }: { id: string; form: ServiceForm }) => {
      const { error } = await supabase.from('services').update({
        name: form.name.trim(),
        emoji: form.emoji.trim() || null,
        description: form.description.trim() || null,
        price_60: form.price_60 !== '' ? parseFloat(form.price_60) : 0,
        price_90: form.price_90 !== '' ? parseFloat(form.price_90) : null,
        category: form.category || null,
        requires_two_therapists: form.requires_two_therapists,
        available_in_memberships: form.available_in_memberships,
        active: form.active,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] })
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}

export function useDeleteService() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<'deleted' | 'deactivated'> => {
      const { count, error: checkError } = await supabase
        .from('appointments')
        .select('*', { count: 'exact', head: true })
        .eq('service_id', id)
      if (checkError) throw checkError

      if ((count ?? 0) > 0) {
        const { error } = await supabase.from('services').update({ active: false }).eq('id', id)
        if (error) throw error
        return 'deactivated'
      }

      const { error } = await supabase.from('services').delete().eq('id', id)
      if (error) throw error
      return 'deleted'
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-services'] })
      qc.invalidateQueries({ queryKey: ['services'] })
    },
  })
}

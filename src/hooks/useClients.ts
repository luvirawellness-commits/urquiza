import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { Client } from '@/types'

export function useClients(search?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['clients', tenantId, search],
    queryFn: async () => {
      let query = supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (search) {
        query = query.or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%`,
        )
      }

      const { data, error } = await query
      if (error) throw error
      return data as Client[]
    },
    enabled: !!tenantId,
  })
}

export function useClient(id: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['client', tenantId, id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single()
      if (error) throw error
      return data as Client
    },
    enabled: !!id && !!tenantId,
  })
}

type CreateClientInput = {
  first_name: string
  last_name?: string
  phone: string
  email?: string
  source?: Client['source']
  notes?: string
}

export function useCreateClient() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (client: CreateClientInput) => {
      const payload = {
        ...client,
        source: client.source ?? 'other',
        tenant_id: tenantId,
        status: 'active',
        wa_opt_in: true,
      }
      const { data, error } = await supabase
        .from('clients')
        .insert(payload)
        .select()
        .single()
      if (error) {
        console.error('Supabase insert error:', error)
        throw error
      }
      return data as Client
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })
}

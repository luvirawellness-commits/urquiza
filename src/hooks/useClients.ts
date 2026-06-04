import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'
import { Client } from '@/types'

export function useClients(search?: string) {
  return useQuery({
    queryKey: ['clients', search],
    queryFn: async () => {
      let query = supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', TENANT_ID)
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
  })
}

export function useClient(id: string) {
  return useQuery({
    queryKey: ['client', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
        .single()
      if (error) throw error
      return data as Client
    },
    enabled: !!id,
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (client: CreateClientInput) => {
      const payload = {
        ...client,
        source: client.source ?? 'other',
        tenant_id: TENANT_ID,
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

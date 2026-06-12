import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Client } from '@/types'

export function useClients(search?: string, includeInactive = false) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['clients', tenantId, search, includeInactive],
    queryFn: async () => {
      let query = supabase
        .from('clients')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })

      if (!includeInactive) {
        query = query.neq('status', 'inactive')
      }

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

function isDuplicatePhone(error: { code?: string; message?: string }) {
  return (
    error.code === '23505' ||
    error.message?.toLowerCase().includes('duplicate') ||
    error.message?.toLowerCase().includes('unique')
  )
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
  const { logAction } = useAuditLog()
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
        if (isDuplicatePhone(error)) {
          throw new Error('Ya existe un cliente registrado con este número de teléfono.')
        }
        throw error
      }
      return data as Client
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      logAction({
        action: 'CREATE',
        module: 'clientes',
        entityType: 'client',
        entityId: data.id,
        entityName: [data.first_name, data.last_name].filter(Boolean).join(' '),
      })
    },
  })
}

type UpdateClientInput = {
  id: string
  first_name: string
  phone: string
  last_name?: string | null
  email?: string | null
  birthdate?: string | null
  source?: Client['source'] | null
  notes?: string | null
}

export function useUpdateClient() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...fields }: UpdateClientInput) => {
      const { data, error } = await supabase
        .from('clients')
        .update(fields)
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .select()
        .single()
      if (error) {
        if (isDuplicatePhone(error)) {
          throw new Error('Ya existe un cliente registrado con este número de teléfono.')
        }
        throw error
      }
      return data as Client
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['client', tenantId, data.id] })
    },
  })
}

export function useDeactivateClient() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'inactive' })
        .eq('id', clientId)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })
}

export function useReactivateClient() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from('clients')
        .update({ status: 'active' })
        .eq('id', clientId)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  })
}

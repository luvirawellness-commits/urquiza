import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId, useAuth } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import { Appointment, AppointmentStatus, Service } from '@/types'

export function useAppointments(startDate?: string, endDate?: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['appointments', tenantId, startDate, endDate],
    queryFn: async () => {
      let query = supabase
        .from('appointments')
        .select(`
          *,
          therapist:users!fk_apt_therapist (
            id, full_name, color_hex, avatar_url
          ),
          client:clients!fk_apt_client (
            id, first_name, last_name, phone, status, total_sessions
          ),
          service:services!fk_apt_service (
            id, name, emoji, price_60, price_90
          )
        `)
        .eq('tenant_id', tenantId)
        .order('scheduled_at')

      if (startDate) query = query.gte('scheduled_at', startDate)
      if (endDate) query = query.lte('scheduled_at', endDate)

      const { data, error } = await query
      if (error) {
        console.error('useAppointments error:', error)
        throw error
      }
      return data as Appointment[]
    },
    enabled: !!tenantId,
  })
}

export function useServices() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['services', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('id, name, emoji, price_60, price_90')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Pick<Service, 'id' | 'name' | 'emoji' | 'price_60' | 'price_90'>[]
    },
    enabled: !!tenantId,
  })
}

export type Therapist = {
  id: string
  full_name: string
  color_hex?: string | null
  schedule?: Record<string, { start: string; end: string }[]> | null
}

export function useTherapists() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['therapists', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, color_hex, schedule')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .in('role', ['therapist', 'partner_admin'])
        .order('full_name')
      if (error) throw error
      return data as Therapist[]
    },
    enabled: !!tenantId,
  })
}

type CreateAppointmentInput = {
  client_id?: string | null
  service_id?: string | null
  therapist_id: string
  scheduled_at: string
  duration_minutes: number
  box_number?: number
  status: AppointmentStatus
  source: string
  price_charged?: number
  deposit_amount?: number
  deposit_paid?: boolean
  notes?: string
}

export function useCreateAppointment() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { logAction } = useAuditLog()
  return useMutation({
    mutationFn: async (appt: CreateAppointmentInput) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({ ...appt, tenant_id: tenantId })
        .select('*, client:clients!fk_apt_client(first_name, last_name)')
        .single()
      if (error) {
        console.error('useCreateAppointment error:', error)
        throw error
      }
      return data as Appointment
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      const clientName = data.client
        ? [data.client.first_name, data.client.last_name].filter(Boolean).join(' ')
        : ''
      logAction({
        action: 'CREATE',
        module: 'agenda',
        entityType: 'appointment',
        entityId: data.id,
        entityName: clientName ? `${clientName} - ${data.scheduled_at}` : data.scheduled_at,
      })
    },
  })
}

type UpdateAppointmentInput = {
  id: string
  service_id: string
  therapist_id: string
  scheduled_at: string
  duration_minutes: number
  box_number: number
  price_charged?: number | null
}

export function useUpdateAppointment() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { logAction } = useAuditLog()
  return useMutation({
    mutationFn: async ({ id, ...patch }: UpdateAppointmentInput) => {
      const { error } = await supabase
        .from('appointments')
        .update(patch)
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      logAction({
        action: 'UPDATE',
        module: 'agenda',
        entityType: 'appointment',
        entityId: variables.id,
        entityName: 'Turno editado',
        newValue: { scheduled_at: variables.scheduled_at },
      })
    },
  })
}

export function useUpdateServicePrice() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, field, price }: { id: string; field: 'price_60' | 'price_90'; price: number }) => {
      const { error } = await supabase
        .from('services')
        .update({ [field]: price })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
  })
}

export function useUpdateAppointmentStatus() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { logAction } = useAuditLog()
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ id, status, client_membership_id }: { id: string; status: AppointmentStatus; client_membership_id?: string }) => {
      const isCancellation = status === 'cancelled' || status === 'no_show'
      const patch: Record<string, unknown> = {
        status,
        ...(isCancellation && {
          cancelled_at: new Date().toISOString(),
          cancelled_by: user?.id ?? null,
        }),
        ...(client_membership_id != null && { client_membership_id }),
      }
      const { error } = await supabase
        .from('appointments')
        .update(patch)
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      if (variables.status === 'completed') {
        qc.invalidateQueries({ queryKey: ['active-membership'] })
        qc.invalidateQueries({ queryKey: ['client-active-memberships'] })
        logAction({
          action: 'UPDATE',
          module: 'agenda',
          entityType: 'appointment',
          entityId: variables.id,
          entityName: 'Sesión completada',
          oldValue: { status: 'pending' },
          newValue: { status: 'completed' },
        })
      }
    },
  })
}

export interface ActiveMembership {
  id: string
  plan?: { id: string; name: string } | null
  sessions_total?: number
  sessions_used?: number
  expires_at?: string
}

export function useActiveClientMembership(clientId: string | null) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['active-membership', tenantId, clientId],
    queryFn: async () => {
      if (!clientId) return null
      const { data } = await supabase
        .from('client_memberships')
        .select('id, plan:memberships(id, name), sessions_total, sessions_used, expires_at')
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .maybeSingle()
      return data as ActiveMembership | null
    },
    enabled: !!clientId && !!tenantId,
    retry: 0,
    throwOnError: false,
  })
}

export function useUseMembershipSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membershipId, appointmentId }: { membershipId: string; appointmentId: string }) => {
      const { data, error: fetchErr } = await supabase
        .from('client_memberships')
        .select('sessions_used, plan:memberships!fk_cm_membership_id(sessions_qty)')
        .eq('id', membershipId)
        .single()
      if (fetchErr) throw fetchErr

      const newSessionsUsed = (data.sessions_used ?? 0) + 1
      const sessionsQty = (data.plan as unknown as { sessions_qty: number } | null)?.sessions_qty ?? 0

      const updatePayload: Record<string, unknown> = { sessions_used: newSessionsUsed }
      if (sessionsQty > 0 && newSessionsUsed >= sessionsQty) {
        updatePayload.status = 'expired'
      }

      const { error: cmErr } = await supabase
        .from('client_memberships')
        .update(updatePayload)
        .eq('id', membershipId)
      if (cmErr) throw cmErr

      const { error: apptErr } = await supabase
        .from('appointments')
        .update({ client_membership_id: membershipId })
        .eq('id', appointmentId)
      if (apptErr) throw apptErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['active-membership'] })
      qc.invalidateQueries({ queryKey: ['client-active-memberships'] })
    },
  })
}

export function useUpdateClientAfterSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (clientId: string) => {
      const { data, error: fetchErr } = await supabase
        .from('clients')
        .select('total_sessions')
        .eq('id', clientId)
        .single()
      if (fetchErr) throw fetchErr
      const { error } = await supabase
        .from('clients')
        .update({
          last_visit_at: new Date().toISOString(),
          total_sessions: (data.total_sessions ?? 0) + 1,
        })
        .eq('id', clientId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
    },
  })
}

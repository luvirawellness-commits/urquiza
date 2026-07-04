import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId, useAuth } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import { getArgentinaDateString } from '@/utils/dateUtils'
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

type RegisterDepositInput = {
  appointmentId: string
  amount: number
  paymentMethod: string
  clientName: string
  serviceName: string
}

export function useRegisterDeposit() {
  const tenantId = useTenantId()
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ appointmentId, amount, paymentMethod, clientName, serviceName }: RegisterDepositInput) => {
      const { error } = await supabase.from('transactions').insert({
        tenant_id: tenantId,
        type: 'income',
        category: 'session',
        amount,
        payment_method: paymentMethod,
        description: `Seña: ${clientName} - ${serviceName}`,
        date: getArgentinaDateString(),
        user_id: user?.id,
        status: 'paid',
        appointment_id: appointmentId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function useDepositTransaction(appointmentId: string | null) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['deposit-transaction', tenantId, appointmentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('payment_method')
        .eq('tenant_id', tenantId)
        .eq('appointment_id', appointmentId as string)
        .ilike('description', 'Seña:%')
        .maybeSingle()
      if (error) throw error
      return data as { payment_method: string | null } | null
    },
    enabled: !!tenantId && !!appointmentId,
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
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membershipId, appointmentId }: { membershipId: string; appointmentId: string }) => {
      const { error } = await supabase.rpc('increment_membership_session', {
        p_membership_id: membershipId,
        p_tenant_id: tenantId,
      })
      if (error) throw new Error('Esta membresía no tiene sesiones disponibles o está vencida')

      const { error: apptErr } = await supabase
        .from('appointments')
        .update({ client_membership_id: membershipId })
        .eq('id', appointmentId)
        .eq('tenant_id', tenantId)
      if (apptErr) throw apptErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_memberships'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export type ClientAppointmentRow = {
  id: string
  scheduled_at: string
  status: string
  duration_minutes: number
  price_charged: number | null
  service: { name: string; emoji?: string | null } | null
  therapist: { full_name: string } | null
}

export function useClientAppointments(clientId: string) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['client-appointments', tenantId, clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_at, status, duration_minutes, price_charged,
          service:services!fk_apt_service(name, emoji),
          therapist:users!fk_apt_therapist(full_name)
        `)
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
        .order('scheduled_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as unknown as ClientAppointmentRow[]
    },
    enabled: !!clientId && !!tenantId,
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

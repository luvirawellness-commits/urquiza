import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, TENANT_ID } from '@/lib/supabase'
import { Appointment, AppointmentStatus, Service } from '@/types'

export function useAppointments(startDate?: string, endDate?: string) {
  return useQuery({
    queryKey: ['appointments', startDate, endDate],
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
        .eq('tenant_id', TENANT_ID)
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
  })
}

export function useServices() {
  return useQuery({
    queryKey: ['services'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('services')
        .select('id, name, emoji, price_60, price_90')
        .eq('tenant_id', TENANT_ID)
        .eq('active', true)
        .order('name')
      if (error) throw error
      return data as Pick<Service, 'id' | 'name' | 'emoji' | 'price_60' | 'price_90'>[]
    },
  })
}

export type Therapist = {
  id: string
  full_name: string
  color_hex?: string | null
  schedule?: Record<string, { start: string; end: string }[]> | null
}

export function useTherapists() {
  return useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, color_hex, schedule')
        .eq('tenant_id', TENANT_ID)
        .eq('active', true)
        .in('role', ['therapist', 'partner_admin'])
        .order('full_name')
      if (error) throw error
      return data as Therapist[]
    },
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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (appt: CreateAppointmentInput) => {
      const { data, error } = await supabase
        .from('appointments')
        .insert({ ...appt, tenant_id: TENANT_ID })
        .select()
        .single()
      if (error) {
        console.error('useCreateAppointment error:', error)
        throw error
      }
      return data as Appointment
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  })
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: AppointmentStatus }) => {
      const { error } = await supabase
        .from('appointments')
        .update({ status })
        .eq('id', id)
        .eq('tenant_id', TENANT_ID)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
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
  return useQuery({
    queryKey: ['active-membership', clientId],
    queryFn: async () => {
      if (!clientId) return null
      const { data } = await supabase
        .from('client_memberships')
        .select('id, plan:memberships(id, name), sessions_total, sessions_used, expires_at')
        .eq('client_id', clientId)
        .eq('tenant_id', TENANT_ID)
        .eq('status', 'active')
        .maybeSingle()
      return data as ActiveMembership | null
    },
    enabled: !!clientId,
    retry: 0,
    throwOnError: false,
  })
}

export function useUseMembershipSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membershipId, appointmentId }: { membershipId: string; appointmentId: string }) => {
      // Fetch current usage + plan total to determine if membership becomes exhausted
      const { data, error: fetchErr } = await supabase
        .from('client_memberships')
        .select('sessions_used, plan:memberships!fk_cm_membership_id(sessions_qty)')
        .eq('id', membershipId)
        .single()
      if (fetchErr) throw fetchErr

      const newSessionsUsed = (data.sessions_used ?? 0) + 1
      const sessionsQty = (data.plan as { sessions_qty: number } | null)?.sessions_qty ?? 0

      const updatePayload: Record<string, unknown> = { sessions_used: newSessionsUsed }
      if (sessionsQty > 0 && newSessionsUsed >= sessionsQty) {
        updatePayload.status = 'expired'
      }

      const { error: cmErr } = await supabase
        .from('client_memberships')
        .update(updatePayload)
        .eq('id', membershipId)
      if (cmErr) throw cmErr

      // Link appointment to this membership BEFORE status is set to completed,
      // so the DB trigger can detect client_membership_id IS NOT NULL and skip
      // creating a duplicate income transaction.
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

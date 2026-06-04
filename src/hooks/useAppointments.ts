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

export type Therapist = { id: string; full_name: string; color_hex?: string }

export function useTherapists() {
  return useQuery({
    queryKey: ['therapists'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, color_hex')
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
  client_id: string
  service_id: string
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

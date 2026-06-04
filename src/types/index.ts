export type UserRole = 'owner' | 'partner_admin' | 'therapist' | 'receptionist'

export interface UserProfile {
  id: string
  tenant_id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url?: string
  created_at: string
}

export interface Client {
  id: string
  tenant_id: string
  first_name: string
  last_name?: string
  full_name?: string
  email?: string
  phone?: string
  notes?: string
  status: 'active' | 'at_risk' | 'inactive'
  last_visit_at?: string
  total_sessions?: number
  source?: 'instagram' | 'google' | 'referral' | 'whatsapp' | 'in_person' | 'other'
  wa_opt_in?: boolean
  created_at: string
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

export interface Appointment {
  id: string
  tenant_id: string
  client_id: string
  therapist_id: string
  service_id: string
  scheduled_at: string
  duration_minutes: number
  box_number?: number
  status: AppointmentStatus
  source?: string
  price_charged?: number
  deposit_amount?: number
  deposit_paid?: boolean
  notes?: string
  client?: { id: string; first_name: string; last_name?: string; phone?: string; status?: string; total_sessions?: number } | null
  therapist?: { id: string; full_name: string; color_hex?: string; avatar_url?: string } | null
  service?: { id: string; name: string; emoji?: string; price_60?: number; price_90?: number } | null
}

export interface Service {
  id: string
  tenant_id: string
  name: string
  emoji?: string
  duration_minutes?: number
  price_60?: number
  price_90?: number
  description?: string
  active?: boolean
}

export interface Transaction {
  id: string
  tenant_id: string
  type: 'income' | 'expense'
  category: string
  amount: number
  description: string
  date: string
  created_by: string
}

export interface DashboardMetrics {
  totalClients: number
  appointmentsToday: number
  revenueThisMonth: number
  appointmentsThisWeek: number
}

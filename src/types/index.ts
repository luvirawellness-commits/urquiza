export type UserRole = 'owner' | 'partner_admin' | 'therapist' | 'receptionist' | 'super_admin'

export interface Tenant {
  id: string
  name: string
  slug: string
  address?: string
  phone?: string
  whatsapp?: string
  breakeven?: number
  royalty_pct?: number
  active: boolean
  created_at: string
  trial_ends_at?: string | null
  last_plan?: string | null
  show_billing_banner?: boolean | null
  caja_fondo_fijo?: number | null
}

export interface UserTenant {
  id: string
  user_id: string
  tenant_id: string
  role: UserRole
  active: boolean
  created_at: string
  tenant?: Tenant
}

export interface UserProfile {
  id: string
  tenant_id: string
  default_tenant_id?: string
  email: string
  full_name: string
  role: UserRole
  color_hex?: string
  avatar_url?: string
  active?: boolean
  created_at: string
  terms_accepted_at?: string | null
  terms_version?: string | null
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
  birthdate?: string | null
  created_at: string
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show' | 'blocked'

export interface Appointment {
  id: string
  tenant_id: string
  client_id?: string | null
  therapist_id: string
  service_id?: string | null
  scheduled_at: string
  duration_minutes: number
  box_number?: number
  status: AppointmentStatus
  source?: string
  price_charged?: number
  deposit_amount?: number
  deposit_paid?: boolean
  notes?: string
  client_membership_id?: string | null
  cancelled_at?: string | null
  cancelled_by?: string | null
  cancellation_reason?: string | null
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
  user_id: string
  payment_method?: string
  status?: string
  created_at?: string
  appointment_id?: string
}

export interface DashboardMetrics {
  totalClients: number
  appointmentsToday: number
  revenueThisMonth: number
  appointmentsThisWeek: number
}

export interface Supply {
  id: string
  tenant_id: string
  code: string
  name: string
  brand?: string
  supplier?: string
  unit: string
  unit_price: number
  is_sellable: boolean
  sale_price?: number
  category: 'internal' | 'product'
  active: boolean
  notes?: string
  created_at: string
  updated_at: string
}

export interface ServiceCostItem {
  id: string
  tenant_id: string
  service_id: string
  duration_minutes: 60 | 90
  supply_id: string
  quantity: number
  created_at: string
  supply?: { id: string; name: string; code: string; unit: string; unit_price: number } | null
}

export interface MembershipPlan {
  id: string
  tenant_id: string
  name: string
  price: number
  sessions_qty: number
  validity_days: number
  highlight_badge?: string | null
  allowed_service_ids?: string[] | null
  active: boolean
}

export interface ClientMembership {
  id: string
  tenant_id: string
  client_id: string
  membership_id?: string | null
  plan?: {
    id: string
    name: string
    sessions_qty?: number | null
    validity_days?: number | null
    price?: number | null
    highlight_badge?: string | null
    allowed_service_ids?: string[] | null
  } | null
  sessions_total?: number | null
  sessions_used?: number | null
  expires_at?: string | null
  purchased_at?: string | null
  status: 'active' | 'expired' | 'cancelled'
  payment_method?: string | null
  amount_paid?: number | null
  sold_by?: string | null
  beneficiaries?: {
    id?: string
    client_id: string
    added_at?: string
    client?: { id?: string; first_name: string; last_name?: string | null; phone?: string | null } | null
  }[] | null
}

export interface MembershipBeneficiary {
  id: string
  tenant_id: string
  client_membership_id: string
  client_id: string
  added_by?: string | null
  added_at: string
  client?: { id: string; first_name: string; last_name?: string | null } | null
}

export interface InventoryMovement {
  id: string
  tenant_id: string
  supply_id: string
  type: 'entry' | 'sale' | 'session' | 'adjustment' | 'loss'
  quantity: number
  unit_cost?: number
  reference_id?: string
  notes?: string
  counted_by?: string
  created_at: string
}

export interface InventoryCount {
  id: string
  tenant_id: string
  counted_at: string
  counted_by: string
  notes?: string
  status: 'draft' | 'confirmed'
  created_at: string
}

export interface InventoryCountItem {
  id: string
  count_id: string
  supply_id: string
  theoretical_qty: number
  physical_qty: number
  difference: number
  notes?: string
  supply?: { id: string; name: string; code: string; unit: string } | null
}

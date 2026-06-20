import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import type { ClientMembership, MembershipPlan } from '@/types'
import { getArgentinaDateString } from '../utils/dateUtils'

export function useUpdateMembershipPrice() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, price }: { id: string; price: number }) => {
      const { error } = await supabase
        .from('memberships')
        .update({ price })
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['membership-plans'] }),
  })
}

export function useMembershipPlans() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['membership-plans', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('id, name, price, sessions_qty, validity_days, highlight_badge, allowed_service_ids')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .order('price')
      if (error) throw error
      return (data ?? []) as MembershipPlan[]
    },
    enabled: !!tenantId,
  })
}

const MEMBERSHIP_SELECT = `
  *,
  plan:memberships!fk_cm_membership_id(
    id,
    name,
    sessions_qty,
    validity_days,
    price,
    highlight_badge,
    allowed_service_ids
  ),
  beneficiaries:membership_beneficiaries(
    id,
    client_id,
    added_at,
    client:clients(
      id,
      first_name,
      last_name,
      phone
    )
  )
`

export function useClientActiveMemberships(clientId: string | null) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['client-active-memberships', tenantId, clientId],
    queryFn: async () => {
      if (!clientId) return [] as ClientMembership[]
      const today = getArgentinaDateString()

      const { data: direct, error: e1 } = await supabase
        .from('client_memberships')
        .select(MEMBERSHIP_SELECT)
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
        .eq('status', 'active')
        .gte('expires_at', today)
      if (e1) { console.log('[useClientActiveMemberships] direct query error:', e1); throw e1 }

      const { data: benRows, error: e2 } = await supabase
        .from('membership_beneficiaries')
        .select('client_membership_id')
        .eq('tenant_id', tenantId)
        .eq('client_id', clientId)
      if (e2) { console.log('[useClientActiveMemberships] beneficiaries lookup error:', e2); throw e2 }

      const directIds = new Set((direct ?? []).map((m) => m.id as string))
      const membershipIds = (benRows ?? [])
        .map((b) => b.client_membership_id as string)
        .filter((id) => !directIds.has(id))

      let indirect: ClientMembership[] = []
      if (membershipIds.length > 0) {
        const { data: ind, error: e3 } = await supabase
          .from('client_memberships')
          .select(MEMBERSHIP_SELECT)
          .in('id', membershipIds)
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .gte('expires_at', today)
        if (e3) { console.log('[useClientActiveMemberships] indirect query error:', e3); throw e3 }
        indirect = (ind ?? []) as ClientMembership[]
      }

      const seen = new Set<string>()
      const all: ClientMembership[] = []
      for (const m of [...(direct ?? []), ...indirect]) {
        if (seen.has(m.id)) continue
        seen.add(m.id)
        const sessionsQty = m.plan?.sessions_qty ?? 0
        const sessionsUsed = m.sessions_used ?? 0
        if (sessionsQty - sessionsUsed > 0) all.push(m as ClientMembership)
      }

      return all
    },
    enabled: !!clientId && !!tenantId,
    retry: 0,
    throwOnError: false,
  })
}

type SellMembershipInput = {
  clientId: string
  planId: string
  planName: string
  sessionsTotal: number
  validityDays: number
  beneficiaryIds: string[]
  amount: number
  paymentMethod: string
  startDate: string
  soldBy: string
  preSelectedAppointmentId?: string
  clientName?: string
}

export function useSellMembership() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { logAction } = useAuditLog()
  return useMutation({
    mutationFn: async (input: SellMembershipInput) => {
      const d = new Date(input.startDate + 'T00:00:00')
      d.setDate(d.getDate() + input.validityDays)
      const expiresAt = getArgentinaDateString(d)
      const extraBenIds = (input.beneficiaryIds ?? []).filter((id) => id !== input.clientId)
      const { data, error } = await supabase.rpc('sell_membership', {
        p_tenant_id:       tenantId,
        p_client_id:       input.clientId,
        p_membership_id:   input.planId,
        p_plan_name:       input.planName,
        p_amount_paid:     input.amount,
        p_payment_method:  input.paymentMethod,
        p_sold_by:         input.soldBy,
        p_date:            input.startDate,
        p_expires_at:      expiresAt,
        p_beneficiary_ids: [input.clientId, ...extraBenIds],
        p_appointment_id:  input.preSelectedAppointmentId ?? null,
      })
      if (error) throw error
      return (data as { id: string }).id
    },
    onSuccess: (membershipId, variables) => {
      qc.invalidateQueries({ queryKey: ['client-memberships', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['client-active-memberships', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['active-membership'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
      logAction({
        action: 'CREATE',
        module: 'membresias',
        entityType: 'membership',
        entityId: membershipId,
        entityName: `Membresía ${variables.planName}${variables.clientName ? ' - ' + variables.clientName : ''}`,
      })
    },
  })
}

export function useAddBeneficiary() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      membershipId,
      clientId,
      addedBy,
    }: {
      membershipId: string
      clientId: string
      addedBy: string
    }) => {
      const { error } = await supabase
        .from('membership_beneficiaries')
        .insert({
          tenant_id: tenantId,
          client_membership_id: membershipId,
          client_id: clientId,
          added_by: addedBy,
        })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-active-memberships'] })
    },
  })
}

// ── Tenant-wide membership views ─────────────────────────────────────────────

export type MembershipSession = {
  id: string
  scheduled_at: string
  client: { id: string; first_name: string; last_name?: string | null } | null
  service: { id: string; name: string; emoji?: string | null } | null
  therapist: { id: string; full_name: string } | null
}

export type TenantMembershipRow = {
  id: string
  tenant_id: string
  client_id: string
  membership_id: string | null
  sessions_used: number
  status: 'active' | 'expired' | 'cancelled'
  expires_at: string | null
  purchased_at: string | null
  amount_paid: number | null
  payment_method: string | null
  client: { id: string; first_name: string; last_name?: string | null } | null
  plan: {
    id: string
    name: string
    sessions_qty: number | null
    price: number | null
    highlight_badge?: string | null
  } | null
  beneficiaries: {
    id: string
    client_id: string
    client: { id: string; first_name: string; last_name?: string | null } | null
  }[]
}

const TENANT_MEMBERSHIP_SELECT = `
  id, tenant_id, client_id, membership_id, sessions_used,
  status, expires_at, purchased_at, amount_paid, payment_method,
  client:clients(id, first_name, last_name),
  plan:memberships!fk_cm_membership_id(id, name, sessions_qty, price, highlight_badge),
  beneficiaries:membership_beneficiaries(
    id, client_id,
    client:clients(id, first_name, last_name)
  )
`

export function useTenantActiveMemberships() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['tenant-active-memberships', tenantId],
    queryFn: async () => {
      const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'America/Argentina/Buenos_Aires',
      })
      const { data, error } = await supabase
        .from('client_memberships')
        .select(TENANT_MEMBERSHIP_SELECT)
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .or(`expires_at.is.null,expires_at.gte.${today}`)
        .order('expires_at', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (data ?? []) as unknown as TenantMembershipRow[]
    },
    enabled: !!tenantId,
  })
}

export function useTenantExpiredMemberships() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['tenant-expired-memberships', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_memberships')
        .select(TENANT_MEMBERSHIP_SELECT)
        .eq('tenant_id', tenantId)
        .in('status', ['expired', 'cancelled'])
        .order('expires_at', { ascending: false, nullsFirst: true })
      if (error) throw error
      return (data ?? []) as unknown as TenantMembershipRow[]
    },
    enabled: !!tenantId,
  })
}

export function useMembershipSessions(membershipId: string | null) {
  return useQuery({
    queryKey: ['membership-sessions', membershipId],
    queryFn: async () => {
      if (!membershipId) return [] as MembershipSession[]
      const { data, error } = await supabase
        .from('appointments')
        .select(`
          id, scheduled_at,
          client:clients!fk_apt_client(id, first_name, last_name),
          service:services!fk_apt_service(id, name, emoji),
          therapist:users!fk_apt_therapist(id, full_name)
        `)
        .eq('client_membership_id', membershipId)
        .eq('status', 'completed')
        .order('scheduled_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as MembershipSession[]
    },
    enabled: !!membershipId,
  })
}

export function useRemoveBeneficiary() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      membershipId,
      clientId,
    }: {
      membershipId: string
      clientId: string
    }) => {
      const { error } = await supabase
        .from('membership_beneficiaries')
        .delete()
        .eq('client_membership_id', membershipId)
        .eq('client_id', clientId)
        .eq('tenant_id', tenantId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client-active-memberships'] })
    },
  })
}

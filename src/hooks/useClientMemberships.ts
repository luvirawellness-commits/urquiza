import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import type { ClientMembership, MembershipPlan } from '@/types'

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
        .select('id, name, price, sessions_qty, validity_days, highlight_badge')
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
    highlight_badge
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
      const today = new Date().toISOString().split('T')[0]

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
}

export function useSellMembership() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SellMembershipInput) => {
      const d = new Date(input.startDate + 'T00:00:00')
      d.setDate(d.getDate() + input.validityDays)
      const expiresAt = d.toISOString().split('T')[0]
      const sessionsUsed = input.preSelectedAppointmentId ? 1 : 0

      const { data: cm, error: cmErr } = await supabase
        .from('client_memberships')
        .insert({
          tenant_id: tenantId,
          client_id: input.clientId,
          membership_id: input.planId,
          sessions_used: sessionsUsed,
          status: 'active',
          purchased_at: new Date().toISOString(),
          expires_at: expiresAt,
          payment_method: input.paymentMethod,
          amount_paid: input.amount,
          sold_by: input.soldBy,
        })
        .select()
        .single()
      if (cmErr) { console.log('[useSellMembership] insert error:', cmErr); throw cmErr }

      const membershipId: string = cm.id

      const { error: titularErr } = await supabase
        .from('membership_beneficiaries')
        .insert({
          tenant_id: tenantId,
          client_membership_id: membershipId,
          client_id: input.clientId,
          added_by: input.soldBy,
        })
      if (titularErr) { console.log('[useSellMembership] titular beneficiary insert error:', titularErr); throw titularErr }

      const extraBenIds = (input.beneficiaryIds ?? []).filter((id) => id !== input.clientId)
      if (extraBenIds.length > 0) {
        const { error: benErr } = await supabase
          .from('membership_beneficiaries')
          .insert(
            extraBenIds.map((cid) => ({
              tenant_id: tenantId,
              client_membership_id: membershipId,
              client_id: cid,
              added_by: input.soldBy,
            })),
          )
        if (benErr) { console.log('[useSellMembership] extra beneficiaries insert error:', benErr); throw benErr }
      }

      const { error: txErr } = await supabase
        .from('transactions')
        .insert({
          tenant_id: tenantId,
          type: 'income',
          category: 'membership',
          amount: input.amount,
          payment_method: input.paymentMethod,
          description: `Membresía ${input.planName}`,
          date: input.startDate,
          user_id: input.soldBy,
          status: 'paid',
          is_recurring: false,
        })
      if (txErr) throw txErr

      if (input.preSelectedAppointmentId) {
        const { error: apptErr } = await supabase
          .from('appointments')
          .update({ client_membership_id: membershipId })
          .eq('id', input.preSelectedAppointmentId)
        if (apptErr) throw apptErr
      }

      return membershipId
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['client-memberships', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['client-active-memberships', variables.clientId] })
      qc.invalidateQueries({ queryKey: ['active-membership'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
      qc.invalidateQueries({ queryKey: ['dashboard-metrics'] })
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

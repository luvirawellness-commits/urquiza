import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { getArgentinaDateString } from '../utils/dateUtils'

export interface GiftCard {
  id: string
  tenant_id: string
  code: string
  service_id: string
  duration_minutes: 60 | 90
  amount: number
  status: 'active' | 'used' | 'expired'
  sold_by?: string | null
  sold_at: string
  used_by_client_id?: string | null
  used_at?: string | null
  used_in_appointment_id?: string | null
  expires_at?: string | null
  notes?: string | null
  recipient_name?: string | null
  sender_name?: string | null
  message?: string | null
  created_at: string
  service?: { id: string; name: string; emoji?: string } | null
  used_by?: { id: string; first_name: string; last_name?: string } | null
}


export function useGiftCards() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['gift_cards', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gift_cards')
        .select(`
          *,
          service:service_id ( id, name, emoji ),
          used_by:used_by_client_id ( id, first_name, last_name )
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as GiftCard[]
    },
    enabled: !!tenantId,
  })
}

type CreateGiftCardInput = {
  service_id: string
  service_name: string
  duration_minutes: 60 | 90
  amount: number
  payment_method: string
  sold_by: string
  expires_at: string
  notes: string
  user_id: string
  recipient_name?: string
  sender_name?: string
  message?: string
}

export function useCreateGiftCard() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateGiftCardInput) => {
      const { data, error } = await supabase.rpc('create_gift_card', {
        p_tenant_id:        tenantId,
        p_service_id:       input.service_id,
        p_duration_minutes: input.duration_minutes,
        p_amount:           input.amount,
        p_payment_method:   input.payment_method,
        p_sold_by:          input.sold_by || null,
        p_user_id:          input.user_id,
        p_date:             getArgentinaDateString(),
        p_expires_at:       input.expires_at || null,
        p_notes:            input.notes || null,
        p_recipient_name:   input.recipient_name || null,
        p_sender_name:      input.sender_name || null,
        p_message:          input.message || null,
      })
      if (error) throw error
      return data as { id: string; code: string }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gift_cards'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['today-metrics'] })
    },
  })
}

export interface ValidatedGiftCard {
  id: string
  amount: number
  expires_at?: string | null
}

export function useValidateGiftCard() {
  const tenantId = useTenantId()
  return useMutation({
    mutationFn: async ({
      code, serviceId, durationMinutes,
    }: { code: string; serviceId: string; durationMinutes: number }) => {
      const { data, error } = await supabase
        .from('gift_cards')
        .select('id, status, service_id, duration_minutes, amount, expires_at')
        .eq('code', code.toUpperCase().trim())
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (error) throw new Error('Error al buscar el código')
      if (!data) throw new Error('Código no encontrado')
      if (data.status === 'used') throw new Error('Esta gift card ya fue utilizada')
      if (data.status === 'expired') throw new Error('Esta gift card está vencida')
      if (data.status !== 'active') throw new Error('Esta gift card no está activa')
      if (data.service_id !== serviceId)
        throw new Error('Esta gift card no corresponde al servicio de la sesión')
      if (data.duration_minutes !== durationMinutes)
        throw new Error('Esta gift card no corresponde a la duración de la sesión')
      if (data.expires_at && new Date(data.expires_at) < new Date())
        throw new Error('Esta gift card está vencida')

      return data as ValidatedGiftCard & { service_id: string; duration_minutes: number; status: string }
    },
  })
}

export function useRedeemGiftCard() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      giftCardId, clientId, appointmentId,
    }: { giftCardId: string; clientId: string; appointmentId: string }) => {
      const { error } = await supabase.rpc('redeem_gift_card', {
        p_gift_card_id: giftCardId,
        p_tenant_id: tenantId,
      })
      if (error) throw new Error('Esta gift card ya fue utilizada o no está activa')

      // Status is now atomically 'used'; record client/appointment linkage
      await supabase
        .from('gift_cards')
        .update({
          used_at: new Date().toISOString(),
          used_by_client_id: clientId,
          used_in_appointment_id: appointmentId,
        })
        .eq('id', giftCardId)
        .eq('tenant_id', tenantId)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gift_cards'] }),
  })
}

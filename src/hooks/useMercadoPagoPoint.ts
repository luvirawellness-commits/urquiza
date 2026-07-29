import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Stage C.2: order creation + polling only — no webhook confirmation yet
// (that's C.3). Kept as a shared hook/helper module (not inlined in
// Agenda.tsx) since checkout flows beyond session-closing will eventually
// need the same device lookup + order lifecycle calls.

export type PointDevice = {
  id: string
  terminal_id: string
  label: string | null
}

// Only active devices — an inactive one (toggled off in Configuración)
// must never be offered as a charge target here.
export function useActivePointDevices(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ['point-devices-active', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenant_point_devices')
        .select('id, terminal_id, label')
        .eq('tenant_id', tenantId as string)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data as PointDevice[]
    },
    enabled: !!tenantId,
  })
}

export type PointOrderResult = {
  order_id: string
  status: string
  status_detail?: string | null
}

type CallerAuth = { tenantId: string; userId: string; accessToken: string }

export async function createPointOrder(auth: CallerAuth & {
  amount: number
  description: string
  externalReference: string
  terminalId: string
}): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-create-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      amount: auth.amount,
      description: auth.description,
      external_reference: auth.externalReference,
      terminal_id: auth.terminalId,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al iniciar el cobro con Point')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

export async function checkPointOrder(auth: CallerAuth & { orderId: string }): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-check-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      order_id: auth.orderId,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al consultar el cobro')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

export async function cancelPointOrder(auth: CallerAuth & { orderId: string }): Promise<PointOrderResult> {
  const { data, error } = await supabase.functions.invoke('mp-point-cancel-order', {
    body: {
      tenant_id: auth.tenantId,
      user_id: auth.userId,
      access_token: auth.accessToken,
      order_id: auth.orderId,
    },
  })
  if (error) throw new Error(error.message ?? 'Error al cancelar el cobro')
  if (data?.error) throw new Error(data.error)
  return data as PointOrderResult
}

// Orders reach one of these and never move again — polling stops here.
export const POINT_TERMINAL_STATUSES = ['processed', 'failed', 'canceled', 'expired'] as const

export const POINT_STATUS_LABELS: Record<string, string> = {
  failed: 'El cobro fue rechazado por el lector.',
  canceled: 'El cobro fue cancelado.',
  expired: 'El cobro expiró sin completarse.',
}

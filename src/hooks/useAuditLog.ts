import { useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth, useTenantId } from '@/contexts/AuthContext'

type LogActionParams = {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGOUT' | 'VIEW'
  module: string
  entityType?: string
  entityId?: string
  entityName?: string
  oldValue?: object
  newValue?: object
}

export function useAuditLog() {
  const { user, profile } = useAuth()
  const tenantId = useTenantId()

  const logAction = useCallback(
    (params: LogActionParams) => {
      if (!tenantId || !user) return
      supabase
        .from('audit_logs')
        .insert({
          tenant_id: tenantId,
          user_id: user.id,
          user_name: profile?.full_name ?? user.email ?? '',
          action: params.action,
          module: params.module,
          entity_type: params.entityType ?? null,
          entity_id: params.entityId ?? null,
          entity_name: params.entityName ?? null,
          old_value: params.oldValue ?? null,
          new_value: params.newValue ?? null,
        })
        .then(() => {})
    },
    [tenantId, user, profile],
  )

  return { logAction }
}

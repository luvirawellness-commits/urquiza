import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Loader2, Building2, LogIn } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Tenant } from '@/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type TenantRow = Tenant & { trial_ends_at?: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantStatus(t: TenantRow): 'active' | 'trial' | 'inactive' {
  if (!t.active) return 'inactive'
  if (t.trial_ends_at && new Date(t.trial_ends_at) > new Date()) return 'trial'
  return 'active'
}

function trialDaysLeft(t: TenantRow): number | null {
  if (!t.trial_ends_at) return null
  const diff = new Date(t.trial_ends_at).getTime() - Date.now()
  if (diff <= 0) return null
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const STATUS_CLS: Record<'active' | 'trial' | 'inactive', string> = {
  active: 'bg-green-100 text-green-700',
  trial: 'bg-amber-100 text-amber-700',
  inactive: 'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<'active' | 'trial' | 'inactive', string> = {
  active: 'Activo',
  trial: 'Trial',
  inactive: 'Inactivo',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const navigate = useNavigate()
  const { enterTenantAsAdmin, superAdminViewingTenant, exitSuperAdminView } = useAuth()

  const { data: tenants = [], isLoading: loadingTenants } = useQuery({
    queryKey: ['sa-tenants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as TenantRow[]
    },
  })

  const { data: ownerMap = {} } = useQuery({
    queryKey: ['sa-owners'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tenants')
        .select('tenant_id, user:users!user_tenants_user_id_fkey(email)')
        .eq('role', 'owner')
      if (error) throw error
      const map: Record<string, string> = {}
      for (const row of data ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const email = (row.user as any)?.email as string | undefined
        if (email && row.tenant_id) map[row.tenant_id] = email
      }
      return map
    },
  })

  const { data: userCounts = {} } = useQuery({
    queryKey: ['sa-user-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('active', true)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) {
        counts[row.tenant_id] = (counts[row.tenant_id] ?? 0) + 1
      }
      return counts
    },
  })

  const { data: clientCounts = {} } = useQuery({
    queryKey: ['sa-client-counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('tenant_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) {
        counts[row.tenant_id] = (counts[row.tenant_id] ?? 0) + 1
      }
      return counts
    },
  })

  async function handleEnter(tenant: TenantRow) {
    await enterTenantAsAdmin(tenant)
    navigate('/dashboard')
  }

  function handleExit() {
    exitSuperAdminView()
  }

  const loading = loadingTenants

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Super Admin</h1>
            <p className="text-sm text-muted-foreground">Panel de gestión de locales</p>
          </div>
        </div>
        {superAdminViewingTenant && (
          <Button variant="outline" size="sm" onClick={handleExit} className="gap-2 text-amber-700 border-amber-300">
            <LogIn className="w-4 h-4" />
            Salir de {superAdminViewingTenant.name}
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">Total locales</p>
          <p className="text-2xl font-bold text-gray-900">{tenants.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">En trial</p>
          <p className="text-2xl font-bold text-amber-600">
            {tenants.filter(t => getTenantStatus(t) === 'trial').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">Activos</p>
          <p className="text-2xl font-bold text-green-600">
            {tenants.filter(t => getTenantStatus(t) === 'active').length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : tenants.length === 0 ? (
          <p className="text-center text-muted-foreground py-20 text-sm">Sin locales registrados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Nombre del local</th>
                  <th className="text-left px-4 py-3 font-medium">Owner</th>
                  <th className="text-left px-4 py-3 font-medium">Registro</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Trial</th>
                  <th className="text-right px-4 py-3 font-medium">Usuarios</th>
                  <th className="text-right px-4 py-3 font-medium">Clientes</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenants.map((t) => {
                  const status = getTenantStatus(t)
                  const days = trialDaysLeft(t)
                  const isViewing = superAdminViewingTenant?.id === t.id
                  return (
                    <tr key={t.id} className={cn('hover:bg-gray-50 transition-colors', isViewing && 'bg-amber-50')}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-plum-100 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-plum-700" />
                          </div>
                          <div>
                            <p className="font-semibold text-gray-900">{t.name}</p>
                            <p className="text-xs text-muted-foreground">{t.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {ownerMap[t.id] ?? <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{fmtDate(t.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold', STATUS_CLS[status])}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {days !== null ? (
                          <span className="text-amber-700 font-medium">{days}d</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">
                        {userCounts[t.id] ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700">
                        {clientCounts[t.id] ?? 0}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isViewing ? (
                          <Button size="sm" variant="outline" onClick={handleExit} className="text-amber-700 border-amber-300 hover:bg-amber-50">
                            Salir
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => handleEnter(t)}>
                            Ingresar
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

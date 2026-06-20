import { useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Building2, ChevronDown, ChevronUp, Users, Eye, EyeOff, Copy, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Tenant } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type TenantRow = Tenant & { trial_ends_at?: string | null; listed_in_directory?: boolean | null }
type TenantStatus = 'active' | 'trial_active' | 'trial_expired' | 'inactive'
type BusyAction = 'activar' | 'extender' | 'desactivar'

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTenantStatus(t: TenantRow): TenantStatus {
  if (!t.active) return 'inactive'
  if (t.trial_ends_at) {
    return new Date(t.trial_ends_at) > new Date() ? 'trial_active' : 'trial_expired'
  }
  return 'active'
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function generatePassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#'
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const PLAN_LABELS: Record<string, string> = {
  monthly:    'Mensual',
  quarterly:  'Trimestral',
  semiannual: 'Semestral',
  annual:     'Anual',
}

function subscriptionBadge(trialEndsAt: string | null | undefined) {
  if (!trialEndsAt) return null
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft <= 0) return <span className="text-xs font-semibold text-red-600">🔴 Vencido</span>
  if (daysLeft <= 7) return <span className="text-xs font-semibold text-amber-600">⚠️ Vence en {daysLeft}d</span>
  return <span className="text-xs font-semibold text-green-600">✅ Activo · {daysLeft}d</span>
}

const STATUS_CLS: Record<TenantStatus, string> = {
  active:        'bg-green-100 text-green-700',
  trial_active:  'bg-amber-100 text-amber-700',
  trial_expired: 'bg-red-100 text-red-700',
  inactive:      'bg-gray-100 text-gray-500',
}

const STATUS_LABEL: Record<TenantStatus, string> = {
  active:        'Activo',
  trial_active:  'Trial activo',
  trial_expired: 'Trial vencido',
  inactive:      'Inactivo',
}

// ── Gestionar usuarios ────────────────────────────────────────────────────────

type TenantUser = {
  id: string
  full_name: string
  email: string
  role: string
}

const ASSIGNABLE_ROLES: { value: string; label: string }[] = [
  { value: 'owner',         label: 'Propietario' },
  { value: 'partner_admin', label: 'Admin socio' },
  { value: 'therapist',     label: 'Terapeuta' },
  { value: 'receptionist',  label: 'Recepcionista' },
]

function TenantUsersPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient()
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['sa-tenant-users', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_tenants')
        .select('user_id, role, user:users!user_tenants_user_id_fkey(id, full_name, email, role)')
        .eq('tenant_id', tenantId)
        .eq('active', true)
      if (error) throw error
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((row: any) => ({
        id: row.user?.id ?? '',
        full_name: row.user?.full_name ?? '',
        email: row.user?.email ?? '',
        role: row.user?.role ?? row.role,
      })).filter((u: TenantUser) => u.id).sort((a: TenantUser, b: TenantUser) => a.full_name.localeCompare(b.full_name)) as TenantUser[]
    },
  })

  async function handleRoleChange(userId: string, newRole: string) {
    setSavingId(userId)
    setSavedId(null)
    setErrors((prev) => { const next = { ...prev }; delete next[userId]; return next })
    try {
      const [usersRes, utRes] = await Promise.all([
        supabase.from('users').update({ role: newRole }).eq('id', userId),
        supabase.from('user_tenants').update({ role: newRole }).eq('user_id', userId).eq('tenant_id', tenantId),
      ])
      if (usersRes.error) throw usersRes.error
      if (utRes.error) throw utRes.error
      await qc.invalidateQueries({ queryKey: ['sa-tenant-users', tenantId] })
      await qc.invalidateQueries({ queryKey: ['sa-owners'] })
      setSavedId(userId)
      setTimeout(() => setSavedId((prev) => prev === userId ? null : prev), 2000)
    } catch (e) {
      setErrors((prev) => ({ ...prev, [userId]: e instanceof Error ? e.message : 'Error al guardar' }))
    } finally {
      setSavingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground py-3 text-center italic">Sin usuarios registrados para este local.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground border-b border-amber-200">
            <th className="text-left pb-2 pr-6 font-medium">Nombre</th>
            <th className="text-left pb-2 pr-6 font-medium">Email</th>
            <th className="text-left pb-2 pr-6 font-medium">Rol actual</th>
            <th className="text-left pb-2 font-medium">Cambiar rol</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-100">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="py-2.5 pr-6 font-medium text-gray-900 whitespace-nowrap">{u.full_name}</td>
              <td className="py-2.5 pr-6 text-gray-500 text-xs font-mono whitespace-nowrap">{u.email}</td>
              <td className="py-2.5 pr-6">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
                  {ASSIGNABLE_ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                </span>
              </td>
              <td className="py-2.5">
                <div className="flex items-center gap-2">
                  <select
                    value={u.role}
                    onChange={(e) => handleRoleChange(u.id, e.target.value)}
                    disabled={savingId === u.id}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-plum-500 disabled:opacity-50 cursor-pointer"
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                  {savingId === u.id && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground flex-shrink-0" />}
                  {savedId === u.id && <span className="text-xs text-green-600 flex-shrink-0">✓ Guardado</span>}
                  {errors[u.id] && <span className="text-xs text-red-600 flex-shrink-0">{errors[u.id]}</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted-foreground mt-3 italic">
        * Los cambios de rol toman efecto la próxima vez que el usuario inicie sesión.
      </p>
    </div>
  )
}

// ── Soporte modal ─────────────────────────────────────────────────────────────

type SoporteState = 'form' | 'loading' | 'success'

function SoporteModal({
  tenant,
  onClose,
  onSuccess,
}: {
  tenant: TenantRow
  onClose: () => void
  onSuccess: (tenantName: string) => void
}) {
  const [email, setEmail] = useState(`soporte+${tenant.slug}@luvirawellness.com.ar`)
  const [password, setPassword] = useState(() => generatePassword())
  const [showPw, setShowPw] = useState(false)
  const [state, setState] = useState<SoporteState>('form')
  const [error, setError] = useState('')
  const [createdEmail, setCreatedEmail] = useState('')
  const [createdPw, setCreatedPw] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleCreate() {
    setState('loading')
    setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sin sesión activa')

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: 'Soporte Luvira OS',
          role: 'owner',
          default_tenant_id: tenant.id,
          tenant_assignments: [{ tenant_id: tenant.id, role: 'owner' }],
        }),
      })
      const json = await resp.json()
      if (!resp.ok || json.error) throw new Error(json.error ?? 'Error al crear usuario')

      setCreatedEmail(email.trim())
      setCreatedPw(password)
      setState('success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido')
      setState('form')
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(`Email: ${createdEmail}\nContraseña: ${createdPw}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleClose() {
    if (state === 'success') onSuccess(tenant.name)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-gray-900">Crear usuario de soporte</h2>
          <p className="text-sm text-muted-foreground">{tenant.name}</p>
        </div>

        {state === 'success' ? (
          <div className="p-6 space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
              <p className="text-sm font-semibold text-green-800">Usuario creado exitosamente</p>
              <p className="text-xs text-green-700 font-mono break-all">Email: {createdEmail}</p>
              <p className="text-xs text-green-700 font-mono">Contraseña: {createdPw}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="h-7 text-xs gap-1.5 mt-1 border-green-300 text-green-700 hover:bg-green-100"
              >
                {copied ? '✓ Copiado' : <><Copy className="w-3 h-3" /> Copiar credenciales</>}
              </Button>
            </div>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
              <p className="text-xs text-amber-800">
                Este usuario temporal tiene rol <strong>owner</strong>.
                Eliminalo cuando termines el soporte.
              </p>
            </div>
            <Button className="w-full" onClick={handleClose}>Cerrar</Button>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Email</label>
              <Input
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="text-sm"
                disabled={state === 'loading'}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-700">Contraseña</label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="text-sm pr-9 font-mono"
                    disabled={state === 'loading'}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-gray-700"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPassword(generatePassword())}
                  disabled={state === 'loading'}
                  className="text-xs px-3 whitespace-nowrap"
                >
                  Nueva
                </Button>
              </div>
            </div>

            {error && (
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-md">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={state === 'loading'}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreate}
                disabled={state === 'loading' || !email.trim() || !password}
              >
                {state === 'loading'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : 'Crear usuario'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const qc = useQueryClient()

  // Per-row loading state
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null)

  // Inline "Extender trial" input state
  const [extendOpen, setExtendOpen] = useState<string | null>(null)
  const [extendDays, setExtendDays] = useState('7')

  // Inline "Desactivar" confirmation state
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // Expanded users panel per tenant
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Directory toggle
  const [directoryBusyId, setDirectoryBusyId] = useState<string | null>(null)

  // Banner toggle
  const [bannerBusyId, setBannerBusyId] = useState<string | null>(null)

  // Soporte modal
  const [soporteTenant, setSoporteTenant] = useState<TenantRow | null>(null)
  const [cleanupReminder, setCleanupReminder] = useState<string | null>(null)

  // ── Queries ────────────────────────────────────────────────────────────────

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
      const { data, error } = await supabase.from('users').select('tenant_id').eq('active', true)
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) counts[row.tenant_id] = (counts[row.tenant_id] ?? 0) + 1
      return counts
    },
  })

  const { data: clientCounts = {} } = useQuery({
    queryKey: ['sa-client-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clients').select('tenant_id')
      if (error) throw error
      const counts: Record<string, number> = {}
      for (const row of data ?? []) counts[row.tenant_id] = (counts[row.tenant_id] ?? 0) + 1
      return counts
    },
  })

  // ── Actions ────────────────────────────────────────────────────────────────

  function isBusy(id: string, action: BusyAction) {
    return busyId === id && busyAction === action
  }

  async function handleActivar(id: string) {
    setBusyId(id); setBusyAction('activar')
    await supabase.from('tenants').update({ trial_ends_at: null }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['sa-tenants'] })
    setBusyId(null); setBusyAction(null)
  }

  async function handleExtender(id: string) {
    setBusyId(id); setBusyAction('extender')
    const days = Math.max(1, parseInt(extendDays) || 7)
    const newDate = new Date()
    newDate.setDate(newDate.getDate() + days)
    await supabase.from('tenants').update({ trial_ends_at: newDate.toISOString() }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['sa-tenants'] })
    setExtendOpen(null)
    setExtendDays('7')
    setBusyId(null); setBusyAction(null)
  }

  async function handleToggleDirectory(id: string, current: boolean) {
    setDirectoryBusyId(id)
    await supabase.from('tenants').update({ listed_in_directory: !current }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['sa-tenants'] })
    setDirectoryBusyId(null)
  }

  async function handleToggleBanner(id: string, current: boolean) {
    setBannerBusyId(id)
    await supabase.from('tenants').update({ show_billing_banner: !current }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['sa-tenants'] })
    setBannerBusyId(null)
  }

  async function handleDesactivar(id: string) {
    setBusyId(id); setBusyAction('desactivar')
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await supabase.from('tenants').update({ trial_ends_at: yesterday.toISOString() }).eq('id', id)
    await qc.invalidateQueries({ queryKey: ['sa-tenants'] })
    setConfirmId(null)
    setBusyId(null); setBusyAction(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
          <Building2 className="w-5 h-5 text-amber-700" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Super Admin</h1>
          <p className="text-sm text-muted-foreground">Panel de gestión de locales</p>
        </div>
      </div>

      {/* Cleanup reminder */}
      {cleanupReminder && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-6 text-sm">
          <span className="flex-1 text-amber-800">
            Recordá eliminar el usuario de soporte de <strong>{cleanupReminder}</strong> cuando termines.
            Podés hacerlo desde Usuarios del local.
          </span>
          <button
            onClick={() => setCleanupReminder(null)}
            className="text-amber-600 hover:text-amber-900 font-bold text-lg leading-none flex-shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">Total locales</p>
          <p className="text-2xl font-bold text-gray-900">{tenants.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">Activos</p>
          <p className="text-2xl font-bold text-green-600">
            {tenants.filter(t => getTenantStatus(t) === 'active').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">En trial</p>
          <p className="text-2xl font-bold text-amber-600">
            {tenants.filter(t => getTenantStatus(t) === 'trial_active').length}
          </p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-muted-foreground">Trial vencido</p>
          <p className="text-2xl font-bold text-red-500">
            {tenants.filter(t => getTenantStatus(t) === 'trial_expired').length}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-hidden">
        {loadingTenants ? (
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
                  <th className="text-left px-4 py-3 font-medium">Local</th>
                  <th className="text-left px-4 py-3 font-medium">Owner</th>
                  <th className="text-left px-4 py-3 font-medium">Registro</th>
                  <th className="text-left px-4 py-3 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 font-medium">Suscripción</th>
                  <th className="text-right px-4 py-3 font-medium">Usuarios</th>
                  <th className="text-right px-4 py-3 font-medium">Clientes</th>
                  <th className="text-center px-4 py-3 font-medium">Banner</th>
                  <th className="text-center px-4 py-3 font-medium">Directorio</th>
                  <th className="text-right px-4 py-3 font-medium">Acciones</th>
                  <th className="px-4 py-3 font-medium">Gestionar</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenants.map((t) => {
                  const status = getTenantStatus(t)
                  const anyBusy = busyId === t.id
                  const showActivar = t.trial_ends_at != null
                  const showDesactivar = status === 'active' || status === 'trial_active'
                  const isExtendOpen = extendOpen === t.id
                  const isConfirmOpen = confirmId === t.id

                  return (
                    <Fragment key={t.id}>
                    <tr className="hover:bg-gray-50 transition-colors">
                      {/* Local */}
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

                      {/* Owner */}
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {ownerMap[t.id] ?? <span className="text-muted-foreground italic">—</span>}
                      </td>

                      {/* Registro */}
                      <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(t.created_at)}</td>

                      {/* Estado */}
                      <td className="px-4 py-3">
                        <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', STATUS_CLS[status])}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>

                      {/* Suscripción */}
                      <td className="px-4 py-3">
                        {t.trial_ends_at ? (
                          <div className="flex flex-col gap-0.5">
                            {t.last_plan && (
                              <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                                {PLAN_LABELS[t.last_plan] ?? t.last_plan}
                              </span>
                            )}
                            <span className="text-xs text-gray-500">{fmtDate(t.trial_ends_at)}</span>
                            {subscriptionBadge(t.trial_ends_at)}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* Usuarios */}
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{userCounts[t.id] ?? 0}</td>

                      {/* Clientes */}
                      <td className="px-4 py-3 text-right font-medium text-gray-700">{clientCounts[t.id] ?? 0}</td>

                      {/* Banner toggle */}
                      <td className="px-4 py-3 text-center">
                        <button
                          title="Mostrar u ocultar el banner de suscripción en el panel del tenant"
                          disabled={bannerBusyId === t.id}
                          onClick={() => handleToggleBanner(t.id, t.show_billing_banner !== false)}
                          className={cn(
                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
                            t.show_billing_banner !== false ? 'bg-blue-500' : 'bg-gray-200',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200',
                              t.show_billing_banner !== false ? 'translate-x-4' : 'translate-x-0',
                            )}
                          />
                        </button>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t.show_billing_banner !== false ? 'Visible' : 'Oculto'}
                        </p>
                      </td>

                      {/* Directorio toggle */}
                      <td className="px-4 py-3 text-center">
                        <button
                          title="Aparece en el buscador público de luviraos.com"
                          disabled={directoryBusyId === t.id}
                          onClick={() => handleToggleDirectory(t.id, !!t.listed_in_directory)}
                          className={cn(
                            'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
                            t.listed_in_directory ? 'bg-green-500' : 'bg-gray-200',
                          )}
                        >
                          <span
                            className={cn(
                              'inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200',
                              t.listed_in_directory ? 'translate-x-4' : 'translate-x-0',
                            )}
                          />
                        </button>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {t.listed_in_directory ? 'Visible' : 'Oculto'}
                        </p>
                      </td>

                      {/* Acciones */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1.5 items-end min-w-[160px]">

                          {/* Activar */}
                          {showActivar && (
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white w-full"
                              disabled={anyBusy}
                              onClick={() => handleActivar(t.id)}
                            >
                              {isBusy(t.id, 'activar')
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : 'Activar'}
                            </Button>
                          )}

                          {/* Extender trial */}
                          {isExtendOpen ? (
                            <div className="flex gap-1 w-full">
                              <Input
                                type="number"
                                min="1"
                                max="365"
                                value={extendDays}
                                onChange={e => setExtendDays(e.target.value)}
                                className="h-7 text-xs w-16 px-2"
                                autoFocus
                              />
                              <span className="text-xs text-muted-foreground self-center">días</span>
                              <Button
                                size="sm"
                                className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white flex-1"
                                disabled={anyBusy}
                                onClick={() => handleExtender(t.id)}
                              >
                                {isBusy(t.id, 'extender')
                                  ? <Loader2 className="w-3 h-3 animate-spin" />
                                  : 'OK'}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs"
                                onClick={() => { setExtendOpen(null); setExtendDays('7') }}
                              >
                                ✕
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white w-full"
                              disabled={anyBusy}
                              onClick={() => { setExtendOpen(t.id); setConfirmId(null) }}
                            >
                              Extender trial
                            </Button>
                          )}

                          {/* Desactivar */}
                          {showDesactivar && (
                            isConfirmOpen ? (
                              <div className="flex flex-col gap-1 w-full">
                                <p className="text-[11px] text-red-600 font-medium leading-tight">
                                  ¿Desactivar &ldquo;{t.name}&rdquo;? El local quedará bloqueado inmediatamente.
                                </p>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white flex-1"
                                    disabled={anyBusy}
                                    onClick={() => handleDesactivar(t.id)}
                                  >
                                    {isBusy(t.id, 'desactivar')
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : 'Sí, desactivar'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => setConfirmId(null)}
                                  >
                                    No
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-200 text-red-600 hover:bg-red-50 hover:border-red-400 w-full"
                                disabled={anyBusy}
                                onClick={() => { setConfirmId(t.id); setExtendOpen(null) }}
                              >
                                Desactivar
                              </Button>
                            )
                          )}
                        </div>
                      </td>

                      {/* Ingresar / Salir + Gestionar usuarios */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setExpandedId((prev) => prev === t.id ? null : t.id)}
                            className={cn(
                              'h-7 text-xs gap-1 px-2',
                              expandedId === t.id ? 'text-plum-700 bg-plum-50' : 'text-muted-foreground hover:text-gray-700',
                            )}
                          >
                            <Users className="w-3 h-3" />
                            Usuarios
                            {expandedId === t.id
                              ? <ChevronUp className="w-3 h-3" />
                              : <ChevronDown className="w-3 h-3" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSoporteTenant(t)}
                            className="h-7 text-xs gap-1 px-2 text-muted-foreground hover:text-orange-700 hover:bg-orange-50"
                          >
                            <Wrench className="w-3 h-3" />
                            Soporte
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expandedId === t.id && (
                      <tr>
                        <td colSpan={10} className="px-6 py-4 bg-amber-50/40 border-b">
                          <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5" />
                            Gestionar usuarios — {t.name}
                          </p>
                          <TenantUsersPanel tenantId={t.id} />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {soporteTenant && (
        <SoporteModal
          tenant={soporteTenant}
          onClose={() => setSoporteTenant(null)}
          onSuccess={(name) => { setSoporteTenant(null); setCleanupReminder(name) }}
        />
      )}
    </div>
  )
}

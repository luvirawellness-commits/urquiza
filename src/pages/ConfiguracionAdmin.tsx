import { useState, useEffect, ElementType } from 'react'
import { Plus, Pencil, Trash2, Loader2, Building2, Users, Shield, Check, Layers } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth, useTenantId } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Tenant, UserProfile } from '@/types'
import {
  useAdminServices, useCreateService, useUpdateService, useDeleteService,
  serviceRowToForm, EMPTY_SERVICE_FORM,
  type ServiceRow, type ServiceForm,
} from '@/hooks/useServices'

type AdminTab = 'locales' | 'usuarios' | 'roles' | 'servicios'

// ── Shared types ──────────────────────────────────────────────────────────────

type RoleRow = {
  id: string; name: string; description?: string
  is_system: boolean; permissions: Record<string, boolean>
  tenant_id?: string; created_at: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function useRoles() {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['roles', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('roles')
        .select('*')
        .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
        .order('is_system', { ascending: false })
        .order('name')
      if (error) throw error
      return data as RoleRow[]
    },
    enabled: !!tenantId,
  })
}

// ── Add Branch Modal ──────────────────────────────────────────────────────────

type BranchForm = { name: string; slug: string; address: string; phone: string; whatsapp: string }
const EMPTY_BRANCH: BranchForm = { name: '', slug: '', address: '', phone: '', whatsapp: '' }

type BranchResult = { tenant_id: string; tenant_name: string; trial_ends_at: string }

function BranchModal({
  open,
  onClose,
  onSwitch,
}: {
  open: boolean
  onClose: () => void
  onSwitch: (tenantId: string) => Promise<void>
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [form, setForm] = useState<BranchForm>(EMPTY_BRANCH)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<BranchResult | null>(null)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    if (open) { setForm(EMPTY_BRANCH); setError(''); setResult(null) }
  }, [open])

  function setField<K extends keyof BranchForm>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (k === 'name') next.slug = slugify(v)
      return next
    })
  }

  async function handleSubmit() {
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return }
    if (!form.slug.trim()) { setError('El slug es obligatorio.'); return }
    if (!form.address.trim()) { setError('La dirección es obligatoria.'); return }
    if (!form.phone.trim()) { setError('El teléfono es obligatorio.'); return }
    setError('')
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sin sesión activa')

      const { data, error: fnErr } = await supabase.functions.invoke('add-branch', {
        body: {
          user_id:        user?.id,
          access_token:   session.access_token,
          tenant_name:    form.name.trim(),
          slug:           form.slug.trim(),
          address:        form.address.trim(),
          phone:          form.phone.trim(),
          whatsapp_number: form.whatsapp.trim() || null,
        },
      })

      if (fnErr) throw new Error(fnErr.message ?? 'Error al crear la sucursal')
      if (data?.error) throw new Error(data.error)

      await qc.invalidateQueries({ queryKey: ['tenants'] })
      setResult({ tenant_id: data.tenant_id, tenant_name: form.name.trim(), trial_ends_at: data.trial_ends_at })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear la sucursal')
    } finally {
      setSaving(false)
    }
  }

  async function handleSwitch() {
    if (!result) return
    setSwitching(true)
    await onSwitch(result.tenant_id)
    setSwitching(false)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agregar nueva sucursal</DialogTitle>
        </DialogHeader>

        {result ? (
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 space-y-2">
              <p className="text-sm font-semibold text-green-800">¡Nueva sucursal creada!</p>
              <p className="text-sm text-green-700">
                Tenés 7 días de prueba gratuita. Podés empezar a configurarla ahora.
              </p>
            </div>
            <div className="rounded-lg border border-plum-200 bg-plum-50/40 p-4 space-y-3">
              <p className="text-sm text-plum-800">
                ¿Querés ir a configurar <strong>{result.tenant_name}</strong>?
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-plum-700 hover:bg-plum-800 text-white"
                  onClick={handleSwitch}
                  disabled={switching}
                >
                  {switching && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                  Ir ahora →
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  Quedarme aquí
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre del local *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  placeholder="Palermo"
                />
              </div>
              <div className="space-y-1">
                <Label>Slug * <span className="text-xs text-muted-foreground">(URL única)</span></Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setField('slug', slugify(e.target.value))}
                  placeholder="palermo"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Dirección *</Label>
              <Input
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Av. Santa Fe 1234, CABA"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Teléfono *</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="+54 11 ..."
                />
              </div>
              <div className="space-y-1">
                <Label>WhatsApp</Label>
                <Input
                  value={form.whatsapp}
                  onChange={(e) => setField('whatsapp', e.target.value)}
                  placeholder="+54 9 11 ..."
                />
              </div>
            </div>
            {form.slug && (
              <p className="text-xs text-muted-foreground">
                Link de reservas: <span className="font-mono">luviraos.com/reservar/{form.slug}</span>
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Crear sucursal
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Locales Tab ───────────────────────────────────────────────────────────────

type TenantForm = {
  name: string; slug: string; address: string; phone: string
  whatsapp: string; breakeven: string; royalty_pct: string
}

const EMPTY_TENANT: TenantForm = {
  name: '', slug: '', address: '', phone: '', whatsapp: '', breakeven: '', royalty_pct: '',
}

function tenantToForm(t: Tenant): TenantForm {
  return {
    name: t.name, slug: t.slug, address: t.address ?? '', phone: t.phone ?? '',
    whatsapp: t.whatsapp ?? '', breakeven: t.breakeven != null ? String(t.breakeven) : '',
    royalty_pct: t.royalty_pct != null ? String(t.royalty_pct) : '',
  }
}

function LocalModal({ open, onClose, tenant, allTenants }: {
  open: boolean; onClose: () => void; tenant?: Tenant; allTenants: Tenant[]
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<TenantForm>(tenant ? tenantToForm(tenant) : EMPTY_TENANT)
  const [copyFrom, setCopyFrom] = useState('')
  const [mode, setMode] = useState<'empty' | 'copy'>('empty')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(tenant ? tenantToForm(tenant) : EMPTY_TENANT)
      setCopyFrom(''); setMode('empty'); setError('')
    }
  }, [open, tenant])

  function setField<K extends keyof TenantForm>(k: K, v: string) {
    setForm((f) => {
      const next = { ...f, [k]: v }
      if (k === 'name' && !tenant) next.slug = slugify(v)
      return next
    })
  }

  async function copyTenantData(fromId: string, toId: string) {
    const { data: services } = await supabase.from('services').select('*').eq('tenant_id', fromId)
    if (services?.length) {
      await supabase.from('services').insert(
        services.map(({ id: _id, tenant_id: _t, created_at: _c, ...rest }) => ({ ...rest, tenant_id: toId }))
      )
    }
    const { data: plans } = await supabase.from('membership_plans').select('*').eq('tenant_id', fromId)
    if (plans?.length) {
      await supabase.from('membership_plans').insert(
        plans.map(({ id: _id, tenant_id: _t, created_at: _c, ...rest }) => ({ ...rest, tenant_id: toId }))
      )
    }
    const { data: positions } = await supabase.from('job_positions').select('*').eq('tenant_id', fromId)
    if (positions?.length) {
      await supabase.from('job_positions').insert(
        positions.map(({ id: _id, tenant_id: _t, created_at: _c, updated_at: _u, ...rest }) => ({ ...rest, tenant_id: toId }))
      )
    }
    const { data: supplies } = await supabase.from('supplies').select('*').eq('tenant_id', fromId)
    if (supplies?.length) {
      await supabase.from('supplies').insert(
        supplies.map(({ id: _id, tenant_id: _t, created_at: _c, updated_at: _u, ...rest }) => ({ ...rest, tenant_id: toId }))
      )
    }
  }

  async function handleSave() {
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Nombre y slug son obligatorios.')
      return
    }
    setError('')
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        address: form.address || undefined,
        phone: form.phone || undefined,
        whatsapp: form.whatsapp || undefined,
        breakeven: form.breakeven ? parseFloat(form.breakeven) : undefined,
        royalty_pct: form.royalty_pct ? parseFloat(form.royalty_pct) : undefined,
        active: true,
      }

      if (tenant) {
        const { error } = await supabase.from('tenants').update(payload).eq('id', tenant.id)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('tenants').insert(payload).select().single()
        if (error) throw error
        if (mode === 'copy' && copyFrom && data) {
          await copyTenantData(copyFrom, data.id)
        }
      }

      await qc.invalidateQueries({ queryKey: ['tenants'] })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const otherTenants = allTenants.filter((t) => t.id !== tenant?.id)

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tenant ? 'Editar local' : 'Nuevo local'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="Urquiza" />
            </div>
            <div className="space-y-1">
              <Label>Slug *</Label>
              <Input value={form.slug} onChange={(e) => setField('slug', e.target.value)} placeholder="urquiza" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Dirección</Label>
            <Input value={form.address} onChange={(e) => setField('address', e.target.value)} placeholder="Av. Corrientes 1234" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={(e) => setField('phone', e.target.value)} placeholder="+54 11 ..." />
            </div>
            <div className="space-y-1">
              <Label>WhatsApp</Label>
              <Input value={form.whatsapp} onChange={(e) => setField('whatsapp', e.target.value)} placeholder="+54 9 11 ..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Punto de equilibrio ($)</Label>
              <Input type="number" min="0" value={form.breakeven} onChange={(e) => setField('breakeven', e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label>Royalty %</Label>
              <Input type="number" min="0" max="100" step="0.1" value={form.royalty_pct} onChange={(e) => setField('royalty_pct', e.target.value)} placeholder="0" />
            </div>
          </div>

          {!tenant && otherTenants.length > 0 && (
            <div className="border border-plum-200 rounded-lg p-3 space-y-3 bg-plum-50/30">
              <p className="text-sm font-medium text-plum-800">Datos iniciales</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setMode('empty')}
                  className={cn('flex-1 py-2 px-3 rounded-md text-sm border transition-colors', mode === 'empty' ? 'border-plum-700 bg-plum-50 text-plum-800 font-medium' : 'border-gray-200 text-muted-foreground hover:border-plum-400')}
                >
                  Iniciar vacío
                </button>
                <button
                  onClick={() => setMode('copy')}
                  className={cn('flex-1 py-2 px-3 rounded-md text-sm border transition-colors', mode === 'copy' ? 'border-plum-700 bg-plum-50 text-plum-800 font-medium' : 'border-gray-200 text-muted-foreground hover:border-plum-400')}
                >
                  Copiar desde…
                </button>
              </div>
              {mode === 'copy' && (
                <div className="space-y-1">
                  <Label>Copiar datos de</Label>
                  <select
                    value={copyFrom}
                    onChange={(e) => setCopyFrom(e.target.value)}
                    className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none"
                  >
                    <option value="">— Seleccionar local —</option>
                    {otherTenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <p className="text-xs text-muted-foreground">Copia servicios, membresías, puestos de trabajo e insumos.</p>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {tenant ? 'Guardar cambios' : 'Crear local'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabLocales() {
  const tenantId = useTenantId()
  const { profile, switchTenant } = useAuth()
  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .order('name')
      if (error) throw error
      return data as Tenant[]
    },
    enabled: !!tenantId,
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Tenant | undefined>()
  const [branchOpen, setBranchOpen] = useState(false)

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(t: Tenant) { setEditing(t); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{tenants.length} locales registrados</p>
        <div className="flex gap-2">
          {isOwner && (
            <Button size="sm" variant="outline" onClick={() => setBranchOpen(true)}>
              <Plus className="w-4 h-4 mr-1" />Agregar sucursal
            </Button>
          )}
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" />Nuevo local
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Nombre</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Dirección</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-plum-800">{t.name}</p>
                    <p className="text-xs text-muted-foreground">/{t.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{t.address ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={t.active ? 'default' : 'secondary'} className="text-xs">
                      {t.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-plum-800" onClick={() => openEdit(t)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tenants.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Building2 className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin locales registrados</p>
            </div>
          )}
        </CardContent>
      </Card>
      <LocalModal open={modalOpen} onClose={closeModal} tenant={editing} allTenants={tenants} />
      <BranchModal open={branchOpen} onClose={() => setBranchOpen(false)} onSwitch={switchTenant} />
    </div>
  )
}

// ── Usuarios Tab ──────────────────────────────────────────────────────────────

type UserWithTenants = UserProfile & {
  user_tenants?: { tenant_id: string; role: string; tenant?: { name: string } | null }[]
}

type UserForm = { full_name: string; email: string; color_hex: string }
type TenantAssignment = { tenant_id: string; role: string }

function UserModal({ open, onClose, onSuccess, user, allTenants, availableRoles }: {
  open: boolean; onClose: () => void; onSuccess?: (tempPassword: string) => void
  user?: UserWithTenants; allTenants: Tenant[]; availableRoles: RoleRow[]
}) {
  const qc = useQueryClient()

  const [form, setForm] = useState<UserForm>({
    full_name: user?.full_name ?? '',
    email: user?.email ?? '',
    color_hex: user?.color_hex ?? '#7C3AED',
  })
  const [selectedRole, setSelectedRole] = useState<string>(user?.role ?? 'therapist')
  const [assignments, setAssignments] = useState<TenantAssignment[]>(
    user?.user_tenants?.map((ut) => ({ tenant_id: ut.tenant_id, role: ut.role })) ?? []
  )
  const [defaultTenantId, setDefaultTenantId] = useState(user?.default_tenant_id ?? user?.tenant_id ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) {
      setForm({
        full_name: user?.full_name ?? '',
        email: user?.email ?? '',
        color_hex: user?.color_hex ?? '#7C3AED',
      })
      setSelectedRole(user?.role ?? 'therapist')
      setAssignments(user?.user_tenants?.map((ut) => ({ tenant_id: ut.tenant_id, role: ut.role })) ?? [])
      setDefaultTenantId(user?.default_tenant_id ?? user?.tenant_id ?? '')
      setError(''); setSaved(false)
    }
  }, [open, user])

  function toggleTenant(tid: string) {
    setAssignments((prev) => {
      const exists = prev.find((a) => a.tenant_id === tid)
      if (exists) return prev.filter((a) => a.tenant_id !== tid)
      return [...prev, { tenant_id: tid, role: selectedRole || 'therapist' }]
    })
  }

  function setTenantRole(tid: string, role: string) {
    setAssignments((prev) => prev.map((a) => a.tenant_id === tid ? { ...a, role } : a))
  }

  async function handleCreate() {
    if (!form.email.trim()) { setError('Email es obligatorio.'); return }
    if (!form.full_name.trim()) { setError('Nombre es obligatorio.'); return }
    if (assignments.length === 0) { setError('Asigná al menos un local.'); return }
    setError('')
    setSaving(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('rapid-processor', {
        body: {
          email: form.email.trim(),
          full_name: form.full_name.trim(),
          role: selectedRole,
          color_hex: form.color_hex,
          default_tenant_id: assignments[0]?.tenant_id,
          tenant_assignments: assignments.map((a) => ({ tenant_id: a.tenant_id, role: a.role })),
        },
      })
      if (fnError) throw new Error(fnError.message ?? 'Error al invocar la función')
      if (data?.error) throw new Error(data.error)
      await qc.invalidateQueries({ queryKey: ['admin-users'] })
      onSuccess?.(data.temp_password ?? '')
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al crear el usuario')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!user) return
    if (!form.full_name.trim()) { setError('Nombre es obligatorio.'); return }
    if (assignments.length === 0) { setError('Asigná al menos un local.'); return }
    setError('')
    setSaving(true)
    try {
      const updatePayload = {
        full_name: form.full_name.trim(),
        role: selectedRole,
        color_hex: form.color_hex,
      }
      const { error: updateErr } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', user.id)
      if (updateErr) throw updateErr

      // Sync user_tenants
      await supabase.from('user_tenants').delete().eq('user_id', user.id)
      if (assignments.length > 0) {
        await supabase.from('user_tenants').insert(
          assignments.map((a) => ({ user_id: user.id, tenant_id: a.tenant_id, role: a.role }))
        )
      }

      await qc.invalidateQueries({ queryKey: ['admin-users'] })
      setError('')
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 3000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const selectCls = 'w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none'

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{user ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
        </DialogHeader>

        {!user ? (
          <div className="space-y-4 mt-2">
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Email *</Label>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="usuario@email.com"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Nombre completo *</Label>
                    <Input
                      value={form.full_name}
                      onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                      placeholder="Ana García"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Rol principal</Label>
                  <select
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                    className={selectCls}
                  >
                    {availableRoles.length === 0 && (
                      <option value={selectedRole}>{selectedRole}</option>
                    )}
                    {availableRoles.map((r) => (
                      <option key={r.id} value={r.name}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label>Color</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color_hex}
                      onChange={(e) => setForm((f) => ({ ...f, color_hex: e.target.value }))}
                      className="w-10 h-10 rounded cursor-pointer border border-input"
                    />
                    <Input
                      value={form.color_hex}
                      onChange={(e) => setForm((f) => ({ ...f, color_hex: e.target.value }))}
                      className="flex-1 font-mono text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Locales asignados</Label>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {allTenants.map((t) => {
                      const assigned = assignments.find((a) => a.tenant_id === t.id)
                      return (
                        <div key={t.id} className={cn('border rounded-lg p-3 transition-colors', assigned ? 'border-plum-400 bg-plum-50/40' : 'border-gray-200')}>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={`new-tenant-${t.id}`}
                              checked={!!assigned}
                              onChange={() => toggleTenant(t.id)}
                              className="w-4 h-4 accent-plum-700"
                            />
                            <label htmlFor={`new-tenant-${t.id}`} className="flex-1 text-sm font-medium cursor-pointer text-plum-800">{t.name}</label>
                            {assigned && (
                              <button
                                onClick={() => setDefaultTenantId(t.id)}
                                className={cn('text-xs px-2 py-0.5 rounded-full border transition-colors', defaultTenantId === t.id ? 'bg-gold-400 border-gold-400 text-plum-900 font-medium' : 'border-gray-300 text-muted-foreground hover:border-gold-400')}
                              >
                                {defaultTenantId === t.id ? 'Principal' : 'Hacer principal'}
                              </button>
                            )}
                          </div>
                          {assigned && (
                            <div className="mt-2 ml-6">
                              <select
                                value={assigned.role}
                                onChange={(e) => setTenantRole(t.id, e.target.value)}
                                className={selectCls}
                              >
                                {availableRoles.length === 0 && (
                                  <option value={assigned.role}>{assigned.role}</option>
                                )}
                                {availableRoles.map((r) => (
                                  <option key={r.id} value={r.name}>{r.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={onClose}>Cancelar</Button>
                  <Button onClick={handleCreate} disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Crear usuario
                  </Button>
                </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Nombre completo *</Label>
                <Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input value={form.email} disabled className="opacity-60" />
              </div>
            </div>

            {/* FIX 1: global role dropdown from roles table */}
            <div className="space-y-1">
              <Label>Rol principal</Label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                className={selectCls}
              >
                {availableRoles.length === 0 && (
                  <option value={selectedRole}>{selectedRole}</option>
                )}
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.name}>{r.name}{r.description ? ` — ${r.description}` : ''}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Rol global del usuario en el sistema.</p>
            </div>

            <div className="space-y-1">
              <Label>Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.color_hex}
                  onChange={(e) => setForm((f) => ({ ...f, color_hex: e.target.value }))}
                  className="w-10 h-10 rounded cursor-pointer border border-input"
                />
                <Input
                  value={form.color_hex}
                  onChange={(e) => setForm((f) => ({ ...f, color_hex: e.target.value }))}
                  className="flex-1 font-mono text-sm"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Locales asignados</Label>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {allTenants.map((t) => {
                  const assigned = assignments.find((a) => a.tenant_id === t.id)
                  return (
                    <div key={t.id} className={cn('border rounded-lg p-3 transition-colors', assigned ? 'border-plum-400 bg-plum-50/40' : 'border-gray-200')}>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`tenant-${t.id}`}
                          checked={!!assigned}
                          onChange={() => toggleTenant(t.id)}
                          className="w-4 h-4 accent-plum-700"
                        />
                        <label htmlFor={`tenant-${t.id}`} className="flex-1 text-sm font-medium cursor-pointer text-plum-800">{t.name}</label>
                        {assigned && (
                          <button
                            onClick={() => setDefaultTenantId(t.id)}
                            className={cn('text-xs px-2 py-0.5 rounded-full border transition-colors', defaultTenantId === t.id ? 'bg-gold-400 border-gold-400 text-plum-900 font-medium' : 'border-gray-300 text-muted-foreground hover:border-gold-400')}
                          >
                            {defaultTenantId === t.id ? 'Principal' : 'Hacer principal'}
                          </button>
                        )}
                      </div>
                      {assigned && (
                        <div className="mt-2 ml-6">
                          {/* FIX 1: per-tenant role uses roles table */}
                          <select
                            value={assigned.role}
                            onChange={(e) => setTenantRole(t.id, e.target.value)}
                            className={selectCls}
                          >
                            {availableRoles.length === 0 && (
                              <option value={assigned.role}>{assigned.role}</option>
                            )}
                            {availableRoles.map((r) => (
                              <option key={r.id} value={r.name}>{r.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                Perfil actualizado. Si cambió el rol, el usuario deberá cerrar sesión y volver a entrar para que los cambios de permisos tomen efecto.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onClose}>Cancelar</Button>
              <Button onClick={handleSave} disabled={saving || saved}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {saved ? 'Guardado' : 'Guardar cambios'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TabUsuarios() {
  const tenantId = useTenantId()
  const { profile, availableTenants: myTenants } = useAuth()
  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
  const myTenantIds = myTenants.map((t) => t.id)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', tenantId, isOwner ? 'owner' : myTenantIds.join(',')],
    queryFn: async () => {
      // Always scope to the active tenant via user_tenants to avoid leaking cross-tenant
      // data when super_admin impersonates a local (service-role bypasses RLS).
      const { data: utRows, error: utError } = await supabase
        .from('user_tenants')
        .select('user_id')
        .eq('tenant_id', tenantId)
      if (utError) throw utError

      const userIds = (utRows ?? []).map((r: { user_id: string }) => r.user_id)
      if (userIds.length === 0) return [] as UserWithTenants[]

      const { data, error } = await supabase
        .from('users')
        .select(`*, user_tenants(tenant_id, role, tenant:tenants(name))`)
        .in('id', userIds)
        .order('full_name')
      if (error) throw error
      return data as UserWithTenants[]
    },
    enabled: !!tenantId,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .order('name')
      if (error) throw error
      return data as Tenant[]
    },
    enabled: !!tenantId,
  })

  // FIX 1: use shared useRoles hook (avoids query key collision with TabRoles)
  const { data: roleRows = [] } = useRoles()
  const roleLabel = (roleName: string) => roleRows.find((r) => r.name === roleName)?.name ?? roleName

  // super_admin is never an assignable role; owner is only assignable by owner/super_admin
  const assignableRoles = isOwner
    ? roleRows.filter((r) => r.name !== 'super_admin')
    : roleRows.filter((r) => r.name !== 'owner' && r.name !== 'super_admin')
  const assignableTenants = isOwner ? tenants : tenants.filter((t) => myTenantIds.includes(t.id))

  // partner_admin cannot edit/delete owner accounts or users outside their tenants
  function canEdit(u: UserWithTenants) {
    if (isOwner) return true
    if (u.role === 'owner') return false
    return myTenantIds.includes(u.tenant_id ?? '')
  }
  function editTooltip(u: UserWithTenants) {
    if (u.role === 'owner') return 'No podés editar a un propietario'
    if (!myTenantIds.includes(u.tenant_id ?? '')) return 'Este usuario no pertenece a tus locales'
    return undefined
  }

  const qc = useQueryClient()
  const deactivateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from('users').update({ active: false }).eq('id', userId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserWithTenants | undefined>()
  const [toastPassword, setToastPassword] = useState('')

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(u: UserWithTenants) { setEditing(u); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }
  function handleUserCreated(tempPassword: string) { setToastPassword(tempPassword) }

  const ROLE_COLORS: Record<string, string> = {
    owner: 'bg-purple-100 text-purple-800',
    partner_admin: 'bg-blue-100 text-blue-800',
    therapist: 'bg-green-100 text-green-800',
    receptionist: 'bg-orange-100 text-orange-800',
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  return (
    <div className="space-y-4">
      {toastPassword && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-semibold text-green-800">Usuario creado. Contraseña temporal:</p>
              <p className="text-xs text-green-700 mt-0.5">Compartila con el usuario — solo se muestra una vez.</p>
            </div>
            <button
              onClick={() => setToastPassword('')}
              className="text-green-500 hover:text-green-800 ml-3 text-xl leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-white border border-green-300 rounded px-3 py-2 text-sm font-mono text-green-900 select-all tracking-wide">
              {toastPassword}
            </code>
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="border-green-300 text-green-700 hover:bg-green-100 flex-shrink-0"
              onClick={() => navigator.clipboard.writeText(toastPassword)}
            >
              Copiar
            </Button>
          </div>
        </div>
      )}
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{users.length} usuarios registrados</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />Nuevo usuario
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Usuario</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Rol</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Locales</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const allowed = canEdit(u)
                const tip = editTooltip(u)
                return (
                  <tr key={u.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={{ backgroundColor: u.color_hex ?? '#7C3AED' }}
                        >
                          {u.full_name?.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium text-plum-800">{u.full_name}</p>
                            {u.active === false && (
                              <Badge variant="secondary" className="text-xs px-1.5 py-0">Inactivo</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-700')}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.user_tenants && u.user_tenants.length > 0 ? (
                          u.user_tenants.map((ut) => (
                            <span key={ut.tenant_id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-plum-100 text-plum-700">
                              {ut.tenant?.name ?? tenants.find((t) => t.id === ut.tenant_id)?.name ?? ut.tenant_id.slice(0, 8)}
                            </span>
                          ))
                        ) : u.tenant_id ? (
                          // fallback: user_tenants empty (RLS) but tenant_id known
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-plum-100 text-plum-700">
                            {tenants.find((t) => t.id === u.tenant_id)?.name ?? u.tenant_id.slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sin locales</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span title={tip}>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-muted-foreground hover:text-plum-800"
                            onClick={() => openEdit(u)}
                            disabled={!allowed}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                        </span>
                        <span title={tip}>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 text-muted-foreground hover:text-red-600"
                            onClick={() => { if (confirm(`¿Desactivar a ${u.full_name}?`)) deactivateMutation.mutate(u.id) }}
                            disabled={!allowed || deactivateMutation.isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin usuarios registrados</p>
            </div>
          )}
        </CardContent>
      </Card>
      <UserModal open={modalOpen} onClose={closeModal} onSuccess={handleUserCreated} user={editing} allTenants={assignableTenants} availableRoles={assignableRoles} />
    </div>
  )
}

// ── Roles Tab ─────────────────────────────────────────────────────────────────

type RoleForm = {
  name: string; description: string
  permissions: Record<string, boolean>
}

const ALL_PERMS: { key: string; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'clientes', label: 'Clientes' },
  { key: 'caja', label: 'Caja' },
  { key: 'finanzas', label: 'Finanzas P&L' },
  { key: 'gift_cards', label: 'Gift Cards' },
  { key: 'productos', label: 'Productos' },
  { key: 'compras', label: 'Compras' },
  { key: 'rrhh', label: 'RRHH' },
  { key: 'configuracion', label: 'Configuración' },
]

const EMPTY_ROLE: RoleForm = {
  name: '', description: '',
  permissions: Object.fromEntries(ALL_PERMS.map((p) => [p.key, false])),
}

function roleToForm(r: RoleRow): RoleForm {
  return {
    name: r.name, description: r.description ?? '',
    permissions: { ...Object.fromEntries(ALL_PERMS.map((p) => [p.key, false])), ...r.permissions },
  }
}

function RoleModal({ open, onClose, role, tenantId }: {
  open: boolean; onClose: () => void; role?: RoleRow; tenantId: string
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<RoleForm>(role ? roleToForm(role) : EMPTY_ROLE)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // FIX 3: owner role is always locked
  const isOwner = role?.name === 'owner'
  const allPermsOn = Object.fromEntries(ALL_PERMS.map((p) => [p.key, true]))

  useEffect(() => {
    if (open) { setForm(role ? roleToForm(role) : EMPTY_ROLE); setError('') }
  }, [open, role])

  function togglePerm(key: string) {
    if (isOwner) return
    setForm((f) => ({ ...f, permissions: { ...f.permissions, [key]: !f.permissions[key] } }))
  }

  async function handleSave() {
    if (isOwner) return
    if (!form.name.trim()) { setError('Nombre es obligatorio.'); return }
    setError(''); setSaving(true)
    try {
      if (role) {
        // FIX 3: for system roles only update permissions + description; custom roles update all
        const updatePayload = role.is_system
          ? { description: form.description || undefined, permissions: form.permissions }
          : { name: form.name.trim(), description: form.description || undefined, permissions: form.permissions }
        const { error } = await supabase.from('roles').update(updatePayload).eq('id', role.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('roles').insert({
          name: form.name.trim(),
          description: form.description || undefined,
          permissions: form.permissions,
          tenant_id: tenantId,
        })
        if (error) throw error
      }
      await qc.invalidateQueries({ queryKey: ['roles'] })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  const displayPerms = isOwner ? allPermsOn : form.permissions

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{role ? 'Editar rol' : 'Nuevo rol'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {/* FIX 3: owner notice */}
          {isOwner && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
              <Shield className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-amber-800">El rol de dueño siempre tiene acceso completo a todos los módulos y no puede ser modificado.</p>
            </div>
          )}

          <div className="space-y-1">
            <Label>Nombre *</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Coordinador"
              disabled={isOwner || (role?.is_system ?? false)}
            />
          </div>
          <div className="space-y-1">
            <Label>Descripción</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Opcional"
              disabled={isOwner}
            />
          </div>
          <div className="space-y-2">
            <Label>Permisos</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_PERMS.map((p) => (
                <label key={p.key} className={cn('flex items-center gap-2 select-none', isOwner ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer')}>
                  <div
                    onClick={() => togglePerm(p.key)}
                    className={cn(
                      'w-5 h-5 rounded border-2 flex items-center justify-center transition-colors',
                      isOwner ? 'cursor-not-allowed' : 'cursor-pointer',
                      displayPerms[p.key]
                        ? 'bg-plum-700 border-plum-700'
                        : 'border-gray-300 hover:border-plum-400'
                    )}
                  >
                    {displayPerms[p.key] && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <span className="text-sm">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{isOwner ? 'Cerrar' : 'Cancelar'}</Button>
            {!isOwner && (
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {role ? 'Guardar cambios' : 'Crear rol'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabRoles({ canEdit }: { canEdit: boolean }) {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { data: rolesRaw = [], isLoading } = useRoles()
  const roles = rolesRaw.filter((r) => r.name !== 'super_admin')

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('roles').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<RoleRow | undefined>()

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(r: RoleRow) { setEditing(r); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

  const permCount = (r: RoleRow) => Object.values(r.permissions).filter(Boolean).length

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{roles.length} roles configurados</p>
        {canEdit && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" />Nuevo rol
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Nombre</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Tipo</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Permisos</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-plum-800">{r.name}</p>
                    {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={r.is_system ? 'default' : 'secondary'} className="text-xs">
                      {r.is_system ? 'Sistema' : 'Personalizado'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-gray-600">
                      {r.name === 'owner'
                        ? 'Todos los permisos'
                        : `${permCount(r)} de ${ALL_PERMS.length} módulos`
                      }
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost" size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-plum-800"
                          onClick={() => openEdit(r)}
                          disabled={r.name === 'owner'}
                          title={r.name === 'owner' ? 'El rol de dueño siempre tiene acceso total' : undefined}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost" size="icon"
                          className="w-7 h-7 text-muted-foreground hover:text-red-600"
                          onClick={() => deleteMutation.mutate(r.id)}
                          disabled={r.is_system || deleteMutation.isPending}
                          title={r.is_system ? 'Los roles del sistema no se pueden eliminar' : undefined}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {roles.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Shield className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin roles configurados</p>
            </div>
          )}
        </CardContent>
      </Card>
      <RoleModal open={modalOpen} onClose={closeModal} role={editing} tenantId={tenantId} />
    </div>
  )
}

// ── Services Tab ─────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'standard', label: 'Estándar' },
  { value: 'premium',  label: 'Premium' },
  { value: 'express',  label: 'Express' },
]

function ServiceModal({ open, onClose, service }: {
  open: boolean; onClose: () => void; service?: ServiceRow
}) {
  const createSvc = useCreateService()
  const updateSvc = useUpdateService()
  const [form, setForm] = useState<ServiceForm>(service ? serviceRowToForm(service) : EMPTY_SERVICE_FORM)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(service ? serviceRowToForm(service) : EMPTY_SERVICE_FORM)
      setError('')
    }
  }, [open, service])

  function set<K extends keyof ServiceForm>(k: K, v: ServiceForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return }
    if (form.price_60 !== '' && isNaN(parseFloat(form.price_60))) { setError('Precio 60min inválido.'); return }
    if (form.price_90 !== '' && isNaN(parseFloat(form.price_90))) { setError('Precio 90min inválido.'); return }
    setError('')
    try {
      if (service) {
        await updateSvc.mutateAsync({ id: service.id, form })
      } else {
        await createSvc.mutateAsync(form)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  const saving = createSvc.isPending || updateSvc.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">

          <div className="grid grid-cols-[72px_1fr] gap-3">
            <div className="space-y-1">
              <Label>Emoji</Label>
              <Input value={form.emoji} onChange={(e) => set('emoji', e.target.value)} placeholder="💆" className="text-center text-lg" maxLength={4} />
            </div>
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Masaje Relajante" />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Descripción</Label>
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Descripción opcional del servicio" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Precio 60min *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input type="number" min="0" step="0.01" value={form.price_60} onChange={(e) => set('price_60', e.target.value)} className="pl-7" placeholder="0" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Precio 90min <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <Input type="number" min="0" step="0.01" value={form.price_90} onChange={(e) => set('price_90', e.target.value)} className="pl-7" placeholder="0" />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Categoría</Label>
            <select
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div className="space-y-3 pt-1">
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">¿Requiere dos terapeutas?</span>
              <input type="checkbox" checked={form.requires_two_therapists} onChange={(e) => set('requires_two_therapists', e.target.checked)} className="w-4 h-4 accent-plum-700" />
            </label>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm">¿Disponible en membresías?</span>
              <input type="checkbox" checked={form.available_in_memberships} onChange={(e) => set('available_in_memberships', e.target.checked)} className="w-4 h-4 accent-plum-700" />
            </label>
            <div className="flex items-center justify-between">
              <span className="text-sm">Activo</span>
              <button
                type="button"
                onClick={() => set('active', !form.active)}
                className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', form.active ? 'bg-plum-700' : 'bg-gray-300')}
              >
                <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', form.active ? 'translate-x-5' : 'translate-x-0.5')} />
              </button>
            </div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {service ? 'Guardar cambios' : 'Crear servicio'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabServicios() {
  const { data: services = [], isLoading } = useAdminServices()
  const deleteSvc = useDeleteService()
  const updateSvc = useUpdateService()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing]     = useState<ServiceRow | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<ServiceRow | undefined>()
  const [deleteMsg, setDeleteMsg]       = useState('')
  const [toast, setToast]               = useState('')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 3000) }

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(s: ServiceRow) { setEditing(s); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

  async function handleToggleActive(s: ServiceRow) {
    await updateSvc.mutateAsync({ id: s.id, form: { ...serviceRowToForm(s), active: !s.active } })
    showToast(`"${s.name}" ${!s.active ? 'activado' : 'desactivado'}`)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteMsg('')
    try {
      const result = await deleteSvc.mutateAsync(deleteTarget.id)
      const name = deleteTarget.name
      setDeleteTarget(undefined)
      showToast(result === 'deleted' ? `"${name}" eliminado` : `"${name}" desactivado (tiene turnos asociados)`)
    } catch (e) {
      setDeleteMsg(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  const categoryLabel = (v: string | null) => CATEGORIES.find((c) => c.value === v)?.label ?? v ?? '—'

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  return (
    <div className="space-y-4">
      {toast && (
        <div className="flex items-center gap-2 bg-plum-50 border border-plum-200 rounded-md px-3 py-2.5">
          <Check className="w-4 h-4 text-plum-700 flex-shrink-0" />
          <p className="text-sm text-plum-800">{toast}</p>
        </div>
      )}

      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{services.length} servicio{services.length !== 1 ? 's' : ''} configurado{services.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />Nuevo servicio
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5 w-10"></th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Nombre</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">60min</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">90min</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Categoría</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Membresías</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className={cn('border-b last:border-0 hover:bg-gray-50/50', !s.active && 'opacity-50')}>
                  <td className="px-4 py-3 text-xl text-center">{s.emoji ?? ''}</td>
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-plum-800">{s.name}</p>
                    {s.description && <p className="text-xs text-muted-foreground truncate max-w-xs">{s.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-right text-sm">{s.price_60 != null ? `$${s.price_60.toLocaleString('es-AR')}` : '—'}</td>
                  <td className="px-4 py-3 text-right text-sm text-muted-foreground">{s.price_90 != null ? `$${s.price_90.toLocaleString('es-AR')}` : '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant="secondary" className="text-xs">{categoryLabel(s.category)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {s.available_in_memberships
                      ? <Check className="w-4 h-4 text-green-600 mx-auto" />
                      : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(s)}
                      disabled={updateSvc.isPending}
                      className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', s.active ? 'bg-plum-700' : 'bg-gray-300', updateSvc.isPending && 'opacity-50 cursor-not-allowed')}
                    >
                      <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', s.active ? 'translate-x-5' : 'translate-x-0.5')} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-plum-800" onClick={() => openEdit(s)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-600" onClick={() => { setDeleteTarget(s); setDeleteMsg('') }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {services.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Layers className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin servicios configurados</p>
            </div>
          )}
        </CardContent>
      </Card>

      <ServiceModal open={modalOpen} onClose={closeModal} service={editing} />

      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(undefined)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar servicio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {deleteMsg
              ? <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{deleteMsg}</p>
              : <p className="text-sm text-gray-700">¿Eliminar <strong>{deleteTarget?.name}</strong>? Si tiene turnos asociados, será desactivado en lugar de eliminado.</p>
            }
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(undefined)}>{deleteMsg ? 'Cerrar' : 'Cancelar'}</Button>
              {!deleteMsg && (
                <Button variant="destructive" onClick={handleDelete} disabled={deleteSvc.isPending}>
                  {deleteSvc.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Eliminar
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ConfiguracionAdmin({
  defaultTab,
  hideTabs,
}: {
  defaultTab?: AdminTab
  hideTabs?: boolean
} = {}) {
  const { profile } = useAuth()
  const [tab, setTab] = useState<AdminTab>(defaultTab ?? 'locales')

  if (profile?.role !== 'owner' && profile?.role !== 'partner_admin' && profile?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">No tenés permiso para acceder a esta sección.</p>
      </div>
    )
  }

  // /usuarios route: skip all tab logic and render TabUsuarios directly
  if (hideTabs) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Usuarios</h1>
          <p className="text-muted-foreground text-sm mt-1">Gestión de usuarios del sistema</p>
        </div>
        <TabUsuarios />
      </div>
    )
  }

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'
  const canSeeRoles = isOwner || profile?.role === 'partner_admin'

  const allTabs: { key: AdminTab; label: string; icon: ElementType; show: boolean }[] = [
    { key: 'locales',   label: 'Locales',          icon: Building2, show: isOwner },
    { key: 'usuarios',  label: 'Usuarios',          icon: Users,     show: true },
    { key: 'servicios', label: 'Servicios',         icon: Layers,    show: true },
    { key: 'roles',     label: 'Roles y Permisos',  icon: Shield,    show: canSeeRoles },
  ]

  const tabs = allTabs.filter((t) => t.show)

  // If the active tab is not available for this role, reset to usuarios
  const activeTab = tabs.find((t) => t.key === tab) ? tab : 'usuarios'

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">Gestión de locales, usuarios y permisos</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-0 -mb-px">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                activeTab === key
                  ? 'border-plum-700 text-plum-800'
                  : 'border-transparent text-muted-foreground hover:text-plum-700',
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'locales'   && <TabLocales />}
      {activeTab === 'usuarios'  && <TabUsuarios />}
      {activeTab === 'servicios' && <TabServicios />}
      {activeTab === 'roles'     && <TabRoles canEdit={isOwner} />}
    </div>
  )
}

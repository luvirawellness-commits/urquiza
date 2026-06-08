import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Loader2, Building2, Users, Shield, Check } from 'lucide-react'
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

type AdminTab = 'locales' | 'usuarios' | 'roles'

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
  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenants').select('*').order('name')
      if (error) throw error
      return data as Tenant[]
    },
  })
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Tenant | undefined>()

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
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />Nuevo local
        </Button>
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
    </div>
  )
}

// ── Usuarios Tab ──────────────────────────────────────────────────────────────

type UserWithTenants = UserProfile & {
  user_tenants?: { tenant_id: string; role: string; tenant?: { name: string } | null }[]
}

type UserForm = { full_name: string; email: string; color_hex: string }
type TenantAssignment = { tenant_id: string; role: string }

function UserModal({ open, onClose, user, allTenants, availableRoles }: {
  open: boolean; onClose: () => void; user?: UserWithTenants; allTenants: Tenant[]
  availableRoles: RoleRow[]
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

  async function handleSave() {
    if (!user) { setError('Buscá el usuario por email antes de editar.'); return }
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
      console.log('[UserModal] updating users:', updatePayload)

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
          <DialogTitle>{user ? 'Editar usuario' : 'Asignar usuario'}</DialogTitle>
        </DialogHeader>

        {!user ? (
          <div className="py-4 space-y-3">
            <p className="text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
              Para crear usuarios en Auth, usá el panel de Supabase → Authentication → Users, y luego asignalos acá buscándolos por email.
            </p>
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

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select(`*, user_tenants(tenant_id, role, tenants(name))`)
        .order('full_name')
      if (error) throw error
      return data as UserWithTenants[]
    },
    enabled: !!tenantId,
  })

  const { data: tenants = [] } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tenants').select('*').order('name')
      if (error) throw error
      return data as Tenant[]
    },
  })

  // FIX 1: use shared useRoles hook (avoids query key collision with TabRoles)
  const { data: roleRows = [] } = useRoles()
  const roleLabel = (roleName: string) => roleRows.find((r) => r.name === roleName)?.name ?? roleName

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<UserWithTenants | undefined>()

  function openEdit(u: UserWithTenants) { setEditing(u); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

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
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{users.length} usuarios registrados</p>
        <div className="flex items-center gap-2">
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
            Crear usuarios: Supabase → Authentication → Users
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Usuario</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Rol</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Locales</th>
                <th className="px-4 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
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
                        <p className="text-sm font-medium text-plum-800">{u.full_name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {/* FIX 1: show role label from roles table */}
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', ROLE_COLORS[u.role] ?? 'bg-gray-100 text-gray-700')}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.user_tenants?.map((ut) => (
                        <span key={ut.tenant_id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-plum-100 text-plum-700">
                          {(ut.tenant as { name: string } | null)?.name ?? ut.tenant_id.slice(0, 8)}
                        </span>
                      ))}
                      {(!u.user_tenants || u.user_tenants.length === 0) && (
                        <span className="text-xs text-muted-foreground">Sin locales</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-plum-800" onClick={() => openEdit(u)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
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
      <UserModal open={modalOpen} onClose={closeModal} user={editing} allTenants={tenants} availableRoles={roleRows} />
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

function TabRoles() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { data: roles = [], isLoading } = useRoles()

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
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />Nuevo rol
        </Button>
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
                    <div className="flex items-center gap-1">
                      {/* FIX 2: only owner is non-editable */}
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

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ConfiguracionAdmin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<AdminTab>('locales')

  if (profile?.role !== 'owner') {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Solo el propietario puede acceder a esta sección.</p>
      </div>
    )
  }

  const tabs: { key: AdminTab; label: string; icon: React.ElementType }[] = [
    { key: 'locales', label: 'Locales', icon: Building2 },
    { key: 'usuarios', label: 'Usuarios', icon: Users },
    { key: 'roles', label: 'Roles y Permisos', icon: Shield },
  ]

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
                tab === key
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

      {tab === 'locales' && <TabLocales />}
      {tab === 'usuarios' && <TabUsuarios />}
      {tab === 'roles' && <TabRoles />}
    </div>
  )
}

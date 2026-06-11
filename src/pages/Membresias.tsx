import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Loader2, Check, CreditCard } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { useServices } from '@/hooks/useAppointments'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Service } from '@/types'

type MembershipRow = {
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

type MembershipForm = {
  name: string
  price: string
  sessions_qty: string
  validity_days: string
  highlight_badge: string
  active: boolean
}

const EMPTY_MEMBERSHIP: MembershipForm = {
  name: '', price: '', sessions_qty: '', validity_days: '30', highlight_badge: '', active: true,
}

function membershipToForm(m: MembershipRow): MembershipForm {
  return {
    name: m.name,
    price: String(m.price),
    sessions_qty: String(m.sessions_qty),
    validity_days: String(m.validity_days),
    highlight_badge: m.highlight_badge ?? '',
    active: m.active,
  }
}

type ServiceOption = Pick<Service, 'id' | 'name' | 'emoji'>

function ServicesBadges({ plan, services }: { plan: MembershipRow; services: ServiceOption[] }) {
  if (plan.allowed_service_ids == null) {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Todos</span>
  }
  if (plan.allowed_service_ids.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const matched = plan.allowed_service_ids
    .map((id) => services.find((s) => s.id === id))
    .filter(Boolean) as Service[]
  const shown = matched.slice(0, 3)
  const extra = matched.length - shown.length
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((s) => (
        <span key={s.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-plum-100 text-plum-700">
          {s.emoji ? `${s.emoji} ` : ''}{s.name}
        </span>
      ))}
      {extra > 0 && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">+{extra} más</span>}
    </div>
  )
}

function MembershipModal({ open, onClose, plan, tenantId, services }: {
  open: boolean; onClose: () => void; plan?: MembershipRow
  tenantId: string; services: ServiceOption[]
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState<MembershipForm>(plan ? membershipToForm(plan) : EMPTY_MEMBERSHIP)
  const [serviceMode, setServiceMode] = useState<'all' | 'specific'>('all')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(plan ? membershipToForm(plan) : EMPTY_MEMBERSHIP)
      setError('')
      if (plan?.allowed_service_ids == null) {
        setServiceMode('all')
        setSelectedServiceIds([])
      } else {
        setServiceMode('specific')
        setSelectedServiceIds(plan.allowed_service_ids)
      }
    }
  }, [open, plan])

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id])
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return }
    if (!form.price || isNaN(parseFloat(form.price))) { setError('El precio es obligatorio.'); return }
    if (!form.sessions_qty || isNaN(parseInt(form.sessions_qty))) { setError('La cantidad de sesiones es obligatoria.'); return }
    if (!form.validity_days || isNaN(parseInt(form.validity_days))) { setError('Los días de vigencia son obligatorios.'); return }
    setError(''); setSaving(true)
    try {
      const payload = {
        tenant_id: tenantId,
        name: form.name.trim(),
        price: parseFloat(form.price),
        sessions_qty: parseInt(form.sessions_qty),
        validity_days: parseInt(form.validity_days),
        highlight_badge: form.highlight_badge.trim() || null,
        allowed_service_ids: serviceMode === 'all' ? null : selectedServiceIds,
        active: form.active,
      }
      if (plan) {
        const { error } = await supabase.from('memberships').update(payload).eq('id', plan.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('memberships').insert(payload)
        if (error) throw error
      }
      await qc.invalidateQueries({ queryKey: ['admin-memberships'] })
      await qc.invalidateQueries({ queryKey: ['membership-plans'] })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan ? 'Editar plan' : 'Nuevo plan'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Info básica</p>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Plan mensual" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Precio *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} className="pl-7" placeholder="0" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Sesiones incluidas *</Label>
                  <Input type="number" min="1" value={form.sessions_qty} onChange={(e) => setForm((f) => ({ ...f, sessions_qty: e.target.value }))} placeholder="8" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Días de vigencia *</Label>
                  <Input type="number" min="1" value={form.validity_days} onChange={(e) => setForm((f) => ({ ...f, validity_days: e.target.value }))} placeholder="30" />
                </div>
                <div className="space-y-1">
                  <Label>Badge destacado</Label>
                  <Input value={form.highlight_badge} onChange={(e) => setForm((f) => ({ ...f, highlight_badge: e.target.value }))} placeholder="El más popular" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Label>Activo</Label>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
                  className={cn('relative inline-flex h-5 w-9 items-center rounded-full transition-colors', form.active ? 'bg-plum-700' : 'bg-gray-300')}
                >
                  <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', form.active ? 'translate-x-5' : 'translate-x-0.5')} />
                </button>
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Servicios incluidos</p>
            <div className="flex gap-3 mb-3">
              <button
                onClick={() => setServiceMode('all')}
                className={cn('flex-1 py-2 px-3 rounded-md text-sm border transition-colors', serviceMode === 'all' ? 'border-plum-700 bg-plum-50 text-plum-800 font-medium' : 'border-gray-200 text-muted-foreground hover:border-plum-400')}
              >
                Todos los servicios
              </button>
              <button
                onClick={() => setServiceMode('specific')}
                className={cn('flex-1 py-2 px-3 rounded-md text-sm border transition-colors', serviceMode === 'specific' ? 'border-plum-700 bg-plum-50 text-plum-800 font-medium' : 'border-gray-200 text-muted-foreground hover:border-plum-400')}
              >
                Servicios específicos
              </button>
            </div>
            {serviceMode === 'specific' && (
              <div className="grid grid-cols-2 gap-2">
                {services.map((s) => {
                  const checked = selectedServiceIds.includes(s.id)
                  return (
                    <label key={s.id} className={cn('flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors', checked ? 'border-plum-400 bg-plum-50/40' : 'border-gray-200 hover:border-plum-300')}>
                      <input type="checkbox" checked={checked} onChange={() => toggleService(s.id)} className="w-4 h-4 accent-plum-700" />
                      <span className="text-sm">{s.emoji ? `${s.emoji} ` : ''}{s.name}</span>
                    </label>
                  )
                })}
                {services.length === 0 && <p className="text-sm text-muted-foreground col-span-2">No hay servicios activos.</p>}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {plan ? 'Guardar cambios' : 'Crear plan'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function Membresias() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { data: services = [] } = useServices()

  const { data: memberships = [], isLoading } = useQuery({
    queryKey: ['admin-memberships', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('memberships')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name')
      if (error) throw error
      return data as MembershipRow[]
    },
    enabled: !!tenantId,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from('memberships').update({ active }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-memberships'] }),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<MembershipRow | undefined>()
  const [deleteTarget, setDeleteTarget] = useState<MembershipRow | undefined>()
  const [deleteError, setDeleteError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  function showToast(msg: string) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(''), 3000)
  }

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(m: MembershipRow) { setEditing(m); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

  async function handleToggle(m: MembershipRow) {
    const newActive = !m.active
    await toggleMutation.mutateAsync({ id: m.id, active: newActive })
    showToast(`Plan "${m.name}" ${newActive ? 'activado' : 'desactivado'}`)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    try {
      const { count, error } = await supabase
        .from('client_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('membership_id', deleteTarget.id)
        .eq('status', 'active')
      if (error) throw error
      if ((count ?? 0) > 0) {
        setDeleteError(`No se puede eliminar este plan porque tiene ${count} membresía${count === 1 ? '' : 's'} activa${count === 1 ? '' : 's'}. Desactivalo en su lugar.`)
        return
      }
      const { error: delErr } = await supabase.from('memberships').delete().eq('id', deleteTarget.id)
      if (delErr) throw delErr
      await qc.invalidateQueries({ queryKey: ['admin-memberships'] })
      await qc.invalidateQueries({ queryKey: ['membership-plans'] })
      const name = deleteTarget.name
      setDeleteTarget(undefined)
      showToast(`Plan "${name}" eliminado`)
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : 'Error al eliminar')
    } finally {
      setDeleting(false)
    }
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Membresías</h1>
        <p className="text-muted-foreground text-sm mt-1">Planes y precios de membresías</p>
      </div>

      <div className="space-y-4">
        {toastMsg && (
          <div className="flex items-center gap-2 bg-plum-50 border border-plum-200 rounded-md px-3 py-2.5">
            <Check className="w-4 h-4 text-plum-700 flex-shrink-0" />
            <p className="text-sm text-plum-800">{toastMsg}</p>
          </div>
        )}
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">{memberships.length} planes configurados</p>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" />Nuevo plan
          </Button>
        </div>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Nombre del plan</th>
                  <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Precio</th>
                  <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Sesiones</th>
                  <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Vigencia</th>
                  <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Servicios</th>
                  <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-plum-800">{m.name}</p>
                      {m.highlight_badge && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-gold-100 text-gold-800 mt-0.5">{m.highlight_badge}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">${m.price.toLocaleString('es-AR')}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{m.sessions_qty}</td>
                    <td className="px-4 py-3 text-center text-sm text-gray-600">{m.validity_days}d</td>
                    <td className="px-4 py-3"><ServicesBadges plan={m} services={services} /></td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggle(m)}
                        disabled={toggleMutation.isPending}
                        className={cn(
                          'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                          m.active ? 'bg-plum-700' : 'bg-gray-300',
                          toggleMutation.isPending && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        <span className={cn('inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform', m.active ? 'translate-x-5' : 'translate-x-0.5')} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-plum-800" onClick={() => openEdit(m)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-600" onClick={() => { setDeleteTarget(m); setDeleteError('') }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {memberships.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Sin planes configurados</p>
              </div>
            )}
          </CardContent>
        </Card>

        <MembershipModal open={modalOpen} onClose={closeModal} plan={editing} tenantId={tenantId} services={services} />

        <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(undefined)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Eliminar plan</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              {deleteError ? (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2.5">{deleteError}</p>
              ) : (
                <p className="text-sm text-gray-700">¿Eliminar el plan <strong>{deleteTarget?.name}</strong>? Esta acción no se puede deshacer.</p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteTarget(undefined)}>{deleteError ? 'Cerrar' : 'Cancelar'}</Button>
                {!deleteError && (
                  <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
                    {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Eliminar
                  </Button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Loader2, Check, CreditCard, ChevronDown, ChevronUp } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { useServices } from '@/hooks/useAppointments'
import {
  useTenantActiveMemberships,
  useTenantExpiredMemberships,
  useMembershipSessions,
  type TenantMembershipRow,
} from '@/hooks/useClientMemberships'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Service } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────

type MemTab = 'planes' | 'vigentes' | 'historial'

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function fullName(c: { first_name: string; last_name?: string | null } | null): string {
  if (!c) return '—'
  return [c.first_name, c.last_name].filter(Boolean).join(' ')
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function daysRemaining(expiresAt: string | null): number | null {
  if (!expiresAt) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiresAt + 'T00:00:00')
  return Math.ceil((exp.getTime() - today.getTime()) / 86400000)
}

// ── Plan management components (existing) ─────────────────────────────────────

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

// ── Session history panel (lazy-loaded on expand) ─────────────────────────────

function SessionsPanel({ membershipId }: { membershipId: string }) {
  const { data: sessions = [], isLoading } = useMembershipSessions(membershipId)

  if (isLoading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (sessions.length === 0) {
    return <p className="text-xs text-muted-foreground py-2 italic">Sin sesiones registradas.</p>
  }

  return (
    <div className="space-y-0">
      {sessions.map((s) => (
        <div key={s.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-100 last:border-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-muted-foreground flex-shrink-0">
              {new Date(s.scheduled_at).toLocaleDateString('es-AR', {
                timeZone: 'America/Argentina/Buenos_Aires',
                day: '2-digit', month: '2-digit', year: '2-digit',
              })}
            </span>
            <span className="font-medium text-gray-700 truncate">{fullName(s.client)}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground flex-shrink-0">
            <span>{s.service?.emoji ? `${s.service.emoji} ` : ''}{s.service?.name ?? '—'}</span>
            <span className="text-gray-400">·</span>
            <span>{s.therapist?.full_name ?? '—'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Membership card (Vigentes + Historial) ────────────────────────────────────

function MembershipCard({ cm, expired = false }: { cm: TenantMembershipRow; expired?: boolean }) {
  const [showSessions, setShowSessions] = useState(false)
  const sessionsTotal = cm.plan?.sessions_qty ?? 0
  const sessionsUsed = cm.sessions_used ?? 0
  const pct = sessionsTotal > 0 ? Math.min(100, (sessionsUsed / sessionsTotal) * 100) : 0
  const days = daysRemaining(cm.expires_at)
  const isUrgent = !expired && days !== null && days <= 7

  const expiredBadge = expired
    ? (sessionsTotal > 0 && sessionsUsed >= sessionsTotal ? 'Agotada' : 'Vencida')
    : null

  // Unique beneficiaries excluding the titular
  const extraBeneficiaries = (cm.beneficiaries ?? []).filter((b) => b.client_id !== cm.client_id)

  return (
    <Card className={cn('overflow-hidden transition-opacity', expired && 'opacity-75')}>
      <CardContent className="p-4 space-y-3">

        {/* Header: titular + plan + badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-plum-800 truncate">{fullName(cm.client)}</p>
            <p className="text-xs text-muted-foreground truncate">{cm.plan?.name ?? '—'}</p>
          </div>
          {expiredBadge ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 flex-shrink-0">
              {expiredBadge}
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 flex-shrink-0">
              Vigente
            </span>
          )}
        </div>

        {/* Sessions progress bar */}
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Sesiones</span>
            <span className="font-medium tabular-nums">
              {sessionsUsed} / {sessionsTotal > 0 ? sessionsTotal : '∞'}
            </span>
          </div>
          <div className="bg-gray-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', expired ? 'bg-gray-400' : 'bg-plum-600')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div>
            <p className="text-muted-foreground">Comprada</p>
            <p className="font-medium">{cm.purchased_at ? formatDate(cm.purchased_at) : '—'}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{expired ? 'Venció' : 'Vence'}</p>
            <p className={cn('font-medium', isUrgent && 'text-red-600')}>
              {cm.expires_at ? formatDate(cm.expires_at) : '—'}
              {!expired && days !== null && (
                <span className={cn('ml-1', isUrgent ? 'text-red-500' : 'text-muted-foreground')}>
                  ({days}d)
                </span>
              )}
            </p>
          </div>
          {cm.amount_paid !== null && (
            <div>
              <p className="text-muted-foreground">Pagado</p>
              <p className="font-medium">${cm.amount_paid.toLocaleString('es-AR')}</p>
            </div>
          )}
          {cm.payment_method && (
            <div>
              <p className="text-muted-foreground">Método</p>
              <p className="font-medium capitalize">{cm.payment_method}</p>
            </div>
          )}
        </div>

        {/* Beneficiaries (extra, excluding titular) */}
        {extraBeneficiaries.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Beneficiarios</p>
            <div className="flex flex-wrap gap-1">
              {extraBeneficiaries.map((b) => (
                <span key={b.id} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-plum-50 text-plum-700">
                  {fullName(b.client)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Sessions expandable */}
        <div className="border-t border-gray-100 pt-2">
          <button
            onClick={() => setShowSessions((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-plum-700 transition-colors w-full"
          >
            {showSessions ? <ChevronUp className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" />}
            <span>Sesiones utilizadas ({sessionsUsed})</span>
          </button>
          {showSessions && (
            <div className="mt-2">
              <SessionsPanel membershipId={cm.id} />
            </div>
          )}
        </div>

      </CardContent>
    </Card>
  )
}

// ── Tab: Vigentes ─────────────────────────────────────────────────────────────

function TabVigentes() {
  const { data: memberships = [], isLoading } = useTenantActiveMemberships()

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  if (memberships.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Sin membresías vigentes</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {memberships.length} membresía{memberships.length !== 1 ? 's' : ''} vigente{memberships.length !== 1 ? 's' : ''}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {memberships.map((cm) => (
          <MembershipCard key={cm.id} cm={cm} />
        ))}
      </div>
    </div>
  )
}

// ── Tab: Historial ────────────────────────────────────────────────────────────

function TabHistorial() {
  const { data: memberships = [], isLoading } = useTenantExpiredMemberships()

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
  }

  if (memberships.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <CreditCard className="w-10 h-10 mx-auto mb-2 opacity-30" />
        <p className="text-sm">Sin membresías en el historial</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {memberships.length} membresía{memberships.length !== 1 ? 's' : ''} en historial
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {memberships.map((cm) => (
          <MembershipCard key={cm.id} cm={cm} expired />
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Membresias() {
  const tenantId = useTenantId()
  const qc = useQueryClient()
  const { data: services = [] } = useServices()
  const [tab, setTab] = useState<MemTab>('planes')

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

  const tabs: { key: MemTab; label: string }[] = [
    { key: 'planes',    label: 'Planes' },
    { key: 'vigentes',  label: 'Vigentes' },
    { key: 'historial', label: 'Historial' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Membresías</h1>
        <p className="text-muted-foreground text-sm mt-1">Planes, membresías vigentes e historial</p>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
              tab === t.key
                ? 'border-plum-700 text-plum-800'
                : 'border-transparent text-muted-foreground hover:text-gray-700 hover:border-gray-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Planes */}
      {tab === 'planes' && (
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
              {isLoading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
              ) : (
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
              )}
              {!isLoading && memberships.length === 0 && (
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
      )}

      {/* Tab: Vigentes */}
      {tab === 'vigentes' && <TabVigentes />}

      {/* Tab: Historial */}
      {tab === 'historial' && <TabHistorial />}
    </div>
  )
}

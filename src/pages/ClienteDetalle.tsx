import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Phone, Mail, Calendar, Hash, Loader2,
  CreditCard, Plus, Users, History, DollarSign, Gift,
} from 'lucide-react'
import { useClient } from '@/hooks/useClients'
import { useClients } from '@/hooks/useClients'
import { useClientActiveMemberships, useAddBeneficiary } from '@/hooks/useClientMemberships'
import { useClientAppointments } from '@/hooks/useAppointments'
import { useClientTransactions } from '@/hooks/useFinanzas'
import { useClientGiftCards } from '@/hooks/useGiftCards'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { cn, formatDate, formatCurrency, formatTime } from '@/lib/utils'
import VenderMembresiaModal from '@/components/VenderMembresiaModal'
import type { ClientMembership } from '@/types'

const STATUS_LABELS: Record<string, string> = {
  active: 'Activo',
  at_risk: 'En riesgo',
  inactive: 'Inactivo',
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'destructive'> = {
  active: 'success',
  at_risk: 'warning',
  inactive: 'destructive',
}

const SOURCE_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  google: 'Google',
  referral: 'Referido',
  whatsapp: 'WhatsApp',
  in_person: 'Presencial',
  other: 'Otro',
}

// ── AgregarBeneficiarioModal ──────────────────────────────────────────────────

function AgregarBeneficiarioModal({
  membershipId, membership, onClose,
}: {
  membershipId: string
  membership: ClientMembership
  onClose: () => void
}) {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [showDrop, setShowDrop] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: clients } = useClients(search.length >= 2 ? search : undefined)
  const addBeneficiary = useAddBeneficiary()

  const existingIds = new Set([
    membership.client_id,
    ...(membership.beneficiaries ?? []).map((b) => b.client_id),
  ])

  async function handleAdd(clientId: string) {
    if (!user) return
    setError(null)
    try {
      await addBeneficiary.mutateAsync({ membershipId, clientId, addedBy: user.id })
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Error al agregar beneficiario')
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-4 h-4" /> Agregar beneficiario
          </DialogTitle>
          <DialogDescription>
            Membresía {membership.plan?.name ?? ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="relative">
            <Label className="text-xs mb-1 block">Buscar cliente</Label>
            <Input
              placeholder="Nombre o teléfono..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setShowDrop(true) }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
            />
            {showDrop && clients && clients.length > 0 && (
              <div className="absolute z-20 w-full bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                {clients
                  .filter((c) => !existingIds.has(c.id))
                  .slice(0, 8)
                  .map((c) => (
                    <button key={c.id} type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-plum-50 hover:text-plum-800 border-b last:border-b-0"
                      onMouseDown={() => handleAdd(c.id)}>
                      <p className="font-medium">{c.first_name} {c.last_name}</p>
                      {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                    </button>
                  ))}
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {addBeneficiary.isPending && (
            <div className="flex justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}
          <Button variant="outline" onClick={onClose} className="w-full">Cancelar</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── MembershipsSection ────────────────────────────────────────────────────────

function MembershipsSection({ clientId }: { clientId: string }) {
  const [showVender, setShowVender] = useState(false)
  const [addBenMembership, setAddBenMembership] = useState<ClientMembership | null>(null)

  const { data: memberships, isLoading } = useClientActiveMemberships(clientId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="w-4 h-4" /> Membresías activas
          </CardTitle>
          <Button size="sm" variant="outline"
            className="h-7 text-xs gap-1 px-2.5 border-plum-200 text-plum-800 hover:bg-plum-50"
            onClick={() => setShowVender(true)}>
            <Plus className="w-3.5 h-3.5" /> Nueva membresía
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !memberships || memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin membresías activas</p>
        ) : (
          <div className="space-y-3">
            {memberships.map((m) => {
              const sessionsTotal = m.plan?.sessions_qty ?? 0
              const sessionsUsed = m.sessions_used ?? 0
              const sessionsLeft = Math.max(0, sessionsTotal - sessionsUsed)
              const isTitular = m.client_id === clientId
              const bens = m.beneficiaries ?? []

              return (
                <div key={m.id}
                  className="border rounded-xl p-3 space-y-2 bg-white">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm text-plum-800">
                        {m.plan?.name ?? 'Membresía'}
                      </p>
                      {!isTitular && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 mt-0.5">
                          Beneficiario
                        </Badge>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-xs shrink-0',
                        sessionsLeft > 0 ? 'border-green-300 text-green-700' : 'border-red-300 text-red-700',
                      )}
                    >
                      {sessionsLeft}/{sessionsTotal} ses.
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>Vence {m.expires_at ? formatDate(m.expires_at) : '—'}</span>
                    {m.amount_paid && (
                      <span>{formatCurrency(m.amount_paid)}</span>
                    )}
                  </div>

                  {bens.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {bens.map((b) => (
                        <span key={b.client_id}
                          className="inline-flex items-center gap-1 bg-plum-50 text-plum-700 text-xs px-2 py-0.5 rounded-full">
                          {b.client?.first_name ?? '?'} {b.client?.last_name ?? ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {isTitular && (
                    <Button size="sm" variant="outline"
                      className="h-6 text-xs gap-1 px-2 mt-1"
                      onClick={() => setAddBenMembership(m)}>
                      <Users className="w-3 h-3" /> Agregar beneficiario
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {showVender && (
        <VenderMembresiaModal
          open={showVender}
          onClose={() => setShowVender(false)}
          preSelectedClientId={clientId}
        />
      )}

      {addBenMembership && (
        <AgregarBeneficiarioModal
          membershipId={addBenMembership.id}
          membership={addBenMembership}
          onClose={() => setAddBenMembership(null)}
        />
      )}
    </Card>
  )
}

// ── Status config shared ──────────────────────────────────────────────────────

const APPT_STATUS_LABEL: Record<string, string> = {
  completed: 'Completado',
  cancelled: 'Cancelado',
  no_show: 'No se presentó',
  confirmed: 'Confirmado',
  pending: 'Pendiente',
  blocked: 'Bloqueado',
}

const APPT_STATUS_CLASS: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-orange-100 text-orange-700',
  confirmed: 'bg-blue-100 text-blue-700',
  pending: 'bg-gray-100 text-gray-600',
  blocked: 'bg-slate-100 text-slate-600',
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
  qr: 'QR',
  mp: 'Mercado Pago',
  debit: 'Débito',
  credit: 'Crédito',
}

// ── AppointmentsSection ───────────────────────────────────────────────────────

function AppointmentsSection({ clientId }: { clientId: string }) {
  const { data: appointments, isLoading } = useClientAppointments(clientId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <History className="w-4 h-4" /> Historial de turnos
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !appointments || appointments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin turnos registrados</p>
        ) : (
          <div className="space-y-2">
            {appointments.map((a) => (
              <div key={a.id}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-plum-800 truncate">
                    {a.service?.emoji ? `${a.service.emoji} ` : ''}{a.service?.name ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(a.scheduled_at)} · {formatTime(a.scheduled_at)}
                    {a.therapist?.full_name ? ` · ${a.therapist.full_name}` : ''}
                    {` · ${a.duration_minutes} min`}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {a.price_charged != null && (
                    <span className="text-sm font-medium text-plum-800">
                      {formatCurrency(a.price_charged)}
                    </span>
                  )}
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded-full',
                    APPT_STATUS_CLASS[a.status] ?? 'bg-gray-100 text-gray-600',
                  )}>
                    {APPT_STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── TransactionsSection ───────────────────────────────────────────────────────

function TransactionsSection({ clientId }: { clientId: string }) {
  const { data: transactions, isLoading } = useClientTransactions(clientId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="w-4 h-4" /> Transacciones
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin transacciones registradas</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((t) => (
              <div key={t.id}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.date)}
                    {t.payment_method
                      ? ` · ${PAYMENT_METHOD_LABEL[t.payment_method] ?? t.payment_method}`
                      : ''}
                  </p>
                </div>
                <span className={cn(
                  'text-sm font-semibold flex-shrink-0',
                  t.type === 'income' ? 'text-green-700' : 'text-red-600',
                )}>
                  {t.type === 'income' ? '+' : '-'}{formatCurrency(t.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── GiftCardsSection ──────────────────────────────────────────────────────────

const GC_STATUS_LABEL: Record<string, string> = {
  active: 'Activa',
  used: 'Usada',
  expired: 'Vencida',
}

const GC_STATUS_CLASS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  used: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-700',
}

function GiftCardsSection({ clientId }: { clientId: string }) {
  const { data: giftCards, isLoading } = useClientGiftCards(clientId)

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Gift className="w-4 h-4" /> Gift Cards
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : !giftCards || giftCards.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">Sin gift cards registradas</p>
        ) : (
          <div className="space-y-2">
            {giftCards.map((gc) => (
              <div key={gc.id}
                className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium font-mono text-plum-800">{gc.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {gc.service?.emoji ? `${gc.service.emoji} ` : ''}{gc.service?.name ?? '—'}
                    {gc.sold_at ? ` · Vendida ${formatDate(gc.sold_at)}` : ''}
                    {gc.used_at ? ` · Usada ${formatDate(gc.used_at)}` : ''}
                    {!gc.used_at && gc.expires_at ? ` · Vence ${formatDate(gc.expires_at)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm font-semibold text-plum-800">
                    {formatCurrency(gc.amount)}
                  </span>
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded-full',
                    GC_STATUS_CLASS[gc.status] ?? 'bg-gray-100 text-gray-600',
                  )}>
                    {GC_STATUS_LABEL[gc.status] ?? gc.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ClienteDetalle() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data: client, isLoading, isError } = useClient(id!)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
      </div>
    )
  }

  if (isError || !client) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-2" /> Volver
        </Button>
        <div className="text-center py-16 text-destructive">
          <p className="font-medium">No se pudo cargar el cliente</p>
          <p className="text-sm mt-1 text-muted-foreground">Verificá tu conexión e intentá de nuevo</p>
        </div>
      </div>
    )
  }

  const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || client.full_name || '—'
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const status = client.status ?? 'active'

  return (
    <div className="p-6 space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="text-xl font-bold text-plum-800">Perfil del cliente</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-plum-100 flex items-center justify-center flex-shrink-0">
              <span className="text-plum-800 font-bold text-xl">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-plum-800">{name}</h2>
              <p className="text-sm text-muted-foreground">Cliente desde {formatDate(client.created_at)}</p>
            </div>
            <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'}>
              {STATUS_LABELS[status] ?? status}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contacto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {client.phone ? (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span>{client.phone}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin teléfono</p>
            )}
            {client.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground" />
                <span className="truncate">{client.email}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Actividad</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground" />
              <span>Última visita: {client.last_visit_at ? formatDate(client.last_visit_at) : 'Sin visitas'}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Hash className="w-4 h-4 text-muted-foreground" />
              <span>{client.total_sessions ?? 0} sesiones totales</span>
            </div>
          </CardContent>
        </Card>

        {(client.source || client.wa_opt_in !== undefined) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Captación</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {client.source && <p>Canal: {SOURCE_LABELS[client.source] ?? client.source}</p>}
              <p>WhatsApp: {client.wa_opt_in ? 'Suscripto' : 'No suscripto'}</p>
            </CardContent>
          </Card>
        )}

        {client.notes && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Notas</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{client.notes}</p>
            </CardContent>
          </Card>
        )}
      </div>

      <MembershipsSection clientId={client.id} />
      <AppointmentsSection clientId={client.id} />
      <TransactionsSection clientId={client.id} />
      <GiftCardsSection clientId={client.id} />
    </div>
  )
}

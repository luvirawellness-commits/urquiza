import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, UserPlus, Phone, ChevronRight, Loader2, Users } from 'lucide-react'
import { useClients, useCreateClient } from '@/hooks/useClients'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/utils'
import { Client } from '@/types'

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

const CANAL_OPTIONS = [
  { value: '', label: 'Seleccionar canal...' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'google', label: 'Google' },
  { value: 'referral', label: 'Referido' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'in_person', label: 'Presencial' },
  { value: 'other', label: 'Otro' },
]

function clientName(client: Client) {
  if (client.first_name) {
    return [client.first_name, client.last_name].filter(Boolean).join(' ')
  }
  return client.full_name ?? '—'
}

type FormState = {
  first_name: string
  last_name: string
  phone: string
  email: string
  source: string
  notes: string
}

function NewClientDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createClient = useCreateClient()
  const [form, setForm] = useState<FormState>({
    first_name: '', last_name: '', phone: '', email: '', source: '', notes: '',
  })
  const [error, setError] = useState<string | null>(null)

  function field(key: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await createClient.mutateAsync({
        first_name: form.first_name,
        last_name: form.last_name || undefined,
        phone: form.phone,
        email: form.email || undefined,
        source: (form.source as Client['source']) || undefined,
        notes: form.notes || undefined,
      })
      setForm({ first_name: '', last_name: '', phone: '', email: '', source: '', notes: '' })
      onClose()
    } catch {
      setError('No se pudo guardar el cliente. Intentá de nuevo.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo Cliente</DialogTitle>
          <DialogDescription>Completá los datos del nuevo cliente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Nombre *</Label>
              <Input value={form.first_name} onChange={field('first_name')} required placeholder="María" />
            </div>
            <div className="space-y-1.5">
              <Label>Apellido</Label>
              <Input value={form.last_name} onChange={field('last_name')} placeholder="González" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Teléfono *</Label>
            <Input value={form.phone} onChange={field('phone')} required placeholder="+54 11 1234-5678" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={field('email')} placeholder="cliente@email.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Canal</Label>
            <select
              value={form.source}
              onChange={field('source')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CANAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Notas</Label>
            <Input value={form.notes} onChange={field('notes')} placeholder="Observaciones opcionales" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={createClient.isPending}>
              {createClient.isPending
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                : 'Guardar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function Clientes() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: clients, isLoading, isError } = useClients(search)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Clientes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {clients?.length ?? 0} cliente{(clients?.length ?? 0) !== 1 ? 's' : ''} registrado{(clients?.length ?? 0) !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="flex items-center gap-2">
          <UserPlus className="w-4 h-4" />
          <span className="hidden sm:inline">Nuevo Cliente</span>
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre o teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 text-destructive">
          <p className="font-medium">Error al cargar los clientes</p>
          <p className="text-sm mt-1 text-muted-foreground">Verificá tu conexión e intentá de nuevo</p>
        </div>
      ) : clients?.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No se encontraron clientes</p>
          {search && <p className="text-sm mt-1">Intentá con otro término de búsqueda</p>}
        </div>
      ) : (
        <div className="rounded-lg border divide-y overflow-hidden">
          {clients?.map((client) => {
            const name = clientName(client)
            const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
            const status = client.status ?? 'active'
            return (
              <div
                key={client.id}
                onClick={() => navigate(`/clientes/${client.id}`)}
                className="flex items-center gap-4 px-4 py-3.5 bg-white hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-plum-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-plum-800 font-semibold text-xs">{initials}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-plum-800 text-sm truncate">{name}</p>
                  {client.phone && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{client.phone}</span>
                    </div>
                  )}
                </div>
                <div className="hidden sm:flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                  <span>{client.last_visit_at ? formatDate(client.last_visit_at) : 'Sin visitas'}</span>
                  <span>{client.total_sessions ?? 0} sesiones</span>
                </div>
                <Badge variant={STATUS_VARIANTS[status] ?? 'secondary'} className="text-xs flex-shrink-0">
                  {STATUS_LABELS[status] ?? status}
                </Badge>
                <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            )
          })}
        </div>
      )}

      <NewClientDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}

import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Phone, Mail, Calendar, Hash, Loader2 } from 'lucide-react'
import { useClient } from '@/hooks/useClients'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

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
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
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
    </div>
  )
}

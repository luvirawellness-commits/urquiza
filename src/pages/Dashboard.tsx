import { useState, useMemo } from 'react'
import {
  Users,
  CalendarCheck,
  TrendingUp,
  CreditCard,
  ArrowRight,
  AlertTriangle,
  Clock,
  Zap,
  Link2,
  ExternalLink,
  Copy,
  Check,
  Globe,
  CalendarDays,
  Percent,
  DollarSign,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useAuth } from '@/contexts/AuthContext'
import {
  useDashboardMetrics,
  useTodayAgenda,
  useDashboardAlerts,
  useReservasOnline,
} from '@/hooks/useFinanzas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import type { AppointmentStatus } from '@/types'

const TZ = 'America/Argentina/Buenos_Aires'

type DashTab = 'resumen' | 'reservas'

function formatApptTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function daysSince(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Sin visitas'
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000)
  return `Hace ${days} día${days !== 1 ? 's' : ''}`
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-gray-200', className)} />
}

const STATUS_CONFIG: Record<AppointmentStatus, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'bg-gray-400 text-white border-transparent' },
  confirmed: { label: 'Confirmado', cls: 'bg-blue-500 text-white border-transparent' },
  completed: { label: 'Completado', cls: 'bg-green-500 text-white border-transparent' },
  cancelled: { label: 'Cancelado', cls: 'bg-red-500 text-white border-transparent' },
  no_show: { label: 'No vino', cls: 'bg-yellow-500 text-white border-transparent' },
  blocked: { label: 'Bloqueado', cls: 'bg-gray-300 text-gray-700 border-transparent' },
}

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { label, cls } = STATUS_CONFIG[status] ?? { label: status, cls: '' }
  return <Badge className={cls}>{label}</Badge>
}

interface MetricCardProps {
  title: string
  value: string | number
  icon: React.ElementType
  description: string
  color: string
  isLoading?: boolean
}

function MetricCard({ title, value, icon: Icon, description, color, isLoading }: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-24 mb-1" />
        ) : (
          <div className="text-2xl font-bold text-plum-800">{value}</div>
        )}
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

// ── Reservas Online tab ───────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ })
}
function monthStartStr() {
  return todayStr().slice(0, 7) + '-01'
}

function fmtAxisDate(dateStr: string) {
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

function TabReservasOnline() {
  const [dateFrom, setDateFrom] = useState(monthStartStr)
  const [dateTo, setDateTo] = useState(todayStr)

  const { data, isLoading } = useReservasOnline(dateFrom, dateTo)

  const totals = useMemo(() => {
    if (!data) return null
    const totalOnline = data.filter((r) => r.source === 'web').length
    const totalManual = data.filter((r) => r.source !== 'web').length
    const total = data.length
    const pctOnline = total > 0 ? Math.round((totalOnline / total) * 100) : 0
    const ingresoOnline = data
      .filter((r) => r.source === 'web' && r.status === 'completed')
      .reduce((s, r) => s + (r.price_charged ?? 0), 0)
    return { totalOnline, totalManual, total, pctOnline, ingresoOnline }
  }, [data])

  const chartData = useMemo(() => {
    if (!data) return []
    const map: Record<string, { date: string; online: number; manual: number }> = {}
    for (const row of data) {
      const date = row.created_at.slice(0, 10)
      if (!map[date]) map[date] = { date, online: 0, manual: 0 }
      if (row.source === 'web') map[date].online++
      else map[date].manual++
    }
    return Object.values(map)
  }, [data])

  const tableData = useMemo(
    () =>
      [...chartData]
        .reverse()
        .slice(0, 10)
        .map((row) => ({ ...row, total: row.online + row.manual })),
    [chartData],
  )

  const summaryCards = [
    {
      title: 'Reservas online',
      value: totals?.totalOnline ?? 0,
      icon: Globe,
      description: 'Hechas por los clientes via web',
      color: 'bg-gold-500',
    },
    {
      title: 'Reservas manuales',
      value: totals?.totalManual ?? 0,
      icon: CalendarDays,
      description: 'Ingresadas por el staff',
      color: 'bg-plum-600',
    },
    {
      title: 'Porcentaje online',
      value: `${totals?.pctOnline ?? 0}%`,
      icon: Percent,
      description: 'Del total de reservas del período',
      color: 'bg-plum-800',
    },
    {
      title: 'Ingresos online',
      value: formatCurrency(totals?.ingresoOnline ?? 0),
      icon: DollarSign,
      description: 'De sesiones completadas vía web',
      color: 'bg-gold-600',
    },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Date range filter */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Desde</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-plum-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Hasta</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-plum-600"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <MetricCard key={card.title} {...card} isLoading={isLoading} />
        ))}
      </div>

      {/* Bar chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-plum-800">
            Reservas por día
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Sin datos para el período seleccionado
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtAxisDate}
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  labelFormatter={(v) => `Fecha: ${fmtAxisDate(v as string)}`}
                  formatter={(value, name) => [value, name === 'online' ? 'Online (web)' : 'Manual']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 12 }}
                />
                <Legend
                  formatter={(value) => (value === 'online' ? 'Online (web)' : 'Manual')}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="online" fill="#C9A227" radius={[3, 3, 0, 0]} maxBarSize={40} />
                <Bar dataKey="manual" fill="#9CA3AF" radius={[3, 3, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Breakdown table */}
      {tableData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-plum-800">
              Detalle por día{' '}
              <span className="text-xs font-normal text-muted-foreground">(últimos 10 días con actividad)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left">
                    <th className="px-4 py-2.5 font-medium text-muted-foreground">Fecha</th>
                    <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Online</th>
                    <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Manual</th>
                    <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row) => (
                    <tr key={row.date} className="border-b hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-plum-700">
                        {new Date(row.date + 'T12:00:00').toLocaleDateString('es-AR', {
                          weekday: 'short',
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="font-semibold text-gold-600">{row.online}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">{row.manual}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-plum-800">{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { profile, currentTenant } = useAuth()
  const { data: metrics, isLoading: metricsLoading } = useDashboardMetrics()
  const { data: agenda, isLoading: agendaLoading } = useTodayAgenda()
  const { data: alerts, isLoading: alertsLoading } = useDashboardAlerts()
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState<DashTab>('resumen')

  const bookingUrl = currentTenant?.slug
    ? `https://luviraos.com/reservar/${currentTenant.slug}`
    : null

  function copyBookingLink() {
    if (!bookingUrl) return
    navigator.clipboard.writeText(bookingUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const greeting = () => {
    const h = parseInt(
      new Date().toLocaleString('en', { timeZone: TZ, hour: 'numeric', hour12: false }),
    )
    if (h < 12) return 'Buenos días'
    if (h < 18) return 'Buenas tardes'
    return 'Buenas noches'
  }

  const isReceptionist = profile?.role === 'receptionist'

  const metricCards = [
    {
      title: 'Sesiones hoy',
      value: metrics?.sesionesHoy ?? 0,
      icon: CalendarCheck,
      description: 'Sesiones completadas hoy',
      color: 'bg-gold-500',
    },
    ...(!isReceptionist ? [{
      title: 'Facturación del mes',
      value: formatCurrency(metrics?.billingThisMonth ?? 0),
      icon: TrendingUp,
      description: 'Ingresos cobrados este mes',
      color: 'bg-plum-600',
    }] : []),
    {
      title: 'Clientes activos',
      value: metrics?.activeClients ?? 0,
      icon: Users,
      description: 'Clientes con estado activo',
      color: 'bg-plum-800',
    },
    {
      title: 'Membresías activas',
      value: metrics?.activeMemberships ?? 0,
      icon: CreditCard,
      description: 'Membresías vigentes',
      color: 'bg-gold-600',
    },
  ]

  const hasAlerts =
    (alerts?.atRiskClients.length ?? 0) > 0 ||
    (alerts?.expiringMemberships.length ?? 0) > 0 ||
    (alerts?.lowSessionMemberships.length ?? 0) > 0

  const tabs: { key: DashTab; label: string }[] = [
    { key: 'resumen',  label: 'Resumen' },
    { key: 'reservas', label: 'Reservas Online' },
  ]

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="px-6 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-plum-800">
          {greeting()}, {profile?.full_name?.split(' ')[0] ?? 'bienvenida'} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {new Date().toLocaleDateString('es-AR', {
            timeZone: TZ,
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200 px-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.key
                ? 'border-plum-800 text-plum-800'
                : 'border-transparent text-muted-foreground hover:text-plum-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Resumen */}
      {activeTab === 'resumen' && (
        <div className="p-6 space-y-8">
          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {metricCards.map((card) => (
              <MetricCard key={card.title} {...card} isLoading={metricsLoading} />
            ))}
          </div>

          {/* Booking link widget */}
          {bookingUrl && (
            <Card className="border-plum-200 bg-gradient-to-r from-plum-50 to-white">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-plum-800">
                  <Link2 className="w-4 h-4" />
                  Tu link de reservas online
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Compartí este link con tus clientes para que reserven su turno directamente.
                </p>
                <div className="flex items-center gap-2 rounded-md border bg-white px-3 py-2">
                  <span className="flex-1 truncate font-mono text-sm text-plum-700">
                    {bookingUrl}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="bg-plum-700 hover:bg-plum-800 text-white"
                    onClick={copyBookingLink}
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-1.5" />
                        ¡Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1.5" />
                        Copiar link
                      </>
                    )}
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-4 h-4 mr-1.5" />
                      Ver página
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Agenda de hoy */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-plum-800">Agenda de hoy</h2>
              <Link to="/agenda">
                <Button variant="ghost" size="sm" className="text-plum-600 hover:text-plum-800">
                  Ver agenda <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </Link>
            </div>
            <Card>
              <CardContent className="p-0">
                {agendaLoading ? (
                  <div className="p-4 space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : !agenda?.length ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No hay turnos para hoy
                  </p>
                ) : (
                  <div className="divide-y">
                    {agenda.map((appt) => {
                      const clientName = appt.client
                        ? `${appt.client.first_name} ${appt.client.last_name ?? ''}`.trim()
                        : 'Sin cliente'
                      return (
                        <div
                          key={appt.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-50"
                        >
                          <span className="w-14 shrink-0 font-mono text-sm font-semibold text-plum-800">
                            {formatApptTime(appt.scheduled_at)}
                          </span>
                          <span className="flex-1 min-w-[120px] text-sm font-medium">
                            {clientName}
                          </span>
                          {appt.service && (
                            <span className="text-sm text-muted-foreground">
                              {appt.service.emoji} {appt.service.name}
                            </span>
                          )}
                          {appt.therapist && (
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <span
                                className="w-2 h-2 shrink-0 rounded-full"
                                style={{ backgroundColor: appt.therapist.color_hex ?? '#aaa' }}
                              />
                              {appt.therapist.full_name}
                            </span>
                          )}
                          <StatusBadge status={appt.status} />
                          {appt.box_number != null && (
                            <span className="text-xs text-muted-foreground">
                              Box {appt.box_number}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* Alertas */}
          <section>
            <h2 className="text-lg font-semibold text-plum-800 mb-3">Alertas</h2>
            {alertsLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : !hasAlerts ? (
              <p className="text-sm text-muted-foreground">Sin alertas por el momento.</p>
            ) : (
              <div className="space-y-4">
                {(alerts?.atRiskClients.length ?? 0) > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                        <AlertTriangle className="w-4 h-4" />
                        Clientes en riesgo
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {alerts!.atRiskClients.map((client) => (
                          <div
                            key={client.id}
                            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                          >
                            <span className="font-medium">
                              {client.first_name} {client.last_name ?? ''}
                            </span>
                            <div className="flex items-center gap-4 text-muted-foreground">
                              {client.phone && <span>{client.phone}</span>}
                              <span>{daysSince(client.last_visit_at)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t px-4 py-2">
                        <Link
                          to="/clientes"
                          className="text-xs text-plum-600 hover:text-plum-800 hover:underline"
                        >
                          Ver todos →
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(alerts?.expiringMemberships.length ?? 0) > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-700">
                        <Clock className="w-4 h-4" />
                        Membresías por vencer
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {alerts!.expiringMemberships.map((m) => {
                          const clientName = m.client
                            ? `${m.client.first_name} ${m.client.last_name ?? ''}`.trim()
                            : 'Sin cliente'
                          const planName = (m.plan as { name?: string } | null)?.name ?? '—'
                          const sessionsQty =
                            (m.plan as { sessions_qty?: number | null } | null)?.sessions_qty ?? 0
                          const sessionsRemaining =
                            sessionsQty > 0 ? sessionsQty - (m.sessions_used ?? 0) : null
                          return (
                            <div
                              key={m.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                            >
                              <span className="flex-1 font-medium">{clientName}</span>
                              <span className="text-muted-foreground">{planName}</span>
                              {m.expires_at && (
                                <span className="text-muted-foreground">
                                  Vence {formatDate(m.expires_at)}
                                </span>
                              )}
                              {sessionsRemaining !== null && (
                                <Badge variant="warning">
                                  {sessionsRemaining} sesión{sessionsRemaining !== 1 ? 'es' : ''}
                                </Badge>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {(alerts?.lowSessionMemberships.length ?? 0) > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm font-semibold text-orange-700">
                        <Zap className="w-4 h-4" />
                        Membresías con pocas sesiones
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {alerts!.lowSessionMemberships.map((m) => {
                          const clientName = m.client
                            ? `${m.client.first_name} ${m.client.last_name ?? ''}`.trim()
                            : 'Sin cliente'
                          const planName = (m.plan as { name?: string } | null)?.name ?? '—'
                          const sessionsQty =
                            (m.plan as { sessions_qty?: number | null } | null)?.sessions_qty ?? 0
                          const sessionsRemaining = sessionsQty - (m.sessions_used ?? 0)
                          return (
                            <div
                              key={m.id}
                              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm"
                            >
                              <span className="flex-1 font-medium">{clientName}</span>
                              <span className="text-muted-foreground">{planName}</span>
                              <Badge variant={sessionsRemaining === 0 ? 'destructive' : 'warning'}>
                                {sessionsRemaining} sesión{sessionsRemaining !== 1 ? 'es' : ''}{' '}
                                restante{sessionsRemaining !== 1 ? 's' : ''}
                              </Badge>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab: Reservas Online */}
      {activeTab === 'reservas' && <TabReservasOnline />}
    </div>
  )
}

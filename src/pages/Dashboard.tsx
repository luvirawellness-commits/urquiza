import { Users, CalendarCheck, TrendingUp, CalendarDays, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useDashboardMetrics } from '@/hooks/useFinanzas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: string | number
  icon: React.ElementType
  description: string
  color: string
}

function MetricCard({ title, value, icon: Icon, description, color }: MetricCardProps) {
  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-plum-800">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  )
}

export default function Dashboard() {
  const { profile } = useAuth()
  const { data: metrics, isLoading } = useDashboardMetrics()

  const greeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Buenos días'
    if (hour < 18) return 'Buenas tardes'
    return 'Buenas noches'
  }

  const metricCards = [
    {
      title: 'Total Clientes',
      value: isLoading ? '—' : metrics?.totalClients ?? 0,
      icon: Users,
      description: 'Clientes registrados',
      color: 'bg-plum-800',
    },
    {
      title: 'Turnos Hoy',
      value: isLoading ? '—' : metrics?.appointmentsToday ?? 0,
      icon: CalendarCheck,
      description: 'Citas programadas para hoy',
      color: 'bg-gold-500',
    },
    {
      title: 'Ingresos del Mes',
      value: isLoading ? '—' : formatCurrency(metrics?.revenueThisMonth ?? 0),
      icon: TrendingUp,
      description: 'Facturación mensual',
      color: 'bg-plum-600',
    },
    {
      title: 'Turnos esta Semana',
      value: isLoading ? '—' : metrics?.appointmentsThisWeek ?? 0,
      icon: CalendarDays,
      description: 'Citas de la semana en curso',
      color: 'bg-gold-600',
    },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-plum-800">
          {greeting()}, {profile?.full_name?.split(' ')[0] ?? 'bienvenida'} 👋
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {new Date().toLocaleDateString('es-AR', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {metricCards.map((card) => (
          <MetricCard key={card.title} {...card} />
        ))}
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-lg font-semibold text-plum-800 mb-3">Accesos rápidos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link to="/agenda">
            <Button variant="outline" className="w-full justify-between h-14 px-5 border-plum-200 hover:border-plum-800 hover:bg-plum-50">
              <div className="flex items-center gap-3">
                <CalendarDays className="w-5 h-5 text-plum-800" />
                <span className="font-medium text-plum-800">Ver Agenda</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </Button>
          </Link>
          <Link to="/clientes">
            <Button variant="outline" className="w-full justify-between h-14 px-5 border-plum-200 hover:border-plum-800 hover:bg-plum-50">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-plum-800" />
                <span className="font-medium text-plum-800">Clientes</span>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </Button>
          </Link>
          {(profile?.role === 'owner' || profile?.role === 'partner_admin') && (
            <Link to="/finanzas">
              <Button variant="outline" className="w-full justify-between h-14 px-5 border-plum-200 hover:border-plum-800 hover:bg-plum-50">
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-plum-800" />
                  <span className="font-medium text-plum-800">Finanzas</span>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

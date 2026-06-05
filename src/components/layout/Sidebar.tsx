import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, CalendarDays, TrendingUp, Gift, ShoppingBag, Settings, LogOut, Menu, X, Users2 } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const navItems = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/finanzas', label: 'Finanzas', icon: TrendingUp, roles: ['owner', 'partner_admin', 'therapist'] },
  { to: '/rrhh', label: 'RRHH', icon: Users2, roles: ['owner', 'partner_admin'] },
  { to: '/productos', label: 'Productos', icon: ShoppingBag, roles: ['owner', 'partner_admin'] },
  { to: '/gift-cards', label: 'Gift Cards', icon: Gift, roles: ['owner', 'partner_admin'] },
  { to: '/configuracion', label: 'Configuración', icon: Settings, roles: ['owner'] },
]

export function Sidebar() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  const filteredNav = navItems.filter(
    (item) => !item.roles || item.roles.includes(profile?.role ?? '')
  )

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-plum-700">
        <div className="w-8 h-8 rounded-full bg-gold-500 flex items-center justify-center flex-shrink-0">
          <span className="text-plum-800 font-bold text-sm">L</span>
        </div>
        <div>
          <p className="text-white font-semibold text-sm leading-tight">Luvira OS</p>
          <p className="text-plum-300 text-xs">Wellness Center</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {filteredNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-gold-500 text-plum-900'
                  : 'text-plum-200 hover:bg-plum-700 hover:text-white'
              )
            }
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* User profile + logout */}
      <div className="px-3 py-4 border-t border-plum-700">
        <div className="flex items-center gap-3 px-3 py-2 mb-2">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="bg-gold-500 text-plum-900 text-xs font-bold">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-medium truncate">{profile?.full_name ?? 'Usuario'}</p>
            <p className="text-plum-300 text-xs truncate capitalize">{profile?.role ?? ''}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="w-full justify-start text-plum-200 hover:text-white hover:bg-plum-700"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-plum-800 min-h-screen fixed top-0 left-0 z-30">
        {sidebarContent}
      </aside>

      {/* Mobile header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-plum-800 flex items-center justify-between px-4 py-3 border-b border-plum-700">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-gold-500 flex items-center justify-center">
            <span className="text-plum-800 font-bold text-xs">L</span>
          </div>
          <span className="text-white font-semibold text-sm">Luvira OS</span>
        </div>
        <button onClick={() => setMobileOpen(!mobileOpen)} className="text-white p-1">
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-20 flex">
          <div className="w-56 bg-plum-800 min-h-full pt-14">
            {sidebarContent}
          </div>
          <div className="flex-1 bg-black/40" onClick={() => setMobileOpen(false)} />
        </div>
      )}
    </>
  )
}

import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, CalendarDays, TrendingUp, Gift,
  ShoppingBag, ShoppingCart, Settings, LogOut, Menu, X, Users2, Building2,
  ChevronDown, Loader2, Check, CreditCard, ScrollText, ShieldAlert,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// permKeys: visible if ANY of the listed permission keys is true.
// Items without permKeys are always visible (Dashboard, Clientes, Agenda).
// roles[] is the fallback used while permissions are still loading (null).
const navItems = [
  { to: '/dashboard',  label: 'Dashboard',  icon: LayoutDashboard },
  { to: '/clientes',   label: 'Clientes',   icon: Users },
  { to: '/agenda',     label: 'Agenda',     icon: CalendarDays },
  { to: '/finanzas',    label: 'Finanzas',    icon: TrendingUp,   permKeys: ['caja', 'finanzas'],  roles: ['owner', 'partner_admin', 'therapist'] },
  { to: '/rrhh',        label: 'RRHH',        icon: Users2,       permKeys: ['rrhh'],              roles: ['owner', 'partner_admin'] },
  { to: '/membresias',  label: 'Membresías',  icon: CreditCard,   permKeys: ['configuracion'],     roles: ['owner', 'partner_admin'] },
  { to: '/auditoria',   label: 'Auditoría',   icon: ScrollText,   permKeys: ['configuracion'],     roles: ['owner', 'partner_admin'] },
  { to: '/usuarios',    label: 'Usuarios',    icon: Users,                                         roles: ['owner', 'partner_admin'] },
  { to: '/productos',   label: 'Productos',   icon: ShoppingBag,  permKeys: ['productos'],         roles: ['owner', 'partner_admin'] },
  { to: '/gift-cards',  label: 'Gift Cards',  icon: Gift,         permKeys: ['gift_cards'],        roles: ['owner', 'partner_admin'] },
  { to: '/compras',     label: 'Compras',     icon: ShoppingCart,                                  roles: ['owner', 'partner_admin'] },
]

function TenantSwitcher() {
  const { currentTenant, availableTenants, switchTenant } = useAuth()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const multi = availableTenants.length > 1

  async function handleSwitch(tenantId: string) {
    if (tenantId === currentTenant?.id) { setOpen(false); return }
    setSwitching(true)
    await switchTenant(tenantId)
    setOpen(false)
    setSwitching(false)
  }

  return (
    <div className="relative px-3 py-3 border-b border-plum-700">
      <button
        disabled={!multi}
        onClick={() => multi && setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
          multi ? 'hover:bg-plum-700 cursor-pointer' : 'cursor-default',
        )}
      >
        <Building2 className="w-4 h-4 text-gold-400 flex-shrink-0" />
        <span className="flex-1 text-left text-sm font-semibold text-gold-400 truncate">
          {switching ? '...' : (currentTenant?.name ?? 'Cargando...')}
        </span>
        {switching && <Loader2 className="w-3.5 h-3.5 text-plum-300 animate-spin" />}
        {!switching && multi && (
          <ChevronDown className={cn('w-3.5 h-3.5 text-plum-300 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-3 right-3 top-full mt-1 z-20 bg-plum-900 border border-plum-600 rounded-lg shadow-lg overflow-hidden">
            {availableTenants.map((t) => (
              <button
                key={t.id}
                onClick={() => handleSwitch(t.id)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm hover:bg-plum-700 transition-colors text-left"
              >
                <span className={cn('flex-1 truncate', t.id === currentTenant?.id ? 'text-gold-400 font-semibold' : 'text-plum-200')}>
                  {t.name}
                </span>
                {t.id === currentTenant?.id && <Check className="w-3.5 h-3.5 text-gold-400 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function Sidebar() {
  const { profile, signOut, permissions } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/auth')
  }

  const initials = profile?.full_name
    ? profile.full_name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : '?'

  // Use permissions from roles table; fall back to role[] while still loading (null)
  const filteredNav = navItems.filter((item) => {
    if (!item.permKeys) return true // Dashboard, Clientes, Agenda — always visible
    if (permissions !== null) return item.permKeys.some((k) => permissions[k] === true)
    // Fallback while permissions are loading
    return !item.roles || item.roles.includes(profile?.role ?? '')
  })

  // Configuración admin: visible if role is owner OR permissions.configuracion is set
  const showAdminLink =
    profile?.role === 'owner' ||
    (permissions !== null && permissions['configuracion'] === true)

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

      {/* Tenant switcher */}
      <TenantSwitcher />

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-sidebar">
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

        {/* Configuración — owner or configuracion permission */}
        {showAdminLink && (
          <NavLink
            to="/configuracion-admin"
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
            <Settings className="w-4 h-4 flex-shrink-0" />
            Configuración
          </NavLink>
        )}

        {/* Super Admin panel — only for super_admin role */}
        {profile?.role === 'super_admin' && (
          <NavLink
            to="/super-admin"
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-amber-500 text-amber-950'
                  : 'text-amber-400 hover:bg-plum-700 hover:text-amber-300'
              )
            }
          >
            <ShieldAlert className="w-4 h-4 flex-shrink-0" />
            Super Admin
          </NavLink>
        )}
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
      <aside className="hidden lg:flex flex-col w-56 bg-plum-800 h-screen overflow-hidden fixed top-0 left-0 z-30">
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

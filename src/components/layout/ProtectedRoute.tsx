import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ReactNode } from 'react'
import { canAccess, getDefaultRouteForRole, type AppModule } from '@/lib/permissions'

interface ProtectedRouteProps {
  children?: ReactNode
  roles?: string[]         // legacy: exact role-name membership check
  permission?: string      // require this one permission key
  anyPermission?: string[] // require ANY of these permission keys
}

// Maps URL base-path → AppModule for the module-level access guard
const PATH_MODULE: Record<string, AppModule> = {
  '/dashboard':          'dashboard',
  '/agenda':             'agenda',
  '/clientes':           'clientes',
  '/finanzas':           'caja',
  '/membresias':         'membresias',
  '/gift-cards':         'gift_cards',
  '/facturacion':        'facturacion',
  '/rrhh':               'rrhh',
  '/productos':          'productos',
  '/compras':            'configuracion',
  '/auditoria':          'configuracion',
  '/usuarios':           'usuarios',
  '/configuracion-admin':'configuracion',
}

export function ProtectedRoute({ children, roles, permission, anyPermission }: ProtectedRouteProps) {
  const { user, profile, loading, permissions } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-plum-800">
        <div className="text-center">
          <img
            src="/icons/icon-192.png"
            alt="Luvira OS"
            className="w-12 h-12 mx-auto mb-4 animate-pulse"
            style={{ borderRadius: '37%' }}
          />
          <p className="text-white text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  // Terms acceptance gate — super_admin (platform operator) is exempt
  if (profile && profile.role !== 'super_admin') {
    const needsTerms = !profile.terms_accepted_at || profile.terms_version !== '1.0'
    if (needsTerms) return <Navigate to="/aceptar-terminos" replace />
  }

  // Owner and super_admin bypass every permission/module check
  if (profile?.role === 'owner' || profile?.role === 'super_admin') {
    return children ? <>{children}</> : <Outlet />
  }

  // Module-level access guard using static role→module map
  if (profile) {
    const basePath = '/' + location.pathname.split('/')[1]
    const requiredModule = PATH_MODULE[basePath]
    if (requiredModule && !canAccess(profile.role, requiredModule)) {
      return <Navigate to={getDefaultRouteForRole(profile.role)} replace />
    }
  }

  // Permission-based checks (preferred over role names)
  if (permission !== undefined || anyPermission !== undefined) {
    if (permissions === null) return children ? <>{children}</> : <Outlet />

    const allowed = anyPermission
      ? anyPermission.some((k) => permissions[k] === true)
      : permissions[permission!] === true

    if (!allowed) return <Navigate to="/dashboard" replace />
    return children ? <>{children}</> : <Outlet />
  }

  // Legacy role-based check
  if (roles && profile && !roles.includes(profile.role)) {
    return <Navigate to={getDefaultRouteForRole(profile.role)} replace />
  }

  return children ? <>{children}</> : <Outlet />
}

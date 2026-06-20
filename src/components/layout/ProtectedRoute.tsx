import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ReactNode } from 'react'

interface ProtectedRouteProps {
  children?: ReactNode
  roles?: string[]         // legacy: exact role-name membership check
  permission?: string      // require this one permission key
  anyPermission?: string[] // require ANY of these permission keys
}

export function ProtectedRoute({ children, roles, permission, anyPermission }: ProtectedRouteProps) {
  const { user, profile, loading, permissions } = useAuth()

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

  // Owner and super_admin bypass every permission check
  if (profile?.role === 'owner' || profile?.role === 'super_admin') {
    return children ? <>{children}</> : <Outlet />
  }

  // Permission-based checks (preferred over role names)
  if (permission !== undefined || anyPermission !== undefined) {
    // If permissions haven't loaded yet, allow access — the sidebar already hides
    // the nav item, and the page itself can show an empty state if needed
    if (permissions === null) return children ? <>{children}</> : <Outlet />

    const allowed = anyPermission
      ? anyPermission.some((k) => permissions[k] === true)
      : permissions[permission!] === true

    if (!allowed) return <Navigate to="/dashboard" replace />
    return children ? <>{children}</> : <Outlet />
  }

  // Legacy role-based check
  if (roles && profile && !roles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children ? <>{children}</> : <Outlet />
}

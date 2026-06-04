import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { UserRole } from '@/types'
import { ReactNode } from 'react'

interface ProtectedRouteProps {
  children?: ReactNode
  roles?: UserRole[]
}

export function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-plum-800">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-gold-500 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-plum-800 font-bold text-lg">L</span>
          </div>
          <p className="text-white text-sm">Cargando...</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/auth" replace />

  if (roles && profile && !roles.includes(profile.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children ? <>{children}</> : <Outlet />
}

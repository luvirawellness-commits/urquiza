import { Outlet, Link } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useAuth } from '@/contexts/AuthContext'
import { MessageCircle } from 'lucide-react'
import { InstallPWABanner } from '@/components/InstallPWABanner'

function TrialExpiredScreen() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-plum-800">
      <div className="text-center px-6 max-w-sm">
        <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <span className="text-4xl">⏰</span>
        </div>
        <h1 className="text-white text-2xl font-bold mb-3">Período de prueba vencido</h1>
        <p className="text-plum-300 text-sm mb-8">
          Tu período de prueba ha vencido. Contratá un plan para continuar usando Luvira OS.
        </p>
        <div className="flex flex-col gap-3 items-center">
          <Link
            to="/pago"
            className="inline-flex items-center px-6 py-3 rounded-lg text-sm font-semibold text-white bg-plum-500 hover:bg-plum-400 transition-colors"
          >
            Contratar plan
          </Link>
          <a
            href="https://wa.me/5491133230906"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#25D366' }}
          >
            <MessageCircle className="w-4 h-4" />
            Contactar por WhatsApp
          </a>
        </div>
      </div>
    </div>
  )
}

export function AppLayout() {
  const { profile, currentTenant } = useAuth()

  const isSuperAdmin = profile?.role === 'super_admin'

  const trialEndsAt = currentTenant?.trial_ends_at ? new Date(currentTenant.trial_ends_at) : null
  const now = new Date()
  const trialExpired = trialEndsAt !== null && trialEndsAt <= now
  const trialDaysLeft = trialEndsAt !== null && trialEndsAt > now
    ? Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null

  if (trialExpired && !isSuperAdmin) {
    return <TrialExpiredScreen />
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="lg:ml-56 min-h-screen">
        <div className="pt-14 lg:pt-0">
          {/* Trial banner */}
          {trialDaysLeft !== null && (
            <div className="flex items-center justify-between px-4 py-2 bg-blue-600 text-white text-sm">
              <span>
                Tu período de prueba vence en <strong>{trialDaysLeft} {trialDaysLeft === 1 ? 'día' : 'días'}</strong>.
              </span>
              <Link
                to="/pago"
                className="text-xs font-semibold underline hover:no-underline"
              >
                Contratar plan
              </Link>
            </div>
          )}

          <Outlet />
        </div>
      </main>
      <InstallPWABanner />
    </div>
  )
}

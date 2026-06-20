import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Plan = 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'test_1usd'

const PLANS: {
  id: Plan
  name: string
  monthlyPrice: number
  total: string
  note: string
  badge: string
  badgeClass: string
  featured: boolean
}[] = [
  {
    id: 'monthly',
    name: 'Plan Mensual',
    monthlyPrice: 80,
    total: '',
    note: 'Cancelás cuando querás.',
    badge: 'Flexible',
    badgeClass: 'bg-gray-100 text-gray-600',
    featured: false,
  },
  {
    id: 'quarterly',
    name: 'Plan Trimestral',
    monthlyPrice: 65,
    total: '$195 / trimestre',
    note: 'Total $195 cada 3 meses.',
    badge: 'Ahorrás 19%',
    badgeClass: 'bg-green-100 text-green-700',
    featured: false,
  },
  {
    id: 'semiannual',
    name: 'Plan Semestral',
    monthlyPrice: 55,
    total: '$330 / semestre',
    note: 'Total $330 cada 6 meses.',
    badge: 'Ahorrás 31%',
    badgeClass: 'bg-green-100 text-green-700',
    featured: false,
  },
  {
    id: 'annual',
    name: 'Plan Anual',
    monthlyPrice: 40,
    total: '$480 / año',
    note: 'Total $480 al año. Ahorrás 50%.',
    badge: 'Más elegido ⭐',
    badgeClass: 'bg-plum-600 text-white',
    featured: true,
  },
]

export default function Pago() {
  const { session, currentTenantId, loading, profile } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testMode, setTestMode] = useState(false)

  const isSuperAdmin = profile?.role === 'super_admin'

  async function handleContratar(plan: Plan) {
    if (!session?.access_token || !currentTenantId) {
      navigate('/auth')
      return
    }
    setBusy(plan)
    setError(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-payment', {
        body: {
          tenant_id: currentTenantId,
          plan,
          access_token: session.access_token,
          ...(testMode && { test: true }),
        },
      })
      if (fnErr) throw new Error(fnErr.message ?? 'Error al iniciar el pago')
      if (data?.error) throw new Error(data.error)
      window.location.href = data.init_point
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al iniciar el pago')
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Cargando...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Elegí tu plan</h1>
          <p className="text-gray-500 text-sm">
            Acceso completo a Luvira OS. Sin contratos. Cancelás cuando querás.
          </p>
        </div>

        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 pt-4">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`bg-white rounded-2xl p-7 flex flex-col relative ${
                plan.featured
                  ? 'border-2 border-plum-600 shadow-lg'
                  : 'border border-gray-200'
              }`}
            >
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className={`text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${plan.badgeClass}`}>
                  {plan.badge}
                </span>
              </div>

              <div className="mb-5 mt-1">
                <h2 className="text-sm font-semibold text-gray-500 mb-2">{plan.name}</h2>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-gray-900">${plan.monthlyPrice}</span>
                  <span className="text-gray-500 text-sm">USD / mes</span>
                </div>
                {plan.total && (
                  <p className="text-xs text-gray-400 mt-1">{plan.total}</p>
                )}
              </div>

              <p className="text-sm text-gray-500 flex-1 mb-6">{plan.note}</p>

              <button
                onClick={() => handleContratar(plan.id)}
                disabled={busy !== null}
                className={`w-full py-2.5 px-4 text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  plan.featured
                    ? 'bg-plum-600 hover:bg-plum-700 text-white'
                    : 'bg-plum-700 hover:bg-plum-800 text-white'
                }`}
              >
                {busy === plan.id ? 'Redirigiendo...' : 'Contratar ahora →'}
              </button>
            </div>
          ))}
        </div>

        <div className="flex justify-center mt-8">
          <button
            onClick={() => handleContratar('test_1usd')}
            disabled={busy !== null}
            className="border border-dashed border-gray-300 text-gray-400 hover:text-gray-600 hover:border-gray-400 text-xs px-4 py-2 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy === 'test_1usd' ? 'Redirigiendo...' : '🧪 Prueba 1 semana ($1 USD)'}
          </button>
        </div>

        {isSuperAdmin && (
          <label className="flex items-center justify-center gap-2 mt-3 cursor-pointer select-none w-fit mx-auto">
            <input
              type="checkbox"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
              className="w-3.5 h-3.5 accent-amber-500"
            />
            <span className="text-xs text-gray-400">Modo prueba (no se cobra dinero real)</span>
          </label>
        )}

        <p className="text-center text-xs text-gray-400 mt-4">
          {session ? (
            <Link to="/dashboard" className="underline hover:no-underline">← Volver al dashboard</Link>
          ) : (
            <>
              ¿Ya tenés cuenta?{' '}
              <Link to="/auth" className="underline hover:no-underline">Iniciá sesión</Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}

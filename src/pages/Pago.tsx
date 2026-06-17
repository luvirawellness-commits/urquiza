import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

type Plan = 'monthly' | 'annual'

export default function Pago() {
  const { session, currentTenantId, loading } = useAuth()
  const navigate = useNavigate()
  const [busy, setBusy] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleContratar(plan: Plan) {
    if (!session?.access_token || !currentTenantId) {
      navigate('/auth')
      return
    }

    setBusy(plan)
    setError(null)

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('create-payment', {
        body: { tenant_id: currentTenantId, plan, access_token: session.access_token },
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
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Elegí tu plan</h1>
          <p className="text-gray-500 text-sm">
            Acceso completo a Luvira OS. Sin contratos. Cancelás cuando querás.
          </p>
        </div>

        {error && (
          <div className="mb-8 max-w-2xl mx-auto p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          {/* Plan Mensual */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Plan Mensual</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">$80</span>
                <span className="text-gray-500 text-sm">USD / mes</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 flex-1 mb-8">Cancelás cuando querás.</p>
            <button
              onClick={() => handleContratar('monthly')}
              disabled={busy !== null}
              className="w-full py-3 px-4 bg-plum-700 hover:bg-plum-800 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy === 'monthly' ? 'Redirigiendo...' : 'Contratar ahora →'}
            </button>
          </div>

          {/* Plan Anual */}
          <div className="bg-white rounded-2xl border-2 border-plum-600 p-8 flex flex-col relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="bg-plum-600 text-white text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap">
                Más elegido
              </span>
            </div>
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Plan Anual</h2>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-gray-900">$600</span>
                <span className="text-gray-500 text-sm">USD / año</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 flex-1 mb-8">
              Ahorrás <strong className="text-green-600">$360</strong> — equivale a $50/mes.
            </p>
            <button
              onClick={() => handleContratar('annual')}
              disabled={busy !== null}
              className="w-full py-3 px-4 bg-plum-600 hover:bg-plum-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy === 'annual' ? 'Redirigiendo...' : 'Contratar ahora →'}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-10">
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

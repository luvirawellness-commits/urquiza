import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

const TERMS_VERSION = '1.0'

export default function AceptarTerminos() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Already accepted — send them home
  if (profile && profile.terms_accepted_at && profile.terms_version === TERMS_VERSION) {
    navigate('/dashboard', { replace: true })
    return null
  }

  async function handleAccept() {
    if (!accepted || !user) return
    setBusy(true)
    setError(null)
    try {
      const { error: updateErr } = await supabase
        .from('users')
        .update({
          terms_accepted_at: new Date().toISOString(),
          terms_version: TERMS_VERSION,
        })
        .eq('id', user.id)
      if (updateErr) throw updateErr
      // Full reload so AuthContext re-fetches profile with updated terms fields
      window.location.replace('/dashboard')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar la aceptación. Intentá de nuevo.')
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg border border-gray-100 p-8 flex flex-col gap-6">

        {/* Logo + title */}
        <div className="text-center">
          <img
            src="/icons/icon-192.png"
            alt="Luvira OS"
            className="w-14 h-14 mx-auto mb-4"
            style={{ borderRadius: '30%' }}
          />
          <h1 className="text-xl font-bold text-gray-900">Términos y Condiciones de Uso</h1>
          <p className="text-sm text-gray-500 mt-1.5">
            Antes de continuar, necesitamos que leas y aceptes nuestros términos.
          </p>
        </div>

        {/* Summary box */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 max-h-[50vh] overflow-y-auto text-sm text-gray-700 space-y-3">
          <p className="font-semibold text-gray-800">Al usar Luvira OS aceptás que:</p>
          <ul className="space-y-2 list-none">
            {[
              'El servicio se provee "tal cual es", sin garantía de disponibilidad ininterrumpida.',
              'Sos responsable de los datos que ingresás y de tus obligaciones fiscales.',
              'Los datos de tus clientes son de tu propiedad; los procesamos únicamente para prestarte el servicio.',
              'Podés cancelar tu suscripción en cualquier momento sin penalidad.',
              'La responsabilidad máxima de Luvira OS se limita al monto del último período abonado.',
              'Usamos proveedores como Supabase y Vercel, ubicados en EE.UU., para almacenar y procesar los datos.',
            ].map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-plum-600 mt-0.5 flex-shrink-0">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* External links */}
        <div className="flex flex-col gap-1.5">
          <a
            href="https://luviraos.com/terminos"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-plum-700 hover:underline font-medium"
          >
            Leer Términos y Condiciones completos →
          </a>
          <a
            href="https://luviraos.com/privacidad"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-plum-700 hover:underline font-medium"
          >
            Leer Política de Privacidad completa →
          </a>
        </div>

        {/* Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-plum-700 flex-shrink-0"
          />
          <span className="text-sm text-gray-700">
            He leído y acepto los <span className="font-medium">Términos y Condiciones</span> y la{' '}
            <span className="font-medium">Política de Privacidad</span> de Luvira OS{' '}
            <span className="text-gray-400">(versión 1.0 — Junio 2026)</span>
          </span>
        </label>

        {error && (
          <p className="text-sm text-red-600 text-center">{error}</p>
        )}

        {/* CTA button */}
        <button
          onClick={handleAccept}
          disabled={!accepted || busy}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-plum-700 hover:bg-plum-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? 'Guardando...' : 'Continuar al sistema →'}
        </button>

        {/* Fine print */}
        <p className="text-xs text-gray-400 text-center">
          Esta aceptación queda registrada con fecha y hora. Si no aceptás estos términos, no podrás usar Luvira OS.
        </p>
      </div>
    </div>
  )
}

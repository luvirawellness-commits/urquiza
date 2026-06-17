import { Link } from 'react-router-dom'
import { XCircle } from 'lucide-react'

export default function PagoFallido() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-8 h-8 text-red-600" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">Problema con el pago</h1>
        <p className="text-gray-500 text-sm mb-8">Hubo un problema con el pago. Intentá de nuevo.</p>
        <Link
          to="/pago"
          className="inline-flex items-center px-6 py-3 bg-plum-700 hover:bg-plum-800 text-white text-sm font-semibold rounded-lg transition-colors"
        >
          Reintentar →
        </Link>
      </div>
    </div>
  )
}

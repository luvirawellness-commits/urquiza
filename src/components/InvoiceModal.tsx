import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceResult = {
  invoice_number: number
  invoice_type: string
  cae: string
  cae_expires_at: string
  total: number
  punto_venta: number
}

// ── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  isOpen: boolean
  onClose: () => void
  tenantId: string
  clientName: string
  clientId?: string
  amount: number
  concept: string
  appointmentId?: string
  transactionId?: string
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceModal({
  isOpen, onClose, tenantId, clientName, clientId,
  amount, concept, appointmentId, transactionId,
}: Props) {
  const [invoiceType, setInvoiceType] = useState<'B' | 'A'>('B')
  const [clientNameEdit, setClientNameEdit] = useState(clientName)
  const [clientCuit, setClientCuit] = useState('')
  const [conceptEdit, setConceptEdit] = useState(concept)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InvoiceResult | null>(null)
  const [error, setError] = useState('')

  const { data: arcaConfig, isLoading: arcaLoading } = useQuery({
    queryKey: ['arca-config', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_arca_config')
        .select('id, cuit, is_test_mode')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      return data
    },
    enabled: isOpen && !!tenantId,
    staleTime: 60_000,
  })

  const ivaPreview  = invoiceType === 'A' ? amount * 0.21 : 0
  const totalPreview = amount + ivaPreview

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (invoiceType === 'A' && !clientCuit.trim()) {
      setError('CUIT requerido para Factura A.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('generate-invoice', {
        body: {
          tenant_id:            tenantId,
          invoice_type:         invoiceType,
          client_name:          clientNameEdit.trim() || clientName,
          client_cuit:          clientCuit.trim() || undefined,
          client_iva_condition: invoiceType === 'A' ? 'responsable_inscripto' : 'consumidor_final',
          subtotal:             amount,
          concept:              conceptEdit.trim() || concept,
          appointment_id:       appointmentId,
          transaction_id:       transactionId,
          client_id:            clientId,
        },
      })
      if (fnErr) throw new Error(fnErr.message ?? 'Error al generar la factura')
      if (data?.error) throw new Error(data.error)
      setResult(data as InvoiceResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar la factura')
    } finally {
      setBusy(false)
    }
  }

  function handleClose() {
    setResult(null)
    setError('')
    setClientCuit('')
    setInvoiceType('B')
    setClientNameEdit(clientName)
    setConceptEdit(concept)
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4" />
            Emitir factura electrónica
          </DialogTitle>
        </DialogHeader>

        {arcaLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>

        ) : !arcaConfig ? (
          <div className="py-4 space-y-3">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800">Facturación no configurada</p>
                <p className="text-amber-700 mt-1">
                  Tu local no tiene configurada la facturación electrónica. Configurala en Facturación → Configuración ARCA.
                </p>
                <Link
                  to="/facturacion"
                  onClick={handleClose}
                  className="inline-block mt-2 text-plum-600 font-medium hover:underline"
                >
                  Ir a Facturación →
                </Link>
              </div>
            </div>
            <Button variant="outline" onClick={handleClose} className="w-full">Cerrar</Button>
          </div>

        ) : result ? (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">Factura generada exitosamente</span>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Factura {result.invoice_type} N°</span>
                <span className="font-semibold font-mono">
                  {String(result.punto_venta).padStart(5,'0')}-{String(result.invoice_number).padStart(8,'0')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total</span>
                <span className="font-semibold">${result.total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">CAE vence</span>
                <span className="font-semibold">{result.cae_expires_at}</span>
              </div>
              <div>
                <p className="text-gray-500 mb-0.5">CAE</p>
                <p className="font-mono text-xs break-all text-gray-700">{result.cae}</p>
              </div>
            </div>
            <Button onClick={handleClose} className="w-full">Cerrar</Button>
          </div>

        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-1">
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <Label className="text-sm">Tipo de comprobante</Label>
              <div className="flex gap-2 mt-1.5">
                {(['B', 'A'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setInvoiceType(t)}
                    className={cn(
                      'flex-1 py-2 text-sm font-semibold rounded-lg border transition-colors',
                      invoiceType === t
                        ? 'bg-plum-700 text-white border-plum-700'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                    )}
                  >
                    Factura {t}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {invoiceType === 'B'
                  ? 'Consumidor Final'
                  : 'Responsable Inscripto — requiere CUIT, aplica IVA 21%'}
              </p>
            </div>

            <div>
              <Label htmlFor="inv-client" className="text-sm">Nombre del cliente</Label>
              <Input
                id="inv-client"
                value={clientNameEdit}
                onChange={(e) => setClientNameEdit(e.target.value)}
                className="mt-1.5"
                required
              />
            </div>

            {invoiceType === 'A' && (
              <div>
                <Label htmlFor="inv-cuit" className="text-sm">CUIT del cliente *</Label>
                <Input
                  id="inv-cuit"
                  value={clientCuit}
                  onChange={(e) => setClientCuit(e.target.value)}
                  placeholder="20-12345678-9"
                  className="mt-1.5"
                  required
                />
              </div>
            )}

            <div>
              <Label htmlFor="inv-concept" className="text-sm">Concepto</Label>
              <Input
                id="inv-concept"
                value={conceptEdit}
                onChange={(e) => setConceptEdit(e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span>${amount.toFixed(2)}</span>
              </div>
              {ivaPreview > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">IVA 21%</span>
                  <span>${ivaPreview.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                <span>Total</span>
                <span>${totalPreview.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={handleClose} className="flex-1">
                Cancelar
              </Button>
              <Button type="submit" disabled={busy} className="flex-1 bg-plum-700 hover:bg-plum-800 text-white">
                {busy
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando...</>
                  : 'Generar factura'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

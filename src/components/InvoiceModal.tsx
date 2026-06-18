import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, CheckCircle, AlertCircle, Loader2, Download, Mail } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { generateInvoicePDF } from '@/utils/generateInvoicePDF'

// ── Types ─────────────────────────────────────────────────────────────────────

type InvoiceResult = {
  invoice_id: string
  invoice_number: number
  invoice_type: string
  cae: string
  cae_expires_at: string
  subtotal: number
  iva_amount: number
  total: number
  punto_venta: number
  razon_social: string
  cuit_emisor: string
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
  const [invoiceType, setInvoiceType] = useState<'C' | 'B' | 'A'>('B')
  const [clientNameEdit, setClientNameEdit] = useState(clientName)
  const [clientCuit, setClientCuit] = useState('')
  const [clientIvaCondition, setClientIvaCondition] = useState('consumidor_final')
  const [conceptEdit, setConceptEdit] = useState(concept)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InvoiceResult | null>(null)
  const [error, setError] = useState('')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailMsg, setEmailMsg] = useState('')

  const { data: arcaConfig, isLoading: arcaLoading } = useQuery({
    queryKey: ['arca-config', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_arca_config')
        .select('id, cuit, razon_social, is_test_mode, iva_condition')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      return data
    },
    enabled: isOpen && !!tenantId,
    staleTime: 60_000,
  })

  const { data: clientData } = useQuery({
    queryKey: ['client-email', clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from('clients')
        .select('email')
        .eq('id', clientId!)
        .maybeSingle()
      return data
    },
    enabled: isOpen && !!clientId,
    staleTime: 300_000,
  })
  const clientEmail = clientData?.email ?? null

  const isMonotributo = arcaConfig?.iva_condition === 'monotributo'

  // Default to Factura C for monotributo issuers once config loads
  useEffect(() => {
    if (arcaConfig) setInvoiceType(isMonotributo ? 'C' : 'B')
  }, [arcaConfig?.iva_condition])

  // Amount breakdown: for C no IVA; for A/B gross includes IVA
  const ivaPreview   = (invoiceType === 'A' || invoiceType === 'B') ? Math.round((amount - amount / 1.21) * 100) / 100 : 0
  const netoPreview  = (invoiceType === 'A' || invoiceType === 'B') ? Math.round((amount / 1.21) * 100) / 100 : 0
  const totalPreview = amount

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
          client_iva_condition: clientIvaCondition,
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

  function handleDownloadPDF() {
    if (!result) return
    generateInvoicePDF({
      invoice_type:         result.invoice_type,
      invoice_number:       result.invoice_number,
      punto_venta:          result.punto_venta,
      razon_social:         result.razon_social ?? arcaConfig?.razon_social ?? '',
      cuit_emisor:          result.cuit_emisor ?? arcaConfig?.cuit ?? '',
      iva_condition_emisor: arcaConfig?.iva_condition ?? 'monotributo',
      client_name:          clientNameEdit || clientName,
      client_cuit:          clientCuit || null,
      client_iva_condition: clientIvaCondition,
      concept:              conceptEdit || concept,
      subtotal:             result.subtotal,
      iva_amount:           result.iva_amount,
      total:                result.total,
      cae:                  result.cae,
      cae_expires_at:       result.cae_expires_at,
    })
  }

  async function handleSendEmail() {
    if (!result || !clientEmail) return
    setEmailBusy(true)
    setEmailMsg('')
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoice_id: result.invoice_id, tenant_id: tenantId, client_email: clientEmail },
      })
      if (fnErr) throw new Error(fnErr.message)
      setEmailMsg(data?.message ?? `Email enviado a ${clientEmail}`)
    } catch (e) {
      setEmailMsg(e instanceof Error ? e.message : 'Error al enviar el email')
    } finally {
      setEmailBusy(false)
    }
  }

  function handleClose() {
    setResult(null)
    setError('')
    setEmailMsg('')
    setClientCuit('')
    setInvoiceType(isMonotributo ? 'C' : 'B')
    setClientIvaCondition('consumidor_final')
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

            <div className="flex gap-2">
              <Button
                onClick={handleDownloadPDF}
                variant="outline"
                className="flex-1 gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Descargar PDF
              </Button>
              {clientEmail && (
                <Button
                  onClick={handleSendEmail}
                  variant="outline"
                  disabled={emailBusy}
                  className="flex-1 gap-1.5"
                >
                  {emailBusy
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Mail className="w-3.5 h-3.5" />}
                  Enviar email
                </Button>
              )}
            </div>

            {emailMsg && (
              <p className={cn(
                'text-xs text-center',
                emailMsg.includes('Error') ? 'text-red-600' : 'text-green-600'
              )}>
                {emailMsg}
              </p>
            )}

            <Button onClick={handleClose} className="w-full bg-plum-700 hover:bg-plum-800 text-white">
              Cerrar
            </Button>
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
                {(['C', 'B', 'A'] as const).map((t) => (
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
                {invoiceType === 'C'
                  ? 'Sin IVA — régimen monotributo'
                  : invoiceType === 'A'
                    ? 'IVA incluido — requiere CUIT del receptor'
                    : 'IVA incluido — consumidor final'}
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
              <Label htmlFor="inv-iva-cond" className="text-sm">Condición IVA del receptor</Label>
              <select
                id="inv-iva-cond"
                value={clientIvaCondition}
                onChange={(e) => setClientIvaCondition(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="consumidor_final">Consumidor Final</option>
                <option value="responsable_inscripto">Responsable Inscripto</option>
                <option value="monotributo">Monotributista</option>
                <option value="exento">Exento</option>
              </select>
            </div>

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
              {invoiceType === 'C' ? (
                <div className="flex justify-between font-semibold">
                  <span>Total (sin IVA)</span>
                  <span>${totalPreview.toFixed(2)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Neto gravado</span>
                    <span>${netoPreview.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IVA 21%</span>
                    <span>${ivaPreview.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-gray-200 pt-1">
                    <span>Total</span>
                    <span>${totalPreview.toFixed(2)}</span>
                  </div>
                </>
              )}
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

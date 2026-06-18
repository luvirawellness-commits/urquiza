import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileText, Loader2, CheckCircle, AlertCircle, Download, RefreshCw, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useTenantId } from '@/contexts/AuthContext'
import { generateInvoicePDF } from '@/utils/generateInvoicePDF'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate, exportToExcel } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type FacTab = 'emitir' | 'historial' | 'configuracion'

type InvoiceForm = {
  invoice_type: 'A' | 'B' | 'C'
  client_name: string
  client_cuit: string
  client_iva_condition: string
  concept: string
  subtotal: string
}

type ArcaForm = {
  cuit: string
  razon_social: string
  punto_venta: string
  is_test_mode: boolean
  certificate: string
  private_key: string
  iva_condition: string
}

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

type InvoiceRow = {
  id: string
  invoice_type: string
  invoice_number: number | null
  punto_venta: number | null
  cae: string | null
  cae_expires_at: string | null
  subtotal: number
  iva_amount: number
  total: number
  client_name: string
  client_cuit: string | null
  client_iva_condition: string | null
  concept: string | null
  status: string
  created_at: string
  clients: { email: string | null } | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_INVOICE: InvoiceForm = {
  invoice_type: 'B',
  client_name: '',
  client_cuit: '',
  client_iva_condition: 'consumidor_final',
  concept: 'Servicio de masajes',
  subtotal: '',
}

const EMPTY_ARCA: ArcaForm = {
  cuit: '',
  razon_social: '',
  punto_venta: '1',
  is_test_mode: true,
  certificate: '',
  private_key: '',
  iva_condition: 'monotributo',
}

const IVA_CONDITIONS = [
  { value: 'consumidor_final',    label: 'Consumidor Final' },
  { value: 'responsable_inscripto', label: 'Responsable Inscripto' },
  { value: 'monotributista',      label: 'Monotributista' },
  { value: 'exento',              label: 'Exento' },
]

const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  authorized: { label: 'Autorizada', variant: 'default' },
  pending:    { label: 'Pendiente',  variant: 'secondary' },
  error:      { label: 'Error',      variant: 'destructive' },
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useArcaConfig(tenantId: string) {
  return useQuery({
    queryKey: ['arca-config', tenantId],
    queryFn: async () => {
      const { data } = await supabase
        .from('tenant_arca_config')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle()
      return data
    },
    enabled: !!tenantId,
  })
}

function useInvoices(tenantId: string) {
  return useQuery({
    queryKey: ['invoices', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, clients(email)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as InvoiceRow[]
    },
    enabled: !!tenantId,
  })
}


// ── Tab: Emitir ───────────────────────────────────────────────────────────────

function TabEmitir({ tenantId, session }: { tenantId: string; session: { access_token: string } | null }) {
  const qc = useQueryClient()
  const [form, setForm] = useState<InvoiceForm>(EMPTY_INVOICE)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<InvoiceResult | null>(null)
  const [error, setError] = useState('')

  const set = (k: keyof InvoiceForm, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!session?.access_token) { setError('Sesión expirada. Recargá la página.'); return }
    if (!form.client_name.trim() || !form.subtotal) { setError('Nombre del cliente y monto son requeridos.'); return }
    if (form.invoice_type === 'A' && !form.client_cuit.trim()) { setError('CUIT requerido para Factura A.'); return }

    setBusy(true)
    setError('')
    setResult(null)

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('generate-invoice', {
        body: {
          tenant_id:            tenantId,
          invoice_type:         form.invoice_type,
          client_name:          form.client_name.trim(),
          client_cuit:          form.client_cuit.trim() || undefined,
          client_iva_condition: form.client_iva_condition,
          subtotal:             parseFloat(form.subtotal),
          concept:              form.concept.trim() || 'Servicio de masajes',
        },
      })

      if (fnErr) throw new Error(fnErr.message ?? 'Error al generar factura')
      if (data?.error) throw new Error(data.error)

      setResult(data as InvoiceResult)
      setForm(EMPTY_INVOICE)
      qc.invalidateQueries({ queryKey: ['invoices', tenantId] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al generar factura')
    } finally {
      setBusy(false)
    }
  }

  const subtotalNum = parseFloat(form.subtotal || '0')
  const ivaPreview  = form.invoice_type === 'A' ? subtotalNum * 0.21 : 0
  const totalPreview = subtotalNum + ivaPreview

  return (
    <div className="max-w-lg">
      {result ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircle className="w-5 h-5" />
            <span className="font-semibold">Factura generada exitosamente</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-gray-500">Tipo</p><p className="font-semibold">Factura {result.invoice_type}</p></div>
            <div><p className="text-gray-500">Número</p><p className="font-semibold">{String(result.punto_venta).padStart(5, '0')}-{String(result.invoice_number).padStart(8, '0')}</p></div>
            <div><p className="text-gray-500">Total</p><p className="font-semibold text-lg">${result.total.toFixed(2)}</p></div>
            <div><p className="text-gray-500">CAE vence</p><p className="font-semibold">{formatDate(result.cae_expires_at)}</p></div>
            <div className="col-span-2"><p className="text-gray-500">CAE</p><p className="font-mono text-xs break-all">{result.cae}</p></div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => setResult(null)}>
              Nueva factura
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div>
            <Label>Tipo de comprobante</Label>
            <div className="flex gap-2 mt-1.5">
              {(['A', 'B', 'C'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set('invoice_type', t)}
                  className={cn(
                    'flex-1 py-2 text-sm font-semibold rounded-lg border transition-colors',
                    form.invoice_type === t
                      ? 'bg-plum-700 text-white border-plum-700'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                  )}
                >
                  Factura {t}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {form.invoice_type === 'A' ? 'Para responsables inscriptos — requiere CUIT y aplica IVA 21%'
                : form.invoice_type === 'B' ? 'Para consumidores finales o responsables inscriptos'
                : 'Para monotributistas y consumidores finales'}
            </p>
          </div>

          <div>
            <Label htmlFor="client_name">Nombre del cliente *</Label>
            <Input id="client_name" value={form.client_name} onChange={(e) => set('client_name', e.target.value)} placeholder="Juan García" className="mt-1.5" required />
          </div>

          <div>
            <Label htmlFor="client_cuit">CUIT del cliente {form.invoice_type === 'A' ? '*' : '(opcional)'}</Label>
            <Input id="client_cuit" value={form.client_cuit} onChange={(e) => set('client_cuit', e.target.value)} placeholder="20-12345678-9" className="mt-1.5" required={form.invoice_type === 'A'} />
          </div>

          <div>
            <Label htmlFor="client_iva">Condición IVA del cliente</Label>
            <select id="client_iva" value={form.client_iva_condition} onChange={(e) => set('client_iva_condition', e.target.value)}
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              {IVA_CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div>
            <Label htmlFor="concept">Concepto</Label>
            <Input id="concept" value={form.concept} onChange={(e) => set('concept', e.target.value)} className="mt-1.5" />
          </div>

          <div>
            <Label htmlFor="subtotal">Monto *</Label>
            <Input id="subtotal" type="number" min="0.01" step="0.01" value={form.subtotal} onChange={(e) => set('subtotal', e.target.value)} placeholder="0.00" className="mt-1.5" required />
            {subtotalNum > 0 && (
              <div className="mt-2 p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${subtotalNum.toFixed(2)}</span></div>
                {ivaPreview > 0 && <div className="flex justify-between"><span className="text-gray-500">IVA 21%</span><span>${ivaPreview.toFixed(2)}</span></div>}
                <div className="flex justify-between font-semibold border-t border-gray-200 pt-1"><span>Total</span><span>${totalPreview.toFixed(2)}</span></div>
              </div>
            )}
          </div>

          <Button type="submit" disabled={busy} className="w-full bg-plum-700 hover:bg-plum-800 text-white">
            {busy ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generando...</> : 'Generar factura electrónica'}
          </Button>
        </form>
      )}
    </div>
  )
}

// ── Tab: Historial ────────────────────────────────────────────────────────────

function TabHistorial({ tenantId }: { tenantId: string }) {
  const { data: invoices = [], isLoading } = useInvoices(tenantId)
  const { data: arcaConfig } = useArcaConfig(tenantId)
  const [emailBusy, setEmailBusy] = useState<string | null>(null)
  const [emailMsgs, setEmailMsgs] = useState<Record<string, string>>({})

  function handlePDF(inv: InvoiceRow) {
    if (inv.invoice_number == null) return
    generateInvoicePDF({
      invoice_type:         inv.invoice_type,
      invoice_number:       inv.invoice_number,
      punto_venta:          inv.punto_venta ?? 1,
      razon_social:         arcaConfig?.razon_social ?? '',
      cuit_emisor:          arcaConfig?.cuit ?? '',
      iva_condition_emisor: arcaConfig?.iva_condition ?? 'monotributo',
      client_name:          inv.client_name,
      client_cuit:          inv.client_cuit,
      client_iva_condition: inv.client_iva_condition ?? 'consumidor_final',
      concept:              inv.concept ?? 'Servicios prestados',
      subtotal:             inv.subtotal,
      iva_amount:           inv.iva_amount,
      total:                inv.total,
      cae:                  inv.cae ?? '',
      cae_expires_at:       inv.cae_expires_at ?? '',
      date:                 inv.created_at,
    })
  }

  async function handleEmail(inv: InvoiceRow) {
    const email = inv.clients?.email
    if (!email || !inv.id) return
    setEmailBusy(inv.id)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('send-invoice-email', {
        body: { invoice_id: inv.id, tenant_id: tenantId, client_email: email },
      })
      if (fnErr) throw new Error(fnErr.message)
      setEmailMsgs((m) => ({ ...m, [inv.id]: data?.message ?? 'Email enviado' }))
    } catch (e) {
      setEmailMsgs((m) => ({ ...m, [inv.id]: 'Error al enviar' }))
    } finally {
      setEmailBusy(null)
    }
  }

  function handleExport() {
    exportToExcel(
      invoices.map((inv) => ({
        Número:  `${String(inv.punto_venta).padStart(5, '0')}-${String(inv.invoice_number).padStart(8, '0')}`,
        Tipo:    `Factura ${inv.invoice_type}`,
        Cliente: inv.client_name,
        CUIT:    inv.client_cuit ?? '',
        Total:   inv.total,
        CAE:     inv.cae ?? '',
        Estado:  STATUS_LABELS[inv.status]?.label ?? inv.status,
        Fecha:   formatDate(inv.created_at),
      })),
      'facturas.xlsx',
      'Facturas',
    )
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{invoices.length} facturas emitidas</p>
        {invoices.length > 0 && (
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="w-3.5 h-3.5 mr-1.5" />Exportar Excel
          </Button>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Todavía no emitiste facturas</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Número</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Cliente</th>
                  <th className="text-right px-4 py-3 text-xs text-gray-500 font-medium">Total</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">CAE</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Estado</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-500 font-medium">Fecha</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const st = STATUS_LABELS[inv.status] ?? { label: inv.status, variant: 'secondary' as const }
                  return (
                    <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-gray-600">
                        {inv.invoice_number != null
                          ? `${String(inv.punto_venta ?? 1).padStart(5, '0')}-${String(inv.invoice_number).padStart(8, '0')}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 font-semibold">Fac. {inv.invoice_type}</td>
                      <td className="px-4 py-3 max-w-[160px] truncate">{inv.client_name}</td>
                      <td className="px-4 py-3 text-right font-semibold">${inv.total.toFixed(2)}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500 max-w-[120px] truncate">{inv.cae ?? '—'}</td>
                      <td className="px-4 py-3"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-4 py-3 text-gray-500">{formatDate(inv.created_at)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePDF(inv)}
                            disabled={inv.invoice_number == null}
                            className="text-plum-600 hover:text-plum-800 disabled:opacity-30"
                            title="Descargar PDF"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                          {inv.clients?.email && (
                            <button
                              onClick={() => handleEmail(inv)}
                              disabled={emailBusy === inv.id}
                              className="text-plum-600 hover:text-plum-800 disabled:opacity-30"
                              title={`Enviar a ${inv.clients.email}`}
                            >
                              {emailBusy === inv.id
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Mail className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {emailMsgs[inv.id] && (
                            <span className="text-xs text-green-600">{emailMsgs[inv.id]}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Tab: Configuración ARCA ───────────────────────────────────────────────────

function TabConfiguracion({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient()
  const { data: existing, isLoading } = useArcaConfig(tenantId)
  const [form, setForm] = useState<ArcaForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [testOk, setTestOk] = useState<boolean | null>(null)

  const current: ArcaForm = form ?? (existing
    ? {
        cuit:         existing.cuit,
        razon_social: existing.razon_social,
        punto_venta:  String(existing.punto_venta),
        is_test_mode: existing.is_test_mode,
        certificate:  existing.certificate ?? '',
        private_key:  existing.private_key ?? '',
        iva_condition: existing.iva_condition ?? 'monotributo',
      }
    : EMPTY_ARCA)

  const set = (k: keyof ArcaForm, v: string | boolean) =>
    setForm((f) => ({ ...(f ?? current), [k]: v }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!current.cuit.trim() || !current.razon_social.trim()) {
      setSaveMsg('CUIT y razón social son requeridos.')
      return
    }
    setSaving(true)
    setSaveMsg('')
    try {
      const { error } = await supabase
        .from('tenant_arca_config')
        .upsert({
          tenant_id:    tenantId,
          cuit:         current.cuit.trim(),
          razon_social: current.razon_social.trim(),
          punto_venta:  parseInt(current.punto_venta) || 1,
          is_test_mode: current.is_test_mode,
          certificate:  current.certificate.trim() || null,
          private_key:  current.private_key.trim() || null,
          iva_condition: current.iva_condition,
          updated_at:   new Date().toISOString(),
        }, { onConflict: 'tenant_id' })
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['arca-config', tenantId] })
      setSaveMsg('Configuración guardada.')
      setForm(null)
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    if (!current.certificate || !current.private_key) {
      setTestMsg('Guardá el certificado y la clave privada antes de probar.')
      setTestOk(false)
      return
    }
    setTesting(true)
    setTestMsg('')
    setTestOk(null)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('generate-invoice', {
        body: { tenant_id: tenantId, action: 'test_connection' },
      })
      if (fnErr) throw new Error(fnErr.message)
      if (data?.error) throw new Error(data.error)
      setTestOk(true)
      setTestMsg(`Conexión exitosa con ARCA${data.test_mode ? ' (modo prueba)' : ''}. CUIT: ${data.cuit}`)
    } catch (e) {
      setTestOk(false)
      setTestMsg(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setTesting(false)
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>

  return (
    <div className="max-w-lg space-y-6">
      <form onSubmit={handleSave} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="cuit">CUIT *</Label>
            <Input id="cuit" value={current.cuit} onChange={(e) => set('cuit', e.target.value)} placeholder="20-12345678-9" className="mt-1.5" required />
          </div>
          <div>
            <Label htmlFor="pto">Punto de venta *</Label>
            <Input id="pto" type="number" min="1" value={current.punto_venta} onChange={(e) => set('punto_venta', e.target.value)} className="mt-1.5" required />
          </div>
        </div>

        <div>
          <Label htmlFor="razon">Razón social *</Label>
          <Input id="razon" value={current.razon_social} onChange={(e) => set('razon_social', e.target.value)} placeholder="Mi Centro SAS" className="mt-1.5" required />
        </div>

        <div>
          <Label htmlFor="iva_cond">Condición IVA del emisor</Label>
          <select id="iva_cond" value={current.iva_condition} onChange={(e) => set('iva_condition', e.target.value)}
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="monotributo">Monotributista</option>
            <option value="responsable_inscripto">Responsable Inscripto</option>
            <option value="exento">Exento</option>
          </select>
        </div>

        <div className="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            id="test_mode"
            checked={current.is_test_mode}
            onChange={(e) => set('is_test_mode', e.target.checked)}
            className="w-4 h-4 accent-amber-500"
          />
          <Label htmlFor="test_mode" className="cursor-pointer">
            Modo prueba (homologación AFIP — no emite comprobantes reales)
          </Label>
        </div>

        <div>
          <Label htmlFor="cert">Certificado PEM</Label>
          <textarea
            id="cert"
            value={current.certificate}
            onChange={(e) => set('certificate', e.target.value)}
            rows={5}
            placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y"
          />
        </div>

        <div>
          <Label htmlFor="pkey">Clave privada PEM</Label>
          <textarea
            id="pkey"
            value={current.private_key}
            onChange={(e) => set('private_key', e.target.value)}
            rows={5}
            placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;...&#10;-----END RSA PRIVATE KEY-----"
            className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono resize-y"
          />
        </div>

        {saveMsg && (
          <p className={cn('text-sm', saveMsg.includes('guardada') ? 'text-green-600' : 'text-red-600')}>
            {saveMsg}
          </p>
        )}

        <div className="flex gap-3">
          <Button type="submit" disabled={saving} className="bg-plum-700 hover:bg-plum-800 text-white">
            {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : 'Guardar configuración'}
          </Button>
          <Button type="button" variant="outline" disabled={testing} onClick={handleTest}>
            {testing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Probando...</> : <><RefreshCw className="w-4 h-4 mr-2" />Probar conexión ARCA</>}
          </Button>
        </div>

        {testMsg && (
          <div className={cn(
            'flex items-start gap-2 p-3 rounded-lg text-sm',
            testOk ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
          )}>
            {testOk ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
            {testMsg}
          </div>
        )}
      </form>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Facturacion() {
  const { profile, session } = useAuth()
  const tenantId = useTenantId()
  const [tab, setTab] = useState<FacTab>('emitir')

  const isOwnerOrAdmin = profile?.role === 'owner' || profile?.role === 'partner_admin' || profile?.role === 'super_admin'

  const TABS: { id: FacTab; label: string }[] = [
    { id: 'emitir',      label: 'Emitir factura' },
    { id: 'historial',   label: 'Historial' },
    ...(isOwnerOrAdmin ? [{ id: 'configuracion' as FacTab, label: 'Configuración ARCA' }] : []),
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Facturación electrónica</h1>
        <p className="text-sm text-muted-foreground mt-1">Emisión de comprobantes AFIP/ARCA</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === t.id
                ? 'border-plum-600 text-plum-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'emitir'        && <TabEmitir tenantId={tenantId} session={session} />}
      {tab === 'historial'     && <TabHistorial tenantId={tenantId} />}
      {tab === 'configuracion' && isOwnerOrAdmin && <TabConfiguracion tenantId={tenantId} />}
    </div>
  )
}

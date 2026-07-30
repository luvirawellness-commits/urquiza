import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsPDF } from 'https://esm.sh/jspdf@4.2.1'
import QRCode from 'https://esm.sh/qrcode@1.5.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
function err(message: string, status = 400): Response { return json({ error: message }, status) }

// ── PDF generation (ported from src/utils/generateInvoicePDF.ts) ───────────────
// This edge function can't import that file directly (separate Deno deployment,
// no bundler linking src/ and supabase/functions/), so the drawing logic is
// duplicated here. Keep both in sync if the invoice layout changes.

interface InvoicePDFData {
  invoice_type: string
  invoice_number: number
  punto_venta: number
  date?: string
  razon_social: string
  cuit_emisor: string
  iva_condition_emisor: string
  client_name: string
  client_cuit?: string | null
  client_iva_condition: string
  concept: string
  fch_serv_desde?: string
  fch_serv_hasta?: string
  subtotal: number
  iva_amount: number
  total: number
  cae: string
  cae_expires_at: string
}

const BORDEAUX: [number, number, number] = [61, 14, 26]   // #3D0E1A
const GRAY_BG:  [number, number, number] = [248, 248, 248]
const DARK:     [number, number, number] = [30, 30, 30]
const MID:      [number, number, number] = [100, 100, 100]

const IVA_LABELS: Record<string, string> = {
  consumidor_final:      'Consumidor Final',
  responsable_inscripto: 'Responsable Inscripto',
  monotributo:           'Monotributista',
  exento:                'Exento',
}

const CBTE_TIPO: Record<string, number> = { A: 1, B: 6, C: 11 }

function getArgentinaDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
}

function fmtDate(s?: string): string {
  if (!s) return new Date().toLocaleDateString('es-AR')
  return new Date(s).toLocaleDateString('es-AR')
}

function fmtYYYYMMDD(s: string): string {
  if (s.length !== 8) return s
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`
}

function buildQrUrl(data: InvoicePDFData): string {
  const fecha = data.date
    ? getArgentinaDateString(new Date(data.date))
    : getArgentinaDateString()
  const cuitStr = data.cuit_emisor.replace(/\D/g, '')
  const tipoDocRec = data.client_cuit ? 80 : 99
  const nroDocRec  = data.client_cuit ? parseInt(data.client_cuit.replace(/\D/g, ''), 10) : 0
  const payload = {
    ver:         1,
    fecha,
    cuit:        cuitStr,
    ptoVta:      data.punto_venta,
    tipoCmp:     CBTE_TIPO[data.invoice_type] ?? 11,
    nroCmp:      data.invoice_number,
    importe:     data.total,
    moneda:      'PES',
    ctz:         1,
    tipoDocRec,
    nroDocRec,
    tipoCodAut:  'E',
    codAut:      parseInt(data.cae, 10),
  }
  return `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(payload))}`
}

async function buildInvoicePdf(data: InvoicePDFData): Promise<Uint8Array> {
  const qrDataUrl = await QRCode.toDataURL(buildQrUrl(data), { width: 120, margin: 1 })

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W = 210
  const mL = 15, mR = 15
  const cW = W - mL - mR
  let y = 0

  // ── Header band ──────────────────────────────────────────────────────────────
  doc.setFillColor(...BORDEAUX)
  doc.rect(0, 0, W, 42, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text(`FACTURA ${data.invoice_type}`, mL, 20)

  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  const num = `N° ${String(data.punto_venta).padStart(5, '0')}-${String(data.invoice_number).padStart(8, '0')}`
  doc.text(num, W - mR, 14, { align: 'right' })
  doc.text(`Fecha: ${fmtDate(data.date)}`, W - mR, 21, { align: 'right' })
  doc.text('Comprobante electrónico AFIP/ARCA', W - mR, 28, { align: 'right' })

  y = 52

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function sectionHeader(title: string) {
    doc.setFillColor(...GRAY_BG)
    doc.rect(mL, y - 5, cW, 8, 'F')
    doc.setDrawColor(...BORDEAUX)
    doc.setLineWidth(0.5)
    doc.line(mL, y - 5, mL, y + 3)
    doc.setTextColor(...BORDEAUX)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text(title, mL + 3, y)
    y += 8
    doc.setTextColor(...DARK)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setDrawColor(220, 220, 220)
    doc.setLineWidth(0.2)
  }

  function field(label: string, value: string, bold = false) {
    doc.setTextColor(...MID)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(label, mL + 2, y)
    doc.setTextColor(...DARK)
    if (bold) doc.setFont('helvetica', 'bold')
    else doc.setFont('helvetica', 'normal')
    doc.text(value, mL + 48, y)
    y += 6
  }

  // ── Emisor ───────────────────────────────────────────────────────────────────
  sectionHeader('DATOS DEL EMISOR')
  field('Razón social:', data.razon_social)
  field('CUIT:', data.cuit_emisor)
  field('Condición IVA:', IVA_LABELS[data.iva_condition_emisor] ?? data.iva_condition_emisor)
  y += 4

  // ── Receptor ─────────────────────────────────────────────────────────────────
  sectionHeader('DATOS DEL RECEPTOR')
  field('Nombre:', data.client_name)
  field('CUIT / DNI:', data.client_cuit || '—')
  field('Condición IVA:', IVA_LABELS[data.client_iva_condition] ?? data.client_iva_condition)
  y += 4

  // ── Detalle ───────────────────────────────────────────────────────────────────
  sectionHeader('DETALLE DEL SERVICIO')
  field('Concepto:', data.concept || 'Servicios prestados')
  if (data.fch_serv_desde && data.fch_serv_hasta) {
    field('Período:', `${fmtYYYYMMDD(data.fch_serv_desde)} al ${fmtYYYYMMDD(data.fch_serv_hasta)}`)
  }
  y += 4

  // ── Importes ─────────────────────────────────────────────────────────────────
  sectionHeader('IMPORTES')
  if (data.iva_amount > 0) {
    field('Neto gravado:', `$${data.subtotal.toFixed(2)}`)
    field('IVA 21%:', `$${data.iva_amount.toFixed(2)}`)
  } else {
    field('Importe:', `$${data.total.toFixed(2)}`)
  }
  y += 3

  // Total band
  doc.setFillColor(...BORDEAUX)
  doc.rect(mL, y, cW, 13, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('TOTAL A PAGAR:', mL + 4, y + 8.5)
  doc.setFontSize(14)
  doc.text(`$${data.total.toFixed(2)}`, W - mR - 4, y + 8.5, { align: 'right' })
  y += 20

  // ── CAE + QR (RG 4291) ────────────────────────────────────────────────────────
  const qrSize  = 30   // 3cm × 3cm
  const boxH    = qrSize + 8
  const textX   = mL + qrSize + 6

  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.rect(mL, y, cW, boxH)

  // QR image — bottom-left of the box
  doc.addImage(qrDataUrl, 'PNG', mL + 2, y + 4, qrSize, qrSize)

  // CAE info — right of the QR
  doc.setTextColor(...BORDEAUX)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('Comprobante Autorizado', textX, y + 10)

  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`CAE: ${data.cae}`, textX, y + 18)
  doc.text(`Vencimiento CAE: ${data.cae_expires_at}`, textX, y + 26)

  y += boxH + 6

  // ── Footer ────────────────────────────────────────────────────────────────────
  doc.setTextColor(180, 180, 180)
  doc.setFontSize(7)
  doc.text('Comprobante generado por Luvira OS  ·  luviraos.com', W / 2, y, { align: 'center' })

  return new Uint8Array(doc.output('arraybuffer'))
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('Método no permitido', 405)

  const resendApiKey = Deno.env.get('RESEND_API_KEY')
  if (!resendApiKey) return err('RESEND_API_KEY no está configurada en el proyecto.', 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    const { invoice_id, tenant_id, client_email } = await req.json()

    if (!invoice_id || !tenant_id || !client_email) {
      return err('invoice_id, tenant_id y client_email son requeridos')
    }

    // 1. Invoice
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('invoice_type, invoice_number, punto_venta, cae, cae_expires_at, subtotal, iva_amount, total, client_name, client_cuit, client_iva_condition, concept, created_at')
      .eq('id', invoice_id)
      .eq('tenant_id', tenant_id)
      .single()

    if (invErr || !invoice) return err('Factura no encontrada.', 404)
    if (!invoice.cae || invoice.invoice_number == null || invoice.punto_venta == null) {
      return err('La factura no tiene CAE asignado, no se puede enviar por email.', 400)
    }

    // 2. Issuer config
    const { data: arcaConfig, error: cfgErr } = await supabase
      .from('tenant_arca_config')
      .select('cuit, razon_social, iva_condition')
      .eq('tenant_id', tenant_id)
      .maybeSingle()

    if (cfgErr || !arcaConfig) return err('Local no configurado para facturación.', 400)

    // 3. Build PDF
    const pdfBytes = await buildInvoicePdf({
      invoice_type:         invoice.invoice_type,
      invoice_number:       invoice.invoice_number,
      punto_venta:          invoice.punto_venta,
      date:                 invoice.created_at,
      razon_social:         arcaConfig.razon_social,
      cuit_emisor:          arcaConfig.cuit,
      iva_condition_emisor: arcaConfig.iva_condition ?? 'monotributo',
      client_name:          invoice.client_name,
      client_cuit:          invoice.client_cuit,
      client_iva_condition: invoice.client_iva_condition ?? 'consumidor_final',
      concept:              invoice.concept ?? 'Servicios prestados',
      subtotal:             invoice.subtotal,
      iva_amount:           invoice.iva_amount,
      total:                invoice.total,
      cae:                  invoice.cae,
      cae_expires_at:       invoice.cae_expires_at ?? '',
    })

    const numFormatted = `${String(invoice.punto_venta).padStart(5, '0')}-${String(invoice.invoice_number).padStart(8, '0')}`
    const filename = `factura-${invoice.invoice_type}-${numFormatted}.pdf`

    // 4. Send via Resend
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Luvira OS <facturas@luviraos.com>',
        to: [client_email],
        subject: `Tu factura ${invoice.invoice_type} de ${arcaConfig.razon_social}`,
        html: `
          <p>Hola,</p>
          <p>Adjuntamos tu factura ${invoice.invoice_type} N° ${numFormatted} de <strong>${arcaConfig.razon_social}</strong>.</p>
          <p><strong>Total:</strong> $${invoice.total.toFixed(2)}<br/>
          <strong>CAE:</strong> ${invoice.cae}</p>
          <p>Gracias por tu confianza.</p>
        `,
        attachments: [{ filename, content: bytesToBase64(pdfBytes) }],
      }),
    })

    if (!resendRes.ok) {
      const errBody = await resendRes.text()
      console.error('Resend API error:', resendRes.status, errBody)
      return err(`No se pudo enviar el email: ${errBody.slice(0, 300)}`, 502)
    }

    return json({ success: true, message: `Email enviado a ${client_email}` })
  } catch (error) {
    console.error('send-invoice-email error:', error)
    return err(error instanceof Error ? error.message : 'Error interno', 500)
  }
})

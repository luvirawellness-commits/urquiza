import { jsPDF } from 'jspdf'

export interface InvoicePDFData {
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

function fmtDate(s?: string): string {
  if (!s) return new Date().toLocaleDateString('es-AR')
  return new Date(s).toLocaleDateString('es-AR')
}

function fmtYYYYMMDD(s: string): string {
  if (s.length !== 8) return s
  return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`
}

export function generateInvoicePDF(data: InvoicePDFData): void {
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

  // ── CAE ───────────────────────────────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200)
  doc.setLineWidth(0.3)
  doc.rect(mL, y, cW, 26)
  doc.setTextColor(...BORDEAUX)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('CÓDIGO DE AUTORIZACIÓN ELECTRÓNICA (CAE)', mL + 3, y + 7)
  doc.setTextColor(...DARK)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.text(`CAE: ${data.cae}`, mL + 3, y + 14)
  doc.text(`Vencimiento CAE: ${data.cae_expires_at}`, mL + 3, y + 21)
  y += 34

  // ── Footer ────────────────────────────────────────────────────────────────────
  doc.setTextColor(180, 180, 180)
  doc.setFontSize(7)
  doc.text('Comprobante generado por Luvira OS  ·  luvirawellness.com', W / 2, y, { align: 'center' })

  const filename = `factura-${data.invoice_type}-${String(data.punto_venta).padStart(5, '0')}-${String(data.invoice_number).padStart(8, '0')}.pdf`
  doc.save(filename)
}

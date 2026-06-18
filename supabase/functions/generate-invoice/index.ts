import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// deno-lint-ignore no-explicit-any
import forge from 'https://esm.sh/node-forge@1.3.1'

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

// ── AFIP endpoints ────────────────────────────────────────────────────────────
const WSAA_TEST = 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms'
const WSAA_PROD = 'https://wsaa.afip.gov.ar/ws/services/LoginCms'
const WSFEV1_TEST = 'https://wswhomo.afip.gov.ar/wsfev1/service.asc'
const WSFEV1_PROD = 'https://servicios1.afip.gov.ar/wsfev1/service.asc'

const CBTE_TIPO: Record<string, number> = { A: 1, B: 6, C: 11 }

// ── Helpers ───────────────────────────────────────────────────────────────────
function toAfipDate(d: Date): string {
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000)
  return ar.toISOString().replace(/\.\d{3}Z$/, '').slice(0, 19) + '-03:00'
}

function extractXml(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`, 'i'))
  return m?.[1]?.trim() ?? ''
}

async function soapCall(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': '' },
    body,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`SOAP HTTP ${res.status}: ${text.slice(0, 300)}`)
  const fault = extractXml(text, 'faultstring')
  if (fault) throw new Error(`SOAP Fault: ${fault}`)
  return text
}

// ── WSAA ──────────────────────────────────────────────────────────────────────
function buildTRA(): string {
  const now = new Date()
  const gen = new Date(now.getTime() - 120_000) // 2 min ago
  const exp = new Date(now.getTime() + 36_000_000) // 10 hours ahead
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(Math.random() * 2_147_483_647)}</uniqueId>
    <generationTime>${toAfipDate(gen)}</generationTime>
    <expirationTime>${toAfipDate(exp)}</expirationTime>
  </header>
  <service>wsfe</service>
</loginTicketRequest>`
}

function signTRA(traXml: string, certPem: string, keyPem: string): string {
  // deno-lint-ignore no-explicit-any
  const f = forge as any
  const cert = f.pki.certificateFromPem(certPem)
  const key  = f.pki.privateKeyFromPem(keyPem)
  const p7   = f.pkcs7.createSignedData()
  p7.content = f.util.createBuffer(traXml, 'utf8')
  p7.addCertificate(cert)
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: f.pki.oids.sha256,
    authenticatedAttributes: [
      { type: f.pki.oids.contentType, value: f.pki.oids.data },
      { type: f.pki.oids.messageDigest },
      { type: f.pki.oids.signingTime, value: new Date() },
    ],
  })
  p7.sign()
  const der = f.asn1.toDer(p7.toAsn1()).getBytes()
  return f.util.encode64(der)
}

async function getWSAAToken(certPem: string, keyPem: string, isTest: boolean) {
  const traXml    = buildTRA()
  const signedTra = signTRA(traXml, certPem, keyPem)
  const url       = isTest ? WSAA_TEST : WSAA_PROD

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms><wsaa:in0>${signedTra}</wsaa:in0></wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`

  const resp  = await soapCall(url, soap)
  const token = extractXml(resp, 'token')
  const sign  = extractXml(resp, 'sign')
  if (!token || !sign) throw new Error('WSAA: no se recibió token/sign. Verificá el certificado.')
  return { token, sign }
}

// ── WSFEV1 ────────────────────────────────────────────────────────────────────
function authBlock(token: string, sign: string, cuit: string): string {
  return `<ar:Auth>
    <ar:Token>${token}</ar:Token>
    <ar:Sign>${sign}</ar:Sign>
    <ar:Cuit>${cuit.replace(/\D/g, '')}</ar:Cuit>
  </ar:Auth>`
}

async function getLastNumber(url: string, auth: string, ptoVta: number, cbteTipo: number): Promise<number> {
  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECompUltimoAutorizado>
      ${auth}
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
    </ar:FECompUltimoAutorizado>
  </soapenv:Body>
</soapenv:Envelope>`
  const resp = await soapCall(url, soap)
  return parseInt(extractXml(resp, 'CbteNro') || '0', 10)
}

async function solicitarCAE(url: string, auth: string, p: {
  ptoVta: number; cbteTipo: number; nextNum: number; docTipo: number; docNro: string
  subtotal: number; ivaAmount: number; total: number; invoiceDate: string
}) {
  const ivaXml = p.cbteTipo === 1
    ? `<ar:Iva><ar:AlicIva>
        <ar:Id>5</ar:Id>
        <ar:BaseImp>${p.subtotal.toFixed(2)}</ar:BaseImp>
        <ar:Importe>${p.ivaAmount.toFixed(2)}</ar:Importe>
       </ar:AlicIva></ar:Iva>`
    : ''

  const soap = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">
  <soapenv:Header/>
  <soapenv:Body>
    <ar:FECAESolicitar>
      ${auth}
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${p.ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${p.cbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>2</ar:Concepto>
            <ar:DocTipo>${p.docTipo}</ar:DocTipo>
            <ar:DocNro>${p.docNro}</ar:DocNro>
            <ar:CbteDesde>${p.nextNum}</ar:CbteDesde>
            <ar:CbteHasta>${p.nextNum}</ar:CbteHasta>
            <ar:CbteFch>${p.invoiceDate}</ar:CbteFch>
            <ar:ImpTotal>${p.total.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>0.00</ar:ImpTotConc>
            <ar:ImpNeto>${p.subtotal.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>0.00</ar:ImpOpEx>
            <ar:ImpIVA>${p.ivaAmount.toFixed(2)}</ar:ImpIVA>
            <ar:ImpTrib>0.00</ar:ImpTrib>
            <ar:MonId>PES</ar:MonId>
            <ar:MonCotiz>1</ar:MonCotiz>
            ${ivaXml}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>
    </ar:FECAESolicitar>
  </soapenv:Body>
</soapenv:Envelope>`

  const resp      = await soapCall(url, soap)
  const cae       = extractXml(resp, 'CAE')
  const caeVto    = extractXml(resp, 'CAEFchVto')
  const resultado = extractXml(resp, 'Resultado')
  const errMsg    = extractXml(resp, 'Msg')

  if (resultado !== 'A' || !cae) {
    throw new Error(`AFIP rechazó la factura: ${errMsg || resultado || 'error desconocido'}`)
  }
  return { cae, caeVto, resultado }
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return err('Método no permitido', 405)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  try {
    // deno-lint-ignore no-explicit-any
    const body = await req.json() as Record<string, any>
    const { tenant_id, action } = body

    if (!tenant_id) return err('tenant_id requerido')

    // 1. Get ARCA config
    const { data: config, error: cfgErr } = await supabase
      .from('tenant_arca_config')
      .select('*')
      .eq('tenant_id', tenant_id)
      .single()

    if (cfgErr || !config) return err('Local no configurado para facturación. Completá la configuración ARCA primero.')
    if (!config.certificate || !config.private_key) return err('Falta el certificado o la clave privada ARCA.')

    const isTest    = config.is_test_mode === true
    const wsfev1Url = isTest ? WSFEV1_TEST : WSFEV1_PROD

    // 2. Get WSAA token
    const { token, sign } = await getWSAAToken(config.certificate, config.private_key, isTest)
    const auth = authBlock(token, sign, config.cuit)

    // Test connection only
    if (action === 'test_connection') {
      return json({ ok: true, message: 'Conexión con ARCA exitosa', cuit: config.cuit, test_mode: isTest })
    }

    // 3. Invoice fields
    const {
      invoice_type, client_name, client_cuit, client_iva_condition,
      client_address, subtotal, appointment_id, transaction_id, client_id,
    } = body

    if (!invoice_type || !client_name || !subtotal) {
      return err('invoice_type, client_name y subtotal son requeridos')
    }
    if (invoice_type === 'A' && !client_cuit) return err('CUIT del cliente requerido para Factura A')

    const cbteTipo = CBTE_TIPO[invoice_type]
    if (!cbteTipo) return err('Tipo de comprobante inválido. Usar A, B o C.')

    // 4. Last invoice number
    const lastNum = await getLastNumber(wsfev1Url, auth, config.punto_venta, cbteTipo)
    const nextNum = lastNum + 1

    // 5. Amounts
    const sub       = parseFloat(subtotal)
    const ivaAmount = invoice_type === 'A' ? Math.round(sub * 0.21 * 100) / 100 : 0
    const total     = Math.round((sub + ivaAmount) * 100) / 100

    // 6. Client document
    const docTipo = client_cuit ? 80 : 99
    const docNro  = client_cuit ? client_cuit.replace(/\D/g, '') : '0'

    // 7. Invoice date (YYYYMMDD in Argentina time)
    const now = new Date()
    const arNow = new Date(now.getTime() - 3 * 60 * 60 * 1000)
    const invoiceDate = arNow.toISOString().slice(0, 10).replace(/-/g, '')

    // 8. Request CAE
    const { cae, caeVto } = await solicitarCAE(wsfev1Url, auth, {
      ptoVta: config.punto_venta,
      cbteTipo,
      nextNum,
      docTipo,
      docNro,
      subtotal: sub,
      ivaAmount,
      total,
      invoiceDate,
    })

    // Parse CAE expiration date (YYYYMMDD → ISO)
    const caeExpiresAt = `${caeVto.slice(0, 4)}-${caeVto.slice(4, 6)}-${caeVto.slice(6, 8)}`

    // 9. Save invoice
    const { data: invoice, error: insErr } = await supabase
      .from('invoices')
      .insert({
        tenant_id,
        appointment_id:       appointment_id ?? null,
        transaction_id:       transaction_id ?? null,
        client_id:            client_id ?? null,
        invoice_type,
        invoice_number:       nextNum,
        punto_venta:          config.punto_venta,
        cae,
        cae_expires_at:       caeExpiresAt,
        subtotal:             sub,
        iva_amount:           ivaAmount,
        total,
        client_name,
        client_cuit:          client_cuit ?? null,
        client_iva_condition: client_iva_condition ?? 'consumidor_final',
        client_address:       client_address ?? null,
        status:               'authorized',
        arca_response:        { cae, caeVto, cbteTipo, nextNum },
      })
      .select()
      .single()

    if (insErr) throw insErr

    return json({
      invoice_id:     invoice.id,
      invoice_number: nextNum,
      invoice_type,
      cae,
      cae_expires_at: caeExpiresAt,
      subtotal:       sub,
      iva_amount:     ivaAmount,
      total,
      punto_venta:    config.punto_venta,
      razon_social:   config.razon_social,
      cuit_emisor:    config.cuit,
    })

  } catch (error) {
    console.error('generate-invoice error:', error)
    return err(error instanceof Error ? error.message : 'Error interno', 500)
  }
})

import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isElectronicPayment } from '@/lib/paymentMethods'
import { useTenantId } from '@/contexts/AuthContext'

// Stage 1 foundation only — not wired into any screen yet. See useTriggerInvoicing
// below for the full decision logic (invoice type resolution, electronic-vs-cash
// branching) that Stage 2 screens will call into.

export type InvoiceResult = {
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

// ── useExistingInvoice ───────────────────────────────────────────────────────
// Lets any screen check "does this transaction already have an invoice?"
// before offering an invoice action on it — needed given nothing prevented
// double-invoicing before the invoices_transaction_id_unique index.

export function useExistingInvoice(transactionId: string | undefined) {
  const tenantId = useTenantId()
  return useQuery({
    queryKey: ['existing-invoice', tenantId, transactionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('transaction_id', transactionId as string)
        .maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!tenantId && !!transactionId,
  })
}

// ── useTriggerInvoicing ───────────────────────────────────────────────────────

export type TriggerInvoicingInput = {
  tenantId: string
  transactionId: string
  clientId?: string | null
  clientName: string
  amount: number
  concept: string
  paymentMethod: string
  invoiceType?: 'A' | 'B' | 'C'
  receptorCuit?: string
}

export type TriggerInvoicingResult = {
  auto: boolean
  invoice?: InvoiceResult
  needsConfirmation?: boolean
  needsInvoiceTypeChoice?: boolean
}

export function useTriggerInvoicing() {
  const mutation = useMutation({
    mutationFn: async (input: TriggerInvoicingInput): Promise<TriggerInvoicingResult> => {
      // 1. Resolve invoice type from the emisor's IVA condition.
      const { data: arcaConfig, error: cfgErr } = await supabase
        .from('tenant_arca_config')
        .select('iva_condition')
        .eq('tenant_id', input.tenantId)
        .maybeSingle()
      if (cfgErr) throw cfgErr
      if (!arcaConfig) {
        throw new Error('Local no configurado para facturación electrónica (Configuración ARCA).')
      }

      let invoiceType: 'A' | 'B' | 'C'
      if (arcaConfig.iva_condition === 'monotributo' || arcaConfig.iva_condition === 'exento') {
        // Always Factura C for these — matches current manual-invoicing behavior, no choice.
        invoiceType = 'C'
      } else {
        // Responsable Inscripto (or any unrecognized value — treated the same:
        // never silently default this one, always make the caller confirm).
        if (!input.invoiceType) {
          return { auto: false, needsInvoiceTypeChoice: true }
        }
        invoiceType = input.invoiceType
      }

      // 2. Factura A legally requires the receptor's CUIT — the one exception
      // to "no document collection." generate-invoice enforces this too
      // server-side, but failing fast here avoids an unnecessary round trip.
      if (invoiceType === 'A' && !input.receptorCuit?.trim()) {
        throw new Error('CUIT del receptor requerido para Factura A.')
      }

      // 3. Electronic vs cash/other — only electronic payments auto-issue.
      if (!isElectronicPayment(input.paymentMethod)) {
        return { auto: false, needsConfirmation: true }
      }

      const { data, error: fnErr } = await supabase.functions.invoke('generate-invoice', {
        body: {
          tenant_id: input.tenantId,
          invoice_type: invoiceType,
          client_name: input.clientName,
          client_cuit: invoiceType === 'A' ? input.receptorCuit!.trim() : undefined,
          client_iva_condition: 'consumidor_final',
          subtotal: input.amount,
          concept: input.concept,
          transaction_id: input.transactionId,
          client_id: input.clientId ?? undefined,
        },
      })
      if (fnErr) throw new Error(fnErr.message ?? 'Error al generar la factura automáticamente')
      if (data?.error) throw new Error(data.error)

      return { auto: true, invoice: data as InvoiceResult }
    },
  })

  return {
    triggerInvoicing: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  }
}

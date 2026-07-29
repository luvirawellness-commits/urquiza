import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
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

      // 3. Electronic-vs-cash branching now happens entirely at the call site
      // (only electronic transactions are ever queued into this function —
      // cash/other payment methods go through the manual InvoiceModal instead).
      // The caller only reaches this point after the user explicitly confirmed
      // "¿Querés emitir factura?" — no more silent auto-fire.

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

// ── Stage 2 additions ─────────────────────────────────────────────────────────
// The four sale flows (session close, membership, gift card, product cart) all
// need the same two things: a way to find the transaction row(s) a just-run
// RPC/insert created, and a way to walk a list of transactions through
// triggerInvoicing one at a time, pausing for the A/B choice modal when
// needed. Built once here instead of four times to keep that (non-trivial,
// money-handling) logic consistent.

export type ResolvedTransaction = {
  id: string
  amount: number
  payment_method: string
  client_id: string | null
}

// Fetches transaction rows by exact id — close_appointment_with_payment,
// sell_membership, and create_gift_card all return the id(s) of the
// transaction(s) they just inserted directly in their RPC response, so
// there's no time-based guessing involved (previously this queried
// "created_at >= beforeIso" using a client-captured timestamp, which could
// silently return zero rows under client/server clock skew).
export async function fetchTransactionsByIds(ids: string[]): Promise<ResolvedTransaction[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, payment_method, client_id')
    .in('id', ids)
  if (error) throw error
  return (data ?? []) as ResolvedTransaction[]
}

export type QueuedInvoiceTx = {
  id: string
  amount: number
  paymentMethod: string
  clientId?: string | null
  clientName: string
  concept: string
}

export type QueuedInvoiceStatus = {
  status: 'pending' | 'done' | 'error'
  message?: string
  invoice?: InvoiceResult
}

// Sequentially runs triggerInvoicing over a list of (already known electronic)
// transactions. When one needs the A/B choice, processing pauses and exposes
// `pendingChoiceTx` — the caller renders InvoiceTypeChoiceModal and calls
// resolveChoice() on confirm, which re-fires that transaction with the chosen
// type and then resumes the rest of the queue. cancelChoice() marks the
// paused transaction as skipped and resumes the remaining queue.
export function useElectronicInvoiceQueue(opts: {
  tenantId: string | null | undefined
}) {
  const { triggerInvoicing } = useTriggerInvoicing()
  const [results, setResults] = useState<Record<string, QueuedInvoiceStatus>>({})
  const [pendingChoiceTx, setPendingChoiceTx] = useState<QueuedInvoiceTx | null>(null)
  const [remainingQueue, setRemainingQueue] = useState<QueuedInvoiceTx[]>([])

  async function invoiceOne(
    tx: QueuedInvoiceTx,
    invoiceType?: 'A' | 'B',
    receptorCuit?: string,
  ): Promise<'paused' | 'done'> {
    if (!opts.tenantId) return 'done'
    setResults((prev) => ({ ...prev, [tx.id]: { status: 'pending' } }))
    try {
      const result = await triggerInvoicing({
        tenantId: opts.tenantId,
        transactionId: tx.id,
        clientId: tx.clientId ?? undefined,
        clientName: tx.clientName,
        amount: tx.amount,
        concept: tx.concept,
        paymentMethod: tx.paymentMethod,
        invoiceType,
        receptorCuit,
      })
      if (result.needsInvoiceTypeChoice) {
        setPendingChoiceTx(tx)
        return 'paused'
      }
      setResults((prev) => ({ ...prev, [tx.id]: { status: 'done', invoice: result.invoice } }))
      return 'done'
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [tx.id]: { status: 'error', message: e instanceof Error ? e.message : 'Error al facturar' },
      }))
      return 'done'
    }
  }

  async function processQueue(queue: QueuedInvoiceTx[]) {
    if (queue.length === 0) return
    const [tx, ...rest] = queue
    const outcome = await invoiceOne(tx)
    if (outcome === 'paused') {
      setRemainingQueue(rest)
      return
    }
    await processQueue(rest)
  }

  async function resolveChoice(invoiceType: 'A' | 'B', receptorCuit?: string) {
    if (!pendingChoiceTx) return
    const tx = pendingChoiceTx
    setPendingChoiceTx(null)
    await invoiceOne(tx, invoiceType, receptorCuit)
    await processQueue(remainingQueue)
  }

  async function cancelChoice() {
    if (!pendingChoiceTx) return
    const tx = pendingChoiceTx
    setResults((prev) => ({ ...prev, [tx.id]: { status: 'error', message: 'Facturación cancelada' } }))
    setPendingChoiceTx(null)
    await processQueue(remainingQueue)
  }

  return {
    startQueue: processQueue,
    results,
    pendingChoiceTx,
    resolveChoice,
    cancelChoice,
  }
}

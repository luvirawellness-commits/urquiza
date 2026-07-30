import { useEffect, useRef, useState } from 'react'
import {
  ShoppingCart, Loader2, Package, Search, Check, CheckCircle, Plus, Minus, Trash2, AlertCircle,
} from 'lucide-react'
import { useAuth, useTenantId } from '@/contexts/AuthContext'
import { useSellableSupplies, useSellCart, type CartSaleItem, type CartPaymentSplit } from '@/hooks/useSupplies'
import { useClients } from '@/hooks/useClients'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, formatCurrency } from '@/lib/utils'
import type { Supply, Client } from '@/types'
import { PAYMENT_METHODS, isElectronicPayment } from '@/lib/paymentMethods'
import { canAccess } from '@/lib/permissions'
import { useElectronicInvoiceQueue, type ResolvedTransaction } from '@/hooks/useAutoInvoice'
import InvoiceModal from '@/components/InvoiceModal'
import InvoiceTypeChoiceModal from '@/components/InvoiceTypeChoiceModal'
import { PointChargeControl } from '@/components/PointChargeControl'
import {
  useActivePointDevices, usePendingPointCharge, usePointSalePersistence,
  POINT_ONLY_METHODS, type PointChargeStatus, type PointDevice,
} from '@/hooks/useMercadoPagoPoint'

// Fraud prevention: product sales had the same hole Stage C.2 closed for
// session closing (Agenda.tsx) — debit/credit/qr could be recorded via the
// split-payment dropdown with no card actually charged, and unlike gift
// cards/memberships this flow supports multiple payment splits per sale, the
// same shape as session closing's split rows. So this mirrors
// CerrarSesionStep's pattern directly (one shared idempotency key across all
// of a sale's rows, like appointment_id is shared across a session's split
// rows) rather than gift cards' single-payment pattern. Point-gating state
// lives here in the parent (not CartModal) because cart/client already do,
// and because resuming after a reload needs to reopen the modal with the
// right cart/client/splits restored — CartModal only exists while open.
type ProductSalePayload = {
  items: CartSaleItem[]
  splits: CartPaymentSplit[]
  client: Client
  userId: string
}

const SELECT_CLS =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

type CartItem = { supply: Supply; quantity: number }

// ── Success toast ─────────────────────────────────────────────────────────────
function SuccessToast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-sm">
      <CheckCircle className="w-5 h-5 flex-shrink-0" />
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}

// ── Cart Modal ────────────────────────────────────────────────────────────────
function CartModal({
  open, onClose, cart, updateQty, removeFromCart, clearCart,
  selectedClient, setSelectedClient, onSuccess,
  splits, setSplits,
  hasActivePointDevices, pointDevices, selectedDeviceId, setSelectedDeviceId,
  pointStatuses, setRowPointStatus, isTrackedPointRow, rowLocked, pointRowsReady,
  resumeOrderId, idempotencyKey, resetPointState,
}: {
  open: boolean
  onClose: () => void
  cart: CartItem[]
  updateQty: (supplyId: string, qty: number) => void
  removeFromCart: (supplyId: string) => void
  clearCart: () => void
  selectedClient: Client | null
  setSelectedClient: (c: Client | null) => void
  onSuccess: (message: string) => void
  splits: { paymentMethod: string; amount: string }[]
  setSplits: React.Dispatch<React.SetStateAction<{ paymentMethod: string; amount: string }[]>>
  hasActivePointDevices: boolean
  pointDevices: PointDevice[]
  selectedDeviceId: string | null
  setSelectedDeviceId: (id: string | null) => void
  pointStatuses: Record<number, PointChargeStatus>
  setRowPointStatus: (index: number, status: PointChargeStatus) => void
  isTrackedPointRow: (index: number, method: string) => boolean
  rowLocked: (index: number, method: string) => boolean
  pointRowsReady: boolean
  resumeOrderId: string | null
  idempotencyKey: string | null
  resetPointState: () => void
}) {
  const { user, profile, session } = useAuth()
  const tenantId = useTenantId()
  const sellCart = useSellCart()
  const hasCajaAccess = canAccess(profile?.role ?? '', 'caja')

  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const { data: clientResults } = useClients(clientSearch.length >= 1 ? clientSearch : undefined)

  const [error, setError] = useState('')

  const [phase, setPhase] = useState<'form' | 'done'>('form')
  const [cashTxs, setCashTxs] = useState<ResolvedTransaction[]>([])
  const [electronicTxs, setElectronicTxs] = useState<ResolvedTransaction[]>([])
  const [invoiceAnswered, setInvoiceAnswered] = useState(false)
  const [showInvoice, setShowInvoice] = useState(false)
  const [showCloseBlockedMsg, setShowCloseBlockedMsg] = useState(false)
  const invoiceQueue = useElectronicInvoiceQueue({ tenantId })

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)
  const total = cart.reduce((s, i) => s + (i.supply.sale_price ?? 0) * i.quantity, 0)
  const splitsTotal = splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
  const splitsMatch = total > 0 && Math.abs(splitsTotal - total) < 0.01
  const stillProcessing = Object.values(invoiceQueue.results).some((r) => r.status === 'pending')

  const anyPointCharging = Object.values(pointStatuses).some((s) => s === 'creating' || s === 'waiting')
  const hasTrackedPointRow = splits.some((s, i) => isTrackedPointRow(i, s.paymentMethod))

  useEffect(() => {
    if (!showCloseBlockedMsg) return
    const t = setTimeout(() => setShowCloseBlockedMsg(false), 4000)
    return () => clearTimeout(t)
  }, [showCloseBlockedMsg])

  function resetLocalState() {
    setClientSearch('')
    setShowClientDrop(false)
    setError('')
    setPhase('form')
    setCashTxs([])
    setElectronicTxs([])
    setInvoiceAnswered(false)
    setShowInvoice(false)
    resetPointState()
  }

  function handleClose() {
    resetLocalState()
    onClose()
  }

  // Blocks the X button, backdrop click, and Escape alike while a Point
  // charge is actually in flight — same defense-in-depth pattern as
  // AppointmentDetailModal for session closing.
  function handleOpenChange(v: boolean) {
    if (!v && anyPointCharging) {
      setShowCloseBlockedMsg(true)
      return
    }
    if (!v) handleClose()
  }

  function finishSale() {
    clearCart()
    setSelectedClient(null)
    resetLocalState()
    onClose()
  }

  async function handleConfirm() {
    if (cart.length === 0) { setError('El carrito está vacío'); return }
    if (!selectedClient) { setError('Seleccioná un cliente'); return }
    if (!splitsMatch) { setError('La suma de los pagos debe ser igual al total'); return }
    if (!pointRowsReady) { setError('Todavía hay un cobro con Point pendiente de confirmar.'); return }
    if (!user) return
    setError('')
    try {
      const newTxs = await sellCart.mutateAsync({
        items: cart,
        splits: splits.map((s) => ({ paymentMethod: s.paymentMethod, amount: parseFloat(s.amount) || 0 })),
        clientId: selectedClient.id,
        userId: user.id,
      })

      if (hasCajaAccess && tenantId) {
        const electronic = newTxs.filter((tx) => isElectronicPayment(tx.payment_method))
        const cash = newTxs.filter((tx) => !isElectronicPayment(tx.payment_method))
        setElectronicTxs(electronic)
        setCashTxs(cash)

        if (electronic.length > 0 || cash.length > 0) {
          setPhase('done')
          return
        }
      }

      const itemsLabel = `${totalItems} producto${totalItems !== 1 ? 's' : ''}`
      onSuccess(`Venta registrada: ${itemsLabel} por ${formatCurrency(total)}`)
      finishSale()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al registrar la venta')
    }
  }

  // Only fires once the user explicitly answers "Sí" to "¿Querés emitir
  // factura?" — electronic transactions go through the automatic
  // type-resolution queue (still pauses for the A/B choice on Responsable
  // Inscripto tenants), cash/other transactions open the manual invoice form.
  function handleWantInvoice() {
    setInvoiceAnswered(true)
    if (electronicTxs.length > 0) {
      const concept = cart.map((i) => i.supply.name).join(', ')
      const clientNameForInvoice = selectedClient
        ? [selectedClient.first_name, selectedClient.last_name].filter(Boolean).join(' ')
        : 'Consumidor Final'
      void invoiceQueue.startQueue(electronicTxs.map((tx) => ({
        id: tx.id, amount: tx.amount, paymentMethod: tx.payment_method, clientId: tx.client_id,
        clientName: clientNameForInvoice, concept,
      })))
    }
    if (cashTxs.length > 0) {
      setShowInvoice(true)
    }
  }

  const canConfirm = cart.length > 0 && !!selectedClient && splitsMatch && !sellCart.isPending && pointRowsReady
  const cashTotal = cashTxs.reduce((s, t) => s + t.amount, 0)
  const clientNameForInvoice = selectedClient
    ? [selectedClient.first_name, selectedClient.last_name].filter(Boolean).join(' ')
    : 'Consumidor Final'

  // Auto-fire the sale the instant every tracked Point row reports
  // processed — mirrors CerrarSesionStep's pointRowsReady auto-confirm
  // effect (Stage C.2 Part 5): leaving this unconfirmed after a successful
  // charge would mean the money is collected but the sale never recorded,
  // and a later retry could double-charge since the dedup guard only blocks
  // while a charge is still 'created'. hasTrackedPointRow gates out
  // pointRowsReady flipping true for an unrelated reason (e.g. no Point rows
  // at all) — reuses canConfirm itself (the exact gate the button already
  // relies on) as the final check.
  const prevPointRowsReadyRef = useRef(pointRowsReady)
  useEffect(() => {
    const wasReady = prevPointRowsReadyRef.current
    prevPointRowsReadyRef.current = pointRowsReady
    if (!wasReady && pointRowsReady && hasTrackedPointRow && canConfirm) {
      void handleConfirm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointRowsReady, hasTrackedPointRow, canConfirm])

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>{phase === 'done' ? 'Venta registrada' : 'Carrito de compra'}</span>
            {phase === 'form' && (
              <Badge variant="outline">{totalItems} {totalItems === 1 ? 'producto' : 'productos'}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {showCloseBlockedMsg && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            No podés cerrar mientras se espera la confirmación del pago con Point.
          </div>
        )}

        {phase === 'done' ? (
          <div className="space-y-5 py-2">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle className="w-5 h-5" />
              <span className="font-semibold">
                Venta registrada: {totalItems} producto{totalItems !== 1 ? 's' : ''} por {formatCurrency(total)}
              </span>
            </div>

            {Object.keys(invoiceQueue.results).length > 0 && (
              <div className="space-y-1.5">
                {Object.values(invoiceQueue.results).map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    {r.status === 'pending' && (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Emitiendo factura...</span></>
                    )}
                    {r.status === 'done' && (
                      <><CheckCircle className="w-3.5 h-3.5 text-green-600" /><span className="text-green-700">Factura emitida ✓</span></>
                    )}
                    {r.status === 'error' && (
                      <><AlertCircle className="w-3.5 h-3.5 text-red-600 flex-shrink-0" /><span className="text-red-600">{r.message}</span></>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!invoiceAnswered ? (
              <>
                <p className="text-sm text-gray-600">¿Querés emitir factura?</p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleWantInvoice}
                    className="flex-1 bg-plum-700 hover:bg-plum-800 text-white"
                  >
                    Sí, emitir factura
                  </Button>
                  <Button onClick={finishSale} variant="outline" className="flex-1">
                    No, gracias
                  </Button>
                </div>
              </>
            ) : (
              <Button onClick={finishSale} className="w-full" disabled={stillProcessing}>
                {stillProcessing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Emitiendo factura...</> : 'Cerrar'}
              </Button>
            )}
          </div>
        ) : (
        <div className="space-y-4 mt-2">
          {/* Client selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-plum-800">Cliente *</Label>
            {selectedClient ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 border rounded-md text-sm bg-plum-50 text-plum-800 font-medium">
                  {[selectedClient.first_name, selectedClient.last_name].filter(Boolean).join(' ')}
                </div>
                <Button type="button" variant="outline" size="sm" disabled={anyPointCharging}
                  onClick={() => { setSelectedClient(null); setClientSearch('') }}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Buscar cliente por nombre o teléfono..."
                  value={clientSearch}
                  onChange={(e) => { setClientSearch(e.target.value); setShowClientDrop(true) }}
                  onFocus={() => setShowClientDrop(true)}
                  onBlur={() => setTimeout(() => setShowClientDrop(false), 150)}
                />
                {showClientDrop && clientResults && clientResults.length > 0 && (
                  <div className="absolute z-20 w-full bg-white border rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {clientResults.slice(0, 8).map((c) => (
                      <button key={c.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-plum-50 hover:text-plum-800 transition-colors border-b last:border-b-0"
                        onMouseDown={() => {
                          setSelectedClient(c)
                          setClientSearch('')
                          setShowClientDrop(false)
                        }}>
                        <p className="font-medium">{c.first_name} {c.last_name}</p>
                        {c.phone && <p className="text-xs text-muted-foreground">{c.phone}</p>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cart items */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-plum-800">Productos</Label>
            {cart.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">El carrito está vacío</p>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => {
                  const subtotal = (item.supply.sale_price ?? 0) * item.quantity
                  return (
                    <div key={item.supply.id} className="flex items-center gap-2 border rounded-lg p-2.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-plum-800 truncate">{item.supply.name}</p>
                        {item.supply.brand && (
                          <p className="text-xs text-muted-foreground truncate">{item.supply.brand}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button type="button" disabled={anyPointCharging}
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-gray-50 disabled:opacity-30"
                          onClick={() => updateQty(item.supply.id, item.quantity - 1)}>
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{item.quantity}</span>
                        <button type="button" disabled={anyPointCharging}
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-gray-50 disabled:opacity-30"
                          onClick={() => updateQty(item.supply.id, item.quantity + 1)}>
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="w-20 sm:w-24 text-right text-sm font-semibold text-plum-800 tabular-nums flex-shrink-0">
                        {formatCurrency(subtotal)}
                      </div>
                      <button type="button" disabled={anyPointCharging}
                        className="text-muted-foreground hover:text-red-600 transition-colors flex-shrink-0 disabled:opacity-30"
                        onClick={() => removeFromCart(item.supply.id)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {cart.length > 0 && (
            <>
              {/* Totals */}
              <div className="border-t pt-3 space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular-nums">{formatCurrency(total)}</span>
                </div>
                <div className="flex justify-between text-base font-semibold text-plum-800">
                  <span>Total</span>
                  <span className="tabular-nums">{formatCurrency(total)}</span>
                </div>
              </div>

              {/* Payment splits */}
              <div className="space-y-2 border-t pt-3">
                <Label className="text-sm font-semibold text-plum-800">Medios de pago</Label>

                {hasActivePointDevices && pointDevices.length > 1 && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Lector Point</Label>
                    <select
                      className={SELECT_CLS}
                      value={selectedDeviceId ?? ''}
                      onChange={(e) => setSelectedDeviceId(e.target.value || null)}
                    >
                      <option value="">Seleccionar lector...</option>
                      {pointDevices.map((d) => (
                        <option key={d.id} value={d.terminal_id}>{d.label || d.terminal_id}</option>
                      ))}
                    </select>
                  </div>
                )}

                {splits.map((split, idx) => {
                  const rowStatus = pointStatuses[idx] ?? 'idle'
                  const isPointRow = isTrackedPointRow(idx, split.paymentMethod)
                  const locked = rowLocked(idx, split.paymentMethod)
                  const deviceLabel = pointDevices.find((d) => d.terminal_id === selectedDeviceId)?.label ?? null

                  return (
                    <div key={idx} className={cn('space-y-1.5', isPointRow && 'rounded-md border p-2')}>
                      <div className="flex gap-2 items-center">
                        <select
                          className={cn(SELECT_CLS, 'flex-1')}
                          value={split.paymentMethod}
                          disabled={locked}
                          onChange={(e) => setSplits((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, paymentMethod: e.target.value } : s)))}
                        >
                          {PAYMENT_METHODS.map((pm) => (
                            <option key={pm.value} value={pm.value}>{pm.label}</option>
                          ))}
                        </select>
                        <Input
                          type="number" min="0" step="0.01" placeholder="Monto" className="w-28"
                          value={split.amount}
                          disabled={locked}
                          onChange={(e) => setSplits((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, amount: e.target.value } : s)))}
                        />
                        {splits.length > 1 && (
                          <button type="button" disabled={locked}
                            className="text-muted-foreground hover:text-red-600 transition-colors shrink-0 disabled:opacity-30"
                            onClick={() => setSplits((prev) => prev.filter((_, i) => i !== idx))}>
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {isPointRow && (
                        idempotencyKey ? (
                          <PointChargeControl
                            amount={parseFloat(split.amount) || 0}
                            deviceId={selectedDeviceId}
                            deviceLabel={deviceLabel}
                            description={`Venta: ${cart.map((i) => i.supply.name).join(', ')}`}
                            externalReference={`producto-${idempotencyKey}-${idx}`}
                            idempotencyKey={idempotencyKey}
                            paymentMethod={split.paymentMethod}
                            tenantId={tenantId}
                            userId={user!.id}
                            accessToken={session?.access_token ?? ''}
                            status={rowStatus}
                            onStatusChange={(status) => setRowPointStatus(idx, status)}
                            resumeOrderId={idx === 0 ? resumeOrderId : null}
                          />
                        ) : (
                          <p className="text-xs text-muted-foreground">Completá cliente y carrito para cobrar con Point.</p>
                        )
                      )}
                    </div>
                  )
                })}
                <button type="button" disabled={anyPointCharging}
                  className="text-sm text-plum-700 hover:underline flex items-center gap-1 pt-0.5 disabled:opacity-30"
                  onClick={() => setSplits((prev) => [...prev, { paymentMethod: 'cash', amount: '' }])}>
                  <Plus className="w-3.5 h-3.5" />
                  Agregar medio de pago
                </button>
                <div className={cn(
                  'text-sm font-medium tabular-nums',
                  splitsMatch ? 'text-green-600' : 'text-amber-600',
                )}>
                  Total ingresado: {formatCurrency(splitsTotal)} de {formatCurrency(total)}
                  {splitsMatch && ' ✓'}
                </div>
              </div>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose} disabled={sellCart.isPending || anyPointCharging}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              {sellCart.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar venta
            </Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>

    <InvoiceModal
      isOpen={showInvoice}
      onClose={finishSale}
      tenantId={tenantId ?? ''}
      clientName={clientNameForInvoice}
      clientId={selectedClient?.id}
      amount={cashTotal}
      concept={cart.map((i) => i.supply.name).join(', ')}
      transactionId={cashTxs[0]?.id}
    />

    <InvoiceTypeChoiceModal
      open={!!invoiceQueue.pendingChoiceTx}
      onCancel={invoiceQueue.cancelChoice}
      onConfirm={invoiceQueue.resolveChoice}
    />
    </>
  )
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({
  product, inCartQty, onAdd,
}: { product: Supply; inCartQty: number; onAdd: () => void }) {
  return (
    <Card className="hover:shadow-md transition-shadow relative">
      {inCartQty > 0 && (
        <span className="absolute -top-2 -right-2 z-10 flex items-center gap-1 bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full border border-green-300 shadow-sm">
          <Check className="w-3 h-3" /> {inCartQty}
        </span>
      )}
      <CardContent className="p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="w-10 h-10 rounded-xl bg-gold-100 flex items-center justify-center">
            <Package className="w-5 h-5 text-gold-600" />
          </div>
        </div>
        <div>
          <p className="font-semibold text-plum-800 text-sm">{product.name}</p>
          {product.brand && (
            <p className="text-xs text-muted-foreground mt-0.5">{product.brand}</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-auto">
          <span className="text-lg font-bold text-plum-800">
            {product.sale_price ? formatCurrency(product.sale_price) : '—'}
          </span>
          <Button size="sm" onClick={onAdd} disabled={!product.sale_price}>
            <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
            Agregar al carrito
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Productos() {
  const { user } = useAuth()
  const tenantId = useTenantId()
  const { data: products = [], isLoading } = useSellableSupplies()
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [successMessage, setSuccessMessage] = useState('')

  // ── Point gating (fraud prevention) ─────────────────────────────────────────
  // Lives here, not in CartModal, because cart/client already live here, and
  // because resuming a charge after a reload needs to reopen the modal with
  // the right cart/client/splits restored — CartModal only exists while open.
  const [splits, setSplits] = useState<{ paymentMethod: string; amount: string }[]>([
    { paymentMethod: 'cash', amount: '' },
  ])
  const { data: pointDevices = [] } = useActivePointDevices(tenantId)
  const hasActivePointDevices = pointDevices.length > 0
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [pointStatuses, setPointStatuses] = useState<Record<number, PointChargeStatus>>({})
  const [resumeOrderId, setResumeOrderId] = useState<string | null>(null)
  const resumeAppliedRef = useRef(false)

  const { idempotencyKey, resumedPayload, ensureKey, syncPayload, clearKey } =
    usePointSalePersistence<ProductSalePayload>('product', tenantId)
  const { data: pendingCharge } = usePendingPointCharge({ idempotencyKey })

  useEffect(() => {
    if (pointDevices.length === 1) setSelectedDeviceId(pointDevices[0].terminal_id)
  }, [pointDevices])

  function setRowPointStatus(index: number, status: PointChargeStatus) {
    setPointStatuses((prev) => ({ ...prev, [index]: status }))
  }

  // A resumed row must stay tracked even if devices were deactivated in the
  // meantime, mirroring Agenda.tsx's isTrackedPointRow.
  function isTrackedPointRow(index: number, method: string): boolean {
    return (hasActivePointDevices || (index === 0 && !!resumeOrderId)) && POINT_ONLY_METHODS.includes(method)
  }

  function rowLocked(index: number, method: string): boolean {
    if (!isTrackedPointRow(index, method)) return false
    const s = pointStatuses[index] ?? 'idle'
    return s === 'creating' || s === 'waiting' || s === 'processed'
  }

  const pointRowsReady = splits.every((s, i) => !isTrackedPointRow(i, s.paymentMethod) || pointStatuses[i] === 'processed')

  function resetPointState() {
    clearKey()
    setPointStatuses({})
    setResumeOrderId(null)
    resumeAppliedRef.current = false
    setSplits([{ paymentMethod: 'cash', amount: '' }])
  }

  // Resume: restore cart/client/splits captured right before the charge
  // started, and reopen the modal. After a reload React state is gone — a
  // resumed charge that reaches 'processed' would otherwise have nothing
  // valid to submit despite the customer having been charged.
  useEffect(() => {
    if (resumeAppliedRef.current || !pendingCharge) return
    resumeAppliedRef.current = true
    setSplits([{ paymentMethod: pendingCharge.payment_method, amount: String(pendingCharge.amount) }])
    setPointStatuses({ 0: 'waiting' })
    setSelectedDeviceId(pendingCharge.terminal_id)
    setResumeOrderId(pendingCharge.mp_order_id)
    if (resumedPayload) {
      setCart(resumedPayload.items.map((i) => ({ supply: i.supply, quantity: i.quantity })))
      setSelectedClient(resumedPayload.client)
    }
    setCartOpen(true)
  }, [pendingCharge, resumedPayload])

  // Mints the idempotency key (freezing the sale payload alongside it) the
  // moment the cart has a Point-gated row with cart+client already filled
  // in, then keeps the persisted payload in sync with live edits until a
  // charge actually starts — past that point rows are locked, so the
  // last-synced snapshot can't go stale relative to what gets submitted.
  useEffect(() => {
    if (!cartOpen) return
    const hasPointRow = splits.some((s, i) => isTrackedPointRow(i, s.paymentMethod))
    const anyCharging = Object.values(pointStatuses).some((s) => s === 'creating' || s === 'waiting')
    if (!hasPointRow || anyCharging) return
    if (cart.length === 0 || !selectedClient || !user) return
    const payload: ProductSalePayload = {
      items: cart.map((i) => ({ supply: i.supply, quantity: i.quantity })),
      splits: splits.map((s) => ({ paymentMethod: s.paymentMethod, amount: parseFloat(s.amount) || 0 })),
      client: selectedClient,
      userId: user.id,
    }
    if (!idempotencyKey) ensureKey(payload)
    else syncPayload(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartOpen, splits, cart, selectedClient])

  // Best-effort defense-in-depth, same posture as GiftCardForm/VenderMembresiaModal.
  useEffect(() => {
    const anyCharging = Object.values(pointStatuses).some((s) => s === 'creating' || s === 'waiting')
    if (!anyCharging) return
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [pointStatuses])

  function addToCart(supply: Supply) {
    setCart((prev) => {
      const existing = prev.find((i) => i.supply.id === supply.id)
      if (existing) {
        return prev.map((i) => (i.supply.id === supply.id ? { ...i, quantity: i.quantity + 1 } : i))
      }
      return [...prev, { supply, quantity: 1 }]
    })
  }

  function removeFromCart(supplyId: string) {
    setCart((prev) => prev.filter((i) => i.supply.id !== supplyId))
  }

  function updateQty(supplyId: string, qty: number) {
    const q = Math.max(1, qty)
    setCart((prev) => prev.map((i) => (i.supply.id === supplyId ? { ...i, quantity: q } : i)))
  }

  function clearCart() {
    setCart([])
  }

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)

  const filtered = query.trim()
    ? products.filter((p) => {
        const q = query.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      })
    : products

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Productos</h1>
          <p className="text-muted-foreground text-sm mt-1">Productos disponibles para venta al público</p>
        </div>
        <Button
          variant={totalItems > 0 ? 'default' : 'outline'}
          className={totalItems > 0 ? 'bg-plum-800 hover:bg-plum-900 text-white flex-shrink-0' : 'flex-shrink-0'}
          onClick={() => setCartOpen(true)}
        >
          <span className="relative inline-flex mr-2">
            <ShoppingCart className="w-4 h-4" />
            {totalItems > 0 && (
              <span className="absolute -top-2 -right-2.5 bg-gold-500 text-plum-900 text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {totalItems}
              </span>
            )}
          </span>
          Carrito
        </Button>
      </div>

      {/* Search bar */}
      {!isLoading && products.length > 0 && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar producto..."
            className="pl-9"
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm">Sin productos disponibles</p>
          <p className="text-xs mt-1">
            Creá insumos vendibles en{' '}
            <span className="text-plum-700 font-medium">Configuración → Insumos</span>
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <Search className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-sm">No se encontraron productos para tu búsqueda</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              inCartQty={cart.find((i) => i.supply.id === p.id)?.quantity ?? 0}
              onAdd={() => addToCart(p)}
            />
          ))}
        </div>
      )}

      <CartModal
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        cart={cart}
        updateQty={updateQty}
        removeFromCart={removeFromCart}
        clearCart={clearCart}
        selectedClient={selectedClient}
        setSelectedClient={setSelectedClient}
        onSuccess={setSuccessMessage}
        splits={splits}
        setSplits={setSplits}
        hasActivePointDevices={hasActivePointDevices}
        pointDevices={pointDevices}
        selectedDeviceId={selectedDeviceId}
        setSelectedDeviceId={setSelectedDeviceId}
        pointStatuses={pointStatuses}
        setRowPointStatus={setRowPointStatus}
        isTrackedPointRow={isTrackedPointRow}
        rowLocked={rowLocked}
        pointRowsReady={pointRowsReady}
        resumeOrderId={resumeOrderId}
        idempotencyKey={idempotencyKey}
        resetPointState={resetPointState}
      />

      {successMessage && (
        <SuccessToast message={successMessage} onDone={() => setSuccessMessage('')} />
      )}
    </div>
  )
}

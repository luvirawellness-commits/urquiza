import { useEffect, useState } from 'react'
import {
  ShoppingCart, Loader2, Package, Search, Check, CheckCircle, Plus, Minus, Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSellableSupplies, useSellCart } from '@/hooks/useSupplies'
import { useClients } from '@/hooks/useClients'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn, formatCurrency } from '@/lib/utils'
import type { Supply, Client } from '@/types'

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
] as const

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
}) {
  const { user } = useAuth()
  const sellCart = useSellCart()

  const [clientSearch, setClientSearch] = useState('')
  const [showClientDrop, setShowClientDrop] = useState(false)
  const { data: clientResults } = useClients(clientSearch.length >= 1 ? clientSearch : undefined)

  const [splits, setSplits] = useState<{ paymentMethod: string; amount: string }[]>([
    { paymentMethod: 'cash', amount: '' },
  ])
  const [error, setError] = useState('')

  const totalItems = cart.reduce((s, i) => s + i.quantity, 0)
  const total = cart.reduce((s, i) => s + (i.supply.sale_price ?? 0) * i.quantity, 0)
  const splitsTotal = splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
  const splitsMatch = total > 0 && Math.abs(splitsTotal - total) < 0.01

  function resetLocalState() {
    setClientSearch('')
    setShowClientDrop(false)
    setSplits([{ paymentMethod: 'cash', amount: '' }])
    setError('')
  }

  function handleClose() {
    resetLocalState()
    onClose()
  }

  async function handleConfirm() {
    if (cart.length === 0) { setError('El carrito está vacío'); return }
    if (!selectedClient) { setError('Seleccioná un cliente'); return }
    if (!splitsMatch) { setError('La suma de los pagos debe ser igual al total'); return }
    if (!user) return
    setError('')
    try {
      await sellCart.mutateAsync({
        items: cart,
        splits: splits.map((s) => ({ paymentMethod: s.paymentMethod, amount: parseFloat(s.amount) || 0 })),
        clientId: selectedClient.id,
        userId: user.id,
      })
      const itemsLabel = `${totalItems} producto${totalItems !== 1 ? 's' : ''}`
      onSuccess(`Venta registrada: ${itemsLabel} por ${formatCurrency(total)}`)
      clearCart()
      setSelectedClient(null)
      resetLocalState()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al registrar la venta')
    }
  }

  const canConfirm = cart.length > 0 && !!selectedClient && splitsMatch && !sellCart.isPending

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Carrito de compra</span>
            <Badge variant="outline">{totalItems} {totalItems === 1 ? 'producto' : 'productos'}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Client selector */}
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-plum-800">Cliente *</Label>
            {selectedClient ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 border rounded-md text-sm bg-plum-50 text-plum-800 font-medium">
                  {[selectedClient.first_name, selectedClient.last_name].filter(Boolean).join(' ')}
                </div>
                <Button type="button" variant="outline" size="sm"
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
                        <button type="button"
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-gray-50"
                          onClick={() => updateQty(item.supply.id, item.quantity - 1)}>
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{item.quantity}</span>
                        <button type="button"
                          className="w-6 h-6 rounded border flex items-center justify-center hover:bg-gray-50"
                          onClick={() => updateQty(item.supply.id, item.quantity + 1)}>
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="w-20 sm:w-24 text-right text-sm font-semibold text-plum-800 tabular-nums flex-shrink-0">
                        {formatCurrency(subtotal)}
                      </div>
                      <button type="button"
                        className="text-muted-foreground hover:text-red-600 transition-colors flex-shrink-0"
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
                {splits.map((split, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <select
                      className={cn(SELECT_CLS, 'flex-1')}
                      value={split.paymentMethod}
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
                      onChange={(e) => setSplits((prev) =>
                        prev.map((s, i) => (i === idx ? { ...s, amount: e.target.value } : s)))}
                    />
                    {splits.length > 1 && (
                      <button type="button"
                        className="text-muted-foreground hover:text-red-600 transition-colors shrink-0"
                        onClick={() => setSplits((prev) => prev.filter((_, i) => i !== idx))}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                <button type="button"
                  className="text-sm text-plum-700 hover:underline flex items-center gap-1 pt-0.5"
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
            <Button variant="outline" onClick={handleClose} disabled={sellCart.isPending}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              {sellCart.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar venta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const { data: products = [], isLoading } = useSellableSupplies()
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [successMessage, setSuccessMessage] = useState('')

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
      />

      {successMessage && (
        <SuccessToast message={successMessage} onDone={() => setSuccessMessage('')} />
      )}
    </div>
  )
}

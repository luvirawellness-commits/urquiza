import { useState } from 'react'
import { ShoppingCart, Loader2, Package, Search } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useSellableSupplies } from '@/hooks/useSupplies'
import { useInsertTransaction } from '@/hooks/useFinanzas'
import { TENANT_ID } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatCurrency } from '@/lib/utils'
import type { Supply } from '@/types'

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'mp', label: 'Mercado Pago' },
]

// ── Vender Producto Modal ─────────────────────────────────────────────────────
function VenderProductoModal({
  product, onClose,
}: {
  product: Supply | null; onClose: () => void
}) {
  const { profile } = useAuth()
  const insertTx = useInsertTransaction()
  const [qty, setQty] = useState('1')
  const [pm, setPm] = useState('cash')
  const [error, setError] = useState('')

  if (!product) return null

  const unitPrice = product.sale_price ?? 0
  const total = unitPrice * (parseInt(qty) || 1)

  async function handleSell() {
    if (!product) return
    const q = parseInt(qty) || 0
    if (q <= 0) { setError('Cantidad inválida'); return }
    if (!unitPrice) { setError('Este producto no tiene precio de venta'); return }
    setError('')
    try {
      const payload = {
        tenant_id: TENANT_ID,
        type: 'income' as const,
        category: 'product',
        amount: unitPrice * q,
        payment_method: pm,
        date: new Date().toISOString().split('T')[0],
        user_id: profile!.id,
        description: `Venta producto: ${product.name} x${q}`,
        status: 'paid',
        is_recurring: false,
      }
      await insertTx.mutateAsync(payload)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al registrar venta')
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Vender producto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="font-medium text-plum-800">{product.name}</p>
            <p className="text-sm text-muted-foreground">Precio: {formatCurrency(unitPrice)}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cantidad</Label>
              <Input
                type="number" min="1" value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Medio de pago</Label>
              <select
                value={pm}
                onChange={(e) => setPm(e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-sm font-medium text-plum-800">Total</span>
            <span className="text-lg font-bold text-plum-800">{formatCurrency(total)}</span>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSell} disabled={insertTx.isPending}>
              {insertTx.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar venta
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Product Card ──────────────────────────────────────────────────────────────
function ProductCard({ product, onSell }: { product: Supply; onSell: () => void }) {
  return (
    <Card className="hover:shadow-md transition-shadow">
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
          <Button size="sm" onClick={onSell} disabled={!product.sale_price}>
            <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
            Vender
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Productos() {
  const { data: products = [], isLoading } = useSellableSupplies()
  const [selling, setSelling] = useState<Supply | null>(null)
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? products.filter((p) => {
        const q = query.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)
      })
    : products

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Productos</h1>
          <p className="text-muted-foreground text-sm mt-1">Productos disponibles para venta al público</p>
        </div>
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
            <ProductCard key={p.id} product={p} onSell={() => setSelling(p)} />
          ))}
        </div>
      )}

      {selling && (
        <VenderProductoModal product={selling} onClose={() => setSelling(null)} />
      )}
    </div>
  )
}

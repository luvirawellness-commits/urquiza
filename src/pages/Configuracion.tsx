import { useState, useMemo, useEffect } from 'react'
import { getArgentinaDateString } from '../utils/dateUtils'
import { Plus, Trash2, Pencil, Loader2, Package, PackagePlus, ClipboardList, ChevronDown, ChevronUp, Check, TrendingUp, RotateCcw, FileDown } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useAuditLog } from '@/hooks/useAuditLog'
import { useServices, useUpdateServicePrice } from '@/hooks/useAppointments'
import { useMembershipPlans, useUpdateMembershipPrice } from '@/hooks/useClientMemberships'
import {
  useSupplies,
  useSellableSupplies,
  useCreateSupply,
  useUpdateSupply,
  useDeleteSupply,
  useAllServiceCostItems,
  useAddCostItem,
  useRemoveCostItem,
  useUpdateSupplySalePrice,
} from '@/hooks/useSupplies'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useInventoryMovements,
  useInventoryCounts,
  useCountItems,
  useConfirmedCountsWithItems,
  useInsertMovement,
  useCreateCount,
} from '@/hooks/useInventario'
import { cn, formatCurrency, exportToExcel, MONTHS_ES } from '@/lib/utils'
import type { Supply, InventoryCount } from '@/types'
import {
  useTenantPaymentSettings,
  useUpdatePaymentSettings,
  useMonthlyBalances,
  useUpsertMonthlyBalance,
} from '@/hooks/useTreasury'

const UNITS = ['unidad', 'ml', 'litro', 'kg', 'gramo', 'min']

// ── Supply Modal ──────────────────────────────────────────────────────────────
type SupplyForm = {
  code: string; name: string; brand: string; unit: string
  unit_price: string; category: 'internal' | 'product'
  is_sellable: boolean; sale_price: string; active: boolean; notes: string
}

const EMPTY_FORM: SupplyForm = {
  code: '', name: '', brand: '', unit: 'unidad',
  unit_price: '0', category: 'internal',
  is_sellable: false, sale_price: '', active: true, notes: '',
}

function supplyToForm(s: Supply): SupplyForm {
  return {
    code: s.code, name: s.name, brand: s.brand ?? '',
    unit: s.unit, unit_price: String(s.unit_price),
    category: s.category, is_sellable: s.is_sellable,
    sale_price: s.sale_price != null ? String(s.sale_price) : '',
    active: s.active, notes: s.notes ?? '',
  }
}

function SupplyModal({
  open, onClose, supply,
}: {
  open: boolean; onClose: () => void; supply?: Supply
}) {
  const [form, setForm] = useState<SupplyForm>(supply ? supplyToForm(supply) : EMPTY_FORM)
  const [error, setError] = useState('')
  const createMutation = useCreateSupply()
  const updateMutation = useUpdateSupply()
  const isLoading = createMutation.isPending || updateMutation.isPending

  function setField<K extends keyof SupplyForm>(k: K, v: SupplyForm[K]) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSubmit() {
    if (!form.code.trim() || !form.name.trim()) {
      setError('Código y nombre son obligatorios.')
      return
    }
    setError('')
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      brand: form.brand || undefined,
      unit: form.unit,
      unit_price: parseFloat(form.unit_price) || 0,
      category: form.category,
      is_sellable: form.is_sellable,
      sale_price: form.is_sellable && form.sale_price ? parseFloat(form.sale_price) : undefined,
      active: form.active,
      notes: form.notes || undefined,
    }
    try {
      if (supply) {
        await updateMutation.mutateAsync({ id: supply.id, ...payload })
      } else {
        await createMutation.mutateAsync(payload)
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{supply ? 'Editar insumo' : 'Nuevo insumo'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Código *</Label>
              <Input
                value={form.code}
                onChange={(e) => setField('code', e.target.value)}
                placeholder="MTPHS"
              />
            </div>
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => setField('name', e.target.value)}
                placeholder="Nombre del insumo"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Unidad</Label>
              <select
                value={form.unit}
                onChange={(e) => setField('unit', e.target.value)}
                className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-plum-500"
              >
                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Precio unitario</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.unit_price}
                onChange={(e) => setField('unit_price', e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Categoría</Label>
            <select
              value={form.category}
              onChange={(e) => setField('category', e.target.value as 'internal' | 'product')}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-plum-500"
            >
              <option value="internal">Interno (uso en tratamientos)</option>
              <option value="product">Producto (vendible)</option>
            </select>
          </div>
          {form.category === 'product' && (
            <div className="space-y-3 pl-3 border-l-2 border-gold-300">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="is_sellable"
                  checked={form.is_sellable}
                  onChange={(e) => setField('is_sellable', e.target.checked)}
                  className="w-4 h-4 accent-plum-700"
                />
                <Label htmlFor="is_sellable" className="cursor-pointer">¿Vendible al público?</Label>
              </div>
              {form.is_sellable && (
                <div className="space-y-1">
                  <Label>Precio de venta</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sale_price}
                    onChange={(e) => setField('sale_price', e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Marca / Proveedor</Label>
              <Input
                value={form.brand}
                onChange={(e) => setField('brand', e.target.value)}
                placeholder="Opcional"
              />
            </div>
            <div className="flex items-end pb-1">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="active"
                  checked={form.active}
                  onChange={(e) => setField('active', e.target.checked)}
                  className="w-4 h-4 accent-plum-700"
                />
                <Label htmlFor="active" className="cursor-pointer">Activo</Label>
              </div>
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {supply ? 'Guardar cambios' : 'Crear insumo'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Tab Insumos ───────────────────────────────────────────────────────────────
function TabInsumos() {
  const { data: supplies = [], isLoading } = useSupplies()
  const deleteMutation = useDeleteSupply()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Supply | undefined>()

  function openCreate() { setEditing(undefined); setModalOpen(true) }
  function openEdit(s: Supply) { setEditing(s); setModalOpen(true) }
  function closeModal() { setModalOpen(false); setEditing(undefined) }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">{supplies.length} insumos registrados</p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              exportToExcel(
                supplies.map((s) => ({
                  'Código': s.code,
                  'Nombre': s.name,
                  'Unidad': s.unit,
                  'Precio unitario': s.unit_price,
                  'Categoría': s.category === 'product' ? 'Producto' : 'Interno',
                  'Estado': s.active ? 'Activo' : 'Inactivo',
                })),
                'insumos.xlsx',
                'Insumos',
              )
            }
            disabled={supplies.length === 0}
          >
            <FileDown className="w-4 h-4 mr-1" />Exportar Excel
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" />Nuevo insumo
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Código</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Nombre</th>
                <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Unidad</th>
                <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Precio unit.</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Categoría</th>
                <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {supplies.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-gray-50/50">
                  <td className="px-4 py-2.5 text-sm font-mono font-medium text-plum-700">{s.code}</td>
                  <td className="px-4 py-2.5 text-sm text-plum-800">{s.name}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-600">{s.unit}</td>
                  <td className="px-4 py-2.5 text-sm text-right tabular-nums font-medium text-plum-800">
                    {formatCurrency(s.unit_price)}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant="outline" className={cn(
                      'text-xs',
                      s.category === 'product' ? 'border-gold-400 text-gold-700' : 'border-plum-300 text-plum-700',
                    )}>
                      {s.category === 'product' ? 'Producto' : 'Interno'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge variant={s.active ? 'default' : 'secondary'} className="text-xs">
                      {s.active ? 'Activo' : 'Inactivo'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost" size="icon"
                        className="w-7 h-7 text-muted-foreground hover:text-plum-800"
                        onClick={() => openEdit(s)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost" size="icon"
                        className="w-7 h-7 text-muted-foreground hover:text-red-600"
                        onClick={() => deleteMutation.mutate(s.id)}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {supplies.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Sin insumos registrados</p>
            </div>
          )}
        </CardContent>
      </Card>
      <SupplyModal open={modalOpen} onClose={closeModal} supply={editing} />
    </div>
  )
}

// ── Add Cost Item Modal ───────────────────────────────────────────────────────
function AddCostItemModal({
  open, onClose, serviceId, duration,
}: {
  open: boolean; onClose: () => void; serviceId: string; duration: 60 | 90
}) {
  const { data: supplies = [] } = useSupplies()
  const addMutation = useAddCostItem()
  const [supplyId, setSupplyId] = useState('')
  const [qty, setQty] = useState('1')
  const [error, setError] = useState('')

  const selectedSupply = supplies.find((s) => s.id === supplyId)
  const cost = selectedSupply
    ? selectedSupply.unit === 'min'
      ? (selectedSupply.unit_price / 60) * (parseFloat(qty) || 0)
      : selectedSupply.unit_price * (parseFloat(qty) || 0)
    : 0

  async function handleAdd() {
    if (!supplyId) { setError('Seleccioná un insumo.'); return }
    const q = parseFloat(qty)
    if (!q || q <= 0) { setError('Cantidad inválida.'); return }
    setError('')
    try {
      await addMutation.mutateAsync({ service_id: serviceId, duration_minutes: duration, supply_id: supplyId, quantity: q })
      setSupplyId(''); setQty('1'); onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agregar insumo — {duration} min</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Insumo</Label>
            <select
              value={supplyId}
              onChange={(e) => { setSupplyId(e.target.value); setError('') }}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none"
            >
              <option value="">— Seleccionar —</option>
              {supplies.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Cantidad {selectedSupply ? `(${selectedSupply.unit})` : ''}</Label>
            <Input
              type="number" min="0.001" step="0.001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
            />
          </div>
          {selectedSupply && cost > 0 && (
            <p className="text-sm text-muted-foreground bg-gray-50 rounded-md px-3 py-2">
              Costo por sesión: <span className="font-semibold text-plum-800">{formatCurrency(cost)}</span>
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleAdd} disabled={addMutation.isPending}>
              {addMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Tab Estructura de Costos ──────────────────────────────────────────────────

function ProductPriceRow({ supply }: { supply: Supply }) {
  const [unitVal, setUnitVal] = useState(String(supply.unit_price))
  const [saleVal, setSaleVal] = useState(String(supply.sale_price ?? ''))
  const [savedUnit, setSavedUnit] = useState(false)
  const [savedSale, setSavedSale] = useState(false)
  const updateSupply = useUpdateSupply()
  const updateSalePrice = useUpdateSupplySalePrice()

  const unitNum = parseFloat(unitVal) || 0
  const saleNum = parseFloat(saleVal) || 0
  const margin = saleNum > 0 ? saleNum - unitNum : null
  const cmvPctVal = saleNum > 0 ? (unitNum / saleNum) * 100 : null

  async function handleUnitBlur() {
    const next = parseFloat(unitVal) || 0
    if (next === supply.unit_price) return
    const { tenant_id: _t, created_at: _c, updated_at: _u, ...rest } = supply
    await updateSupply.mutateAsync({ ...rest, unit_price: next })
    setSavedUnit(true)
    setTimeout(() => setSavedUnit(false), 2000)
  }

  async function handleSaleBlur() {
    const next = parseFloat(saleVal) || 0
    if (next === (supply.sale_price ?? 0)) return
    await updateSalePrice.mutateAsync({ id: supply.id, salePrice: next })
    setSavedSale(true)
    setTimeout(() => setSavedSale(false), 2000)
  }

  const marginCls = margin === null ? 'text-muted-foreground' : margin > 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'
  const cmvCls = cmvPctVal === null ? 'text-muted-foreground' : cmvPctVal < 30 ? 'text-green-600' : cmvPctVal <= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <tr className="border-b last:border-0 hover:bg-gray-50/50">
      <td className="px-4 py-2.5">
        <p className="text-sm font-medium text-plum-800">{supply.name}</p>
        <span className="inline-block text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded mt-0.5">{supply.code}</span>
      </td>
      <td className="px-4 py-2.5 text-center text-sm text-gray-500">{supply.unit}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1 justify-end">
          {updateSupply.isPending
            ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            : savedUnit
              ? <Check className="w-3 h-3 text-green-600" />
              : null
          }
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input
              type="number" min="0" step="1"
              value={unitVal}
              onChange={(e) => setUnitVal(e.target.value)}
              onBlur={handleUnitBlur}
              className="pl-5 h-7 text-sm text-right tabular-nums"
            />
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1 justify-end">
          {updateSalePrice.isPending
            ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            : savedSale
              ? <Check className="w-3 h-3 text-green-600" />
              : null
          }
          <div className="relative w-28">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">$</span>
            <Input
              type="number" min="0" step="1"
              value={saleVal}
              onChange={(e) => setSaleVal(e.target.value)}
              onBlur={handleSaleBlur}
              className="pl-5 h-7 text-sm text-right tabular-nums"
            />
          </div>
        </div>
      </td>
      <td className={cn('px-4 py-2.5 text-right text-sm tabular-nums', marginCls)}>
        {margin === null ? '—' : formatCurrency(margin)}
      </td>
      <td className={cn('px-4 py-2.5 text-center text-sm font-medium tabular-nums', cmvCls)}>
        {cmvPctVal === null ? '—' : `${cmvPctVal.toFixed(1)}%`}
      </td>
    </tr>
  )
}

function TabCostos({ onNavigateToInsumos }: { onNavigateToInsumos?: () => void }) {
  const { data: services = [], isLoading: svLoading } = useServices()
  const { data: costItems = [], isLoading: ciLoading } = useAllServiceCostItems()
  const { data: products = [], isLoading: productsLoading } = useSellableSupplies()
  const removeMutation = useRemoveCostItem()
  const [selectedServiceId, setSelectedServiceId] = useState<string>('')
  const [addModal, setAddModal] = useState<{ open: boolean; duration: 60 | 90 }>({ open: false, duration: 60 })

  const activeServices = useMemo(() => services, [services])

  const selectedService = activeServices.find((s) => s.id === selectedServiceId)

  function getCostItems(serviceId: string, dur: 60 | 90) {
    return costItems.filter((ci) => ci.service_id === serviceId && ci.duration_minutes === dur)
  }

  function cmvForDuration(serviceId: string, dur: 60 | 90): number {
    return getCostItems(serviceId, dur).reduce((sum, ci) => {
      const price = ci.supply?.unit_price ?? 0
      const cost = ci.supply?.unit === 'min' ? (price / 60) * ci.quantity : price * ci.quantity
      return sum + cost
    }, 0)
  }

  const avgProductCmv = useMemo(() => {
    const eligible = products.filter((p) => (p.sale_price ?? 0) > 0)
    if (eligible.length === 0) return null
    const totalCost = eligible.reduce((sum, p) => sum + p.unit_price, 0)
    const totalRevenue = eligible.reduce((sum, p) => sum + (p.sale_price ?? 0), 0)
    return (totalCost / totalRevenue) * 100
  }, [products])

  if (svLoading || ciLoading || productsLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Servicio:</Label>
        <select
          value={selectedServiceId}
          onChange={(e) => setSelectedServiceId(e.target.value)}
          className="border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none min-w-[220px]"
        >
          <option value="">— Seleccionar servicio —</option>
          {activeServices.map((s) => (
            <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
          ))}
        </select>
      </div>

      {!selectedService ? (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <p className="text-sm">Seleccioná un servicio para ver su estructura de costos</p>
        </div>
      ) : (
        <div className="space-y-5">
          {([60, 90] as const).map((dur) => {
            const items = getCostItems(selectedService.id, dur)
            const cmv = cmvForDuration(selectedService.id, dur)
            return (
              <Card key={dur}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm text-plum-800">
                      {selectedService.emoji} {selectedService.name} — {dur} min
                      <span className="ml-3 text-xs font-normal text-muted-foreground">
                        CMV Teórico: <span className="font-semibold text-plum-700">{formatCurrency(cmv)}</span>
                      </span>
                    </CardTitle>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setAddModal({ open: true, duration: dur })}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />Agregar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">Sin insumos asignados</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left text-xs text-muted-foreground font-medium pb-2">Insumo</th>
                          <th className="text-center text-xs text-muted-foreground font-medium pb-2">Unidad</th>
                          <th className="text-right text-xs text-muted-foreground font-medium pb-2">Cantidad</th>
                          <th className="text-right text-xs text-muted-foreground font-medium pb-2">Costo unit.</th>
                          <th className="text-right text-xs text-muted-foreground font-medium pb-2">Total</th>
                          <th className="w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((ci) => {
                          const price = ci.supply?.unit_price ?? 0
                          const unitCost = ci.supply?.unit === 'min' ? price / 60 : price
                          const total = unitCost * ci.quantity
                          return (
                            <tr key={ci.id} className="border-b last:border-0">
                              <td className="py-2 text-sm text-plum-800">{ci.supply?.name}</td>
                              <td className="py-2 text-sm text-center text-gray-500">{ci.supply?.unit}</td>
                              <td className="py-2 text-sm text-right tabular-nums text-gray-700">{ci.quantity}</td>
                              <td className="py-2 text-sm text-right tabular-nums text-gray-700">
                                {formatCurrency(unitCost)}
                              </td>
                              <td className="py-2 text-sm text-right tabular-nums font-medium text-plum-800">
                                {formatCurrency(total)}
                              </td>
                              <td className="py-2">
                                <Button
                                  variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-red-600"
                                  onClick={() => removeMutation.mutate(ci.id)}
                                  disabled={removeMutation.isPending}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Productos a la venta ── */}
      <div className="space-y-3 pt-2 border-t">
        <p className="text-sm font-semibold text-plum-800 pt-2">Productos a la venta</p>
        {products.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-gray-50 rounded-xl space-y-1.5">
            <p className="text-sm">No hay productos configurados.</p>
            <button
              onClick={onNavigateToInsumos}
              className="text-sm text-plum-700 hover:text-plum-900 underline underline-offset-2"
            >
              Agregá productos vendibles en la pestaña Insumos.
            </button>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Producto</th>
                    <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Unidad</th>
                    <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Costo unitario ($)</th>
                    <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Precio de venta ($)</th>
                    <th className="text-right text-xs text-muted-foreground font-medium px-4 py-2.5">Margen bruto</th>
                    <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">CMV %</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => <ProductPriceRow key={p.id} supply={p} />)}
                </tbody>
              </table>
              {avgProductCmv !== null && (
                <div className="border-t px-4 py-2.5 flex items-center justify-end gap-2 bg-gray-50/50">
                  <span className="text-xs text-muted-foreground">CMV promedio:</span>
                  <span className={cn(
                    'text-xs font-semibold tabular-nums',
                    avgProductCmv < 30 ? 'text-green-600' : avgProductCmv <= 50 ? 'text-amber-600' : 'text-red-600',
                  )}>
                    {avgProductCmv.toFixed(1)}%
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <AddCostItemModal
        open={addModal.open}
        onClose={() => setAddModal((m) => ({ ...m, open: false }))}
        serviceId={selectedServiceId}
        duration={addModal.duration}
      />
    </div>
  )
}

// ── Inventario: Ingresar Stock Modal ─────────────────────────────────────────
function IngresarStockModal({ open, onClose, supplies }: {
  open: boolean; onClose: () => void; supplies: Supply[]
}) {
  const insertMov = useInsertMovement()
  const updateSupply = useUpdateSupply()
  const [supplyId, setSupplyId] = useState('')
  const [qty, setQty] = useState('1')
  const [unitCost, setUnitCost] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [fecha, setFecha] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setSupplyId(''); setQty('1'); setUnitCost(''); setProveedor(''); setNotes(''); setError('')
      setFecha(getArgentinaDateString())
    }
  }, [open])

  const selected = supplies.find((s) => s.id === supplyId)

  async function handleSave() {
    if (!supplyId) { setError('Seleccioná un insumo'); return }
    const quantity = parseFloat(qty) || 0
    if (quantity <= 0) { setError('Cantidad inválida'); return }
    setError('')
    try {
      const today = getArgentinaDateString()
      const noteParts = [
        proveedor ? `Proveedor: ${proveedor}` : null,
        fecha && fecha !== today ? `Fecha de ingreso: ${fecha}` : null,
        notes || null,
      ].filter(Boolean)
      await insertMov.mutateAsync({
        supply_id: supplyId,
        type: 'entry',
        quantity,
        unit_cost: unitCost ? parseFloat(unitCost) : undefined,
        notes: noteParts.length ? noteParts.join(' · ') : undefined,
      })
      if (unitCost && selected && parseFloat(unitCost) !== selected.unit_price) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { tenant_id, created_at, updated_at, ...rest } = selected
        await updateSupply.mutateAsync({ ...rest, unit_price: parseFloat(unitCost) })
      }
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al registrar ingreso')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Ingresar stock</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="space-y-1">
            <Label>Insumo / Producto</Label>
            <select
              value={supplyId}
              onChange={(e) => {
                setSupplyId(e.target.value)
                const s = supplies.find((x) => x.id === e.target.value)
                if (s) setUnitCost(s.unit_price?.toString() ?? '')
              }}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none"
            >
              <option value="">Seleccioná...</option>
              {supplies.filter((s) => s.active).map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cantidad ({selected?.unit ?? 'unid.'})</Label>
              <Input type="number" min="0" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Costo unitario</Label>
              <Input
                type="number" min="0" step="0.01" value={unitCost}
                placeholder={selected?.unit_price?.toString() ?? '0'}
                onChange={(e) => setUnitCost(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Proveedor</Label>
              <Input value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-1">
              <Label>Fecha</Label>
              <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notas</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={insertMov.isPending || updateSupply.isPending}>
              {(insertMov.isPending || updateSupply.isPending) && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              Guardar ingreso
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Inventario: Conteo Físico Modal ───────────────────────────────────────────
type ConteoRow = {
  supplyId: string; name: string; code: string; unit: string
  theoretical: number; physical: string
}

type SupplyStats = {
  entries: number; sessions: number; sales: number; adjustments: number
  theoretical: number
  lastCount: { physical_qty: number; difference: number; counted_at: string } | null
}

function ConteoFisicoModal({ open, onClose, supplies, statsMap }: {
  open: boolean; onClose: () => void; supplies: Supply[]
  statsMap: Record<string, SupplyStats>
}) {
  const { profile } = useAuth()
  const createCount = useCreateCount()
  const [rows, setRows] = useState<ConteoRow[]>([])
  const [filter, setFilter] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setRows(supplies.filter((s) => s.active).map((s) => ({
        supplyId: s.id, name: s.name, code: s.code, unit: s.unit,
        theoretical: statsMap[s.id]?.theoretical ?? 0, physical: '',
      })))
      setFilter(''); setNotes(''); setError('')
    }
  }, [open]) // eslint-disable-line

  const filtered = filter.trim()
    ? rows.filter((r) =>
        r.name.toLowerCase().includes(filter.toLowerCase()) ||
        r.code.toLowerCase().includes(filter.toLowerCase())
      )
    : rows

  function setPhysical(id: string, val: string) {
    setRows((prev) => prev.map((r) => (r.supplyId === id ? { ...r, physical: val } : r)))
  }

  function diffClass(diff: number, theoretical: number) {
    if (Math.abs(diff) < 0.001) return 'text-green-600 font-medium'
    const pct = theoretical !== 0 ? Math.abs(diff) / Math.abs(theoretical) : 1
    return pct <= 0.05 ? 'text-yellow-600 font-medium' : 'text-red-600 font-medium'
  }

  async function handleSave(status: 'draft' | 'confirmed') {
    if (!profile) return
    setError('')
    try {
      await createCount.mutateAsync({
        userId: profile.id,
        notes,
        status,
        rows: rows.map((r) => ({
          supplyId: r.supplyId,
          theoretical: r.theoretical,
          physical: parseFloat(r.physical) || 0,
        })),
      })
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error al guardar conteo')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0">
        <div className="px-6 pt-5 pb-3 border-b">
          <DialogTitle className="text-plum-800">Conteo físico de inventario</DialogTitle>
          <div className="mt-3">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filtrar insumo..."
              className="max-w-sm text-sm"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-muted-foreground">Insumo</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground">Unid.</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Teórico</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground w-28">Físico</th>
                <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const phys = parseFloat(row.physical) || 0
                const diff = row.physical !== '' ? phys - row.theoretical : null
                return (
                  <tr key={row.supplyId} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <p className="font-medium text-plum-800">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.code}</p>
                    </td>
                    <td className="px-3 py-2 text-center text-muted-foreground">{row.unit}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">{row.theoretical.toFixed(2)}</td>
                    <td className="px-3 py-2 w-28">
                      <Input
                        type="number" step="0.01" min="0"
                        value={row.physical}
                        onChange={(e) => setPhysical(row.supplyId, e.target.value)}
                        placeholder={row.theoretical.toFixed(2)}
                        className="text-right text-sm h-7 px-2"
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {diff !== null ? (
                        <span className={diffClass(diff, row.theoretical)}>
                          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 border-t space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notas del conteo (opcional)</Label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observaciones, detalles del conteo..."
              rows={2}
              className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button variant="outline" onClick={() => handleSave('draft')} disabled={createCount.isPending}>
              Guardar borrador
            </Button>
            <Button onClick={() => handleSave('confirmed')} disabled={createCount.isPending}>
              {createCount.isPending && <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />}
              <Check className="w-3.5 h-3.5 mr-1.5" />
              Confirmar conteo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Inventario: Historial Row ─────────────────────────────────────────────────
function HistorialCountRow({ count }: {
  count: InventoryCount & { counted_by_user?: { full_name: string } | null }
}) {
  const [expanded, setExpanded] = useState(false)
  const { data: items = [], isLoading } = useCountItems(expanded ? count.id : null)

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <span className="font-medium text-plum-800">{fmtDate(count.counted_at)}</span>
          {count.counted_by_user?.full_name && (
            <span className="text-muted-foreground text-xs truncate">
              por {count.counted_by_user.full_name}
            </span>
          )}
          <Badge
            variant={count.status === 'confirmed' ? 'default' : 'secondary'}
            className="text-xs shrink-0"
          >
            {count.status === 'confirmed' ? 'Confirmado' : 'Borrador'}
          </Badge>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
          : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        }
      </button>
      {expanded && (
        <div className="border-t bg-gray-50/50">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-center py-4 text-xs text-muted-foreground">Sin items registrados</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">Insumo</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Teórico</th>
                  <th className="text-right px-3 py-2 font-medium text-muted-foreground">Físico</th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {(items as Array<{ id: string; supply_id: string; theoretical_qty: number; physical_qty: number; difference: number; supply?: { name: string; code: string } | null }>).map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-4 py-1.5">
                      <span className="font-medium">{item.supply?.name ?? item.supply_id}</span>
                      {item.supply?.code && (
                        <span className="text-muted-foreground ml-1">({item.supply.code})</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">
                      {item.theoretical_qty.toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right">{item.physical_qty.toFixed(2)}</td>
                    <td className={cn(
                      'px-4 py-1.5 text-right font-medium',
                      Math.abs(item.difference) < 0.001
                        ? 'text-green-600'
                        : item.difference < 0 ? 'text-red-600' : 'text-yellow-600'
                    )}>
                      {item.difference >= 0 ? '+' : ''}{item.difference.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {count.notes && (
            <p className="px-4 py-2 text-xs text-muted-foreground italic border-t">{count.notes}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inventario: Tab ───────────────────────────────────────────────────────────
function TabInventario() {
  const { data: supplies = [] } = useSupplies()
  const { data: movements = [], isLoading: movLoading } = useInventoryMovements()
  const { data: counts = [], isLoading: cntLoading } = useInventoryCounts()
  const { data: confirmedCounts = [] } = useConfirmedCountsWithItems()
  const [showIngresar, setShowIngresar] = useState(false)
  const [showConteo, setShowConteo] = useState(false)

  const latestCountPerSupply = useMemo(() => {
    const map: Record<string, { physical_qty: number; difference: number; counted_at: string }> = {}
    ;(confirmedCounts as Array<{ id: string; counted_at: string; inventory_count_items?: { supply_id: string; physical_qty: number; difference: number }[] }>).forEach((c) => {
      c.inventory_count_items?.forEach((item) => {
        if (!map[item.supply_id]) {
          map[item.supply_id] = {
            physical_qty: item.physical_qty,
            difference: item.difference,
            counted_at: c.counted_at,
          }
        }
      })
    })
    return map
  }, [confirmedCounts])

  const statsMap = useMemo(() => {
    const map: Record<string, SupplyStats> = {}
    supplies.forEach((s) => {
      const sm = movements.filter((m) => m.supply_id === s.id)
      const entries = sm.filter((m) => m.type === 'entry').reduce((a, m) => a + m.quantity, 0)
      const sessions = sm.filter((m) => m.type === 'session').reduce((a, m) => a + Math.abs(m.quantity), 0)
      const sales = sm.filter((m) => m.type === 'sale').reduce((a, m) => a + Math.abs(m.quantity), 0)
      const losses = sm.filter((m) => m.type === 'loss').reduce((a, m) => a + Math.abs(m.quantity), 0)
      const adjustments = sm.filter((m) => m.type === 'adjustment').reduce((a, m) => a + m.quantity, 0)
      map[s.id] = {
        entries, sessions, sales, adjustments,
        theoretical: entries - sessions - sales - losses + adjustments,
        lastCount: latestCountPerSupply[s.id] ?? null,
      }
    })
    return map
  }, [supplies, movements, latestCountPerSupply])

  const isLoading = movLoading || cntLoading

  const fmtQty = (n: number) => (n % 1 === 0 ? n.toString() : n.toFixed(2))
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  function diffColor(diff: number, theoretical: number) {
    if (Math.abs(diff) < 0.001) return 'text-green-600'
    const pct = theoretical !== 0 ? Math.abs(diff) / Math.abs(theoretical) : 1
    return pct <= 0.05 ? 'text-yellow-600' : 'text-red-600'
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          onClick={() => {
            const activeSupplies = supplies.filter((s) => s.active)
            exportToExcel(
              activeSupplies.map((s) => {
                const st = statsMap[s.id] ?? {
                  entries: 0, sessions: 0, sales: 0, adjustments: 0, theoretical: 0, lastCount: null,
                }
                const diff = st.lastCount != null ? st.lastCount.physical_qty - st.theoretical : ''
                return {
                  'Nombre': s.name,
                  'Código': s.code,
                  'Tipo': s.category === 'product' ? 'Producto' : 'Insumo',
                  'Unidad': s.unit,
                  'Ingresado': st.entries,
                  'Sesiones': st.sessions,
                  'Vendido': st.sales,
                  'Ajustes': st.adjustments,
                  'Teórico': st.theoretical,
                  'Último conteo': st.lastCount?.physical_qty ?? '',
                  'Fecha conteo': st.lastCount
                    ? new Date(st.lastCount.counted_at).toLocaleDateString('es-AR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                      })
                    : '',
                  'Diferencia': diff,
                }
              }),
              'inventario.xlsx',
              'Inventario',
            )
          }}
          disabled={supplies.filter((s) => s.active).length === 0}
        >
          <FileDown className="w-4 h-4 mr-2" />
          Exportar Excel
        </Button>
        <Button onClick={() => setShowIngresar(true)}>
          <PackagePlus className="w-4 h-4 mr-2" />
          Ingresar stock
        </Button>
        <Button variant="outline" onClick={() => setShowConteo(true)}>
          <ClipboardList className="w-4 h-4 mr-2" />
          Nuevo conteo
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Stock actual</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : supplies.filter((s) => s.active).length === 0 ? (
            <p className="text-center py-10 text-sm text-muted-foreground">Sin insumos cargados</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-y">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Nombre</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Tipo</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Unid.</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Ingresado</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Sesiones</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Vendido</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Ajustes</th>
                    <th className="text-right px-3 py-2 font-medium text-plum-700">Teórico</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Último conteo</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {supplies.filter((s) => s.active).map((s) => {
                    const st = statsMap[s.id] ?? {
                      entries: 0, sessions: 0, sales: 0, adjustments: 0, theoretical: 0, lastCount: null,
                    }
                    const diff = st.lastCount != null ? st.lastCount.physical_qty - st.theoretical : null
                    return (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-medium text-plum-800">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{s.code}</p>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Badge
                            variant={s.category === 'product' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {s.category === 'product' ? 'Producto' : 'Insumo'}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground text-xs">{s.unit}</td>
                        <td className="px-3 py-2 text-right">{fmtQty(st.entries)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{fmtQty(st.sessions)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{fmtQty(st.sales)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {st.adjustments >= 0 ? '+' : ''}{fmtQty(st.adjustments)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-plum-800">
                          {fmtQty(st.theoretical)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                          {st.lastCount ? (
                            <div>
                              <span>{fmtQty(st.lastCount.physical_qty)}</span>
                              <span className="block opacity-70">{fmtDate(st.lastCount.counted_at)}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {diff !== null ? (
                            <span className={diffColor(diff, st.theoretical)}>
                              {diff >= 0 ? '+' : ''}{fmtQty(diff)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {counts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-plum-800">Historial de conteos</h3>
          <div className="space-y-2">
            {counts.map((c) => (
              <HistorialCountRow
                key={c.id}
                count={c as InventoryCount & { counted_by_user?: { full_name: string } | null }}
              />
            ))}
          </div>
        </div>
      )}

      <IngresarStockModal
        open={showIngresar}
        onClose={() => setShowIngresar(false)}
        supplies={supplies}
      />
      <ConteoFisicoModal
        open={showConteo}
        onClose={() => setShowConteo(false)}
        supplies={supplies}
        statsMap={statsMap}
      />
    </div>
  )
}

// ── Tab Análisis de Precios ───────────────────────────────────────────────────

const LABOR_CODES = ['MTPHS', 'PYCLS']

type PriceSection = 'servicios' | 'membresias' | 'productos'
type PriceFilter = 'todos' | PriceSection

type PriceRow = {
  rowId: string
  section: PriceSection
  nombre: string
  cmv: number | null
  precioActual: number
  target:
    | { type: 'service'; id: string; field: 'price_60' | 'price_90' }
    | { type: 'membership'; id: string }
    | { type: 'product'; id: string }
}

function cmvPct(cmv: number | null, price: number | null | undefined): number | null {
  if (cmv === null || !price || price === 0) return null
  return (cmv / price) * 100
}

function CmvPctBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>
  const cls = pct < 30 ? 'text-green-600' : pct <= 50 ? 'text-amber-600' : 'text-red-600'
  return <span className={cn('text-xs font-medium tabular-nums', cls)}>{pct.toFixed(1)}%</span>
}

function VarBadge({ value, type }: { value: number | null; type: 'precio' | 'cmv' }) {
  if (value === null) return <span className="text-muted-foreground text-xs">—</span>
  if (Math.abs(value) < 0.05) return <span className="text-gray-400 text-xs">=</span>
  const absStr = Math.abs(value).toFixed(1) + '%'
  if (type === 'precio') {
    return value > 0
      ? <span className="text-green-600 text-xs font-medium">↑ {absStr}</span>
      : <span className="text-red-600 text-xs font-medium">↓ {absStr}</span>
  }
  // CMV: decrease is good (green), increase is bad (red)
  return value > 0
    ? <span className="text-red-600 text-xs font-medium">↑ {absStr}</span>
    : <span className="text-green-600 text-xs font-medium">↓ {absStr}</span>
}

const SECTION_LABELS: Record<PriceSection, string> = {
  servicios: 'Servicios',
  membresias: 'Membresías',
  productos: 'Productos a la venta',
}

function TabAnalisisPrecios() {
  const { data: services = [], isLoading: svLoading } = useServices()
  const { data: memberships = [], isLoading: mbLoading } = useMembershipPlans()
  const { data: products = [], isLoading: prLoading } = useSellableSupplies()
  const { data: costItems = [], isLoading: ciLoading } = useAllServiceCostItems()

  const updateServicePrice = useUpdateServicePrice()
  const updateMembershipPrice = useUpdateMembershipPrice()
  const updateSupplySalePrice = useUpdateSupplySalePrice()
  const { logAction } = useAuditLog()

  const [prices, setPrices] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<PriceFilter>('todos')
  const [bulkPct, setBulkPct] = useState('')
  const [touched, setTouched] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applySuccess, setApplySuccess] = useState(false)

  const isLoading = svLoading || mbLoading || prLoading || ciLoading

  function getCmvForService(serviceId: string, dur: 60 | 90): number | null {
    const items = costItems.filter(
      (ci) =>
        ci.service_id === serviceId &&
        ci.duration_minutes === dur &&
        !LABOR_CODES.includes(ci.supply?.code ?? ''),
    )
    if (items.length === 0) return null
    return items.reduce((sum, ci) => {
      const price = ci.supply?.unit_price ?? 0
      const cost = ci.supply?.unit === 'min' ? (price / 60) * ci.quantity : price * ci.quantity
      return sum + cost
    }, 0)
  }

  const avgCmv60 = useMemo(() => {
    const vals = services
      .map((svc) => getCmvForService(svc.id, 60))
      .filter((v): v is number => v !== null)
    if (vals.length === 0) return null
    return vals.reduce((a, b) => a + b, 0) / vals.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, costItems])

  const rows = useMemo((): PriceRow[] => {
    const result: PriceRow[] = []

    for (const svc of services) {
      if (svc.price_60 != null) {
        result.push({
          rowId: `svc_${svc.id}_60`,
          section: 'servicios',
          nombre: `${svc.emoji ?? ''} ${svc.name} — 60 min`.trim(),
          cmv: getCmvForService(svc.id, 60),
          precioActual: svc.price_60,
          target: { type: 'service', id: svc.id, field: 'price_60' },
        })
      }
      if (svc.price_90 != null) {
        result.push({
          rowId: `svc_${svc.id}_90`,
          section: 'servicios',
          nombre: `${svc.emoji ?? ''} ${svc.name} — 90 min`.trim(),
          cmv: getCmvForService(svc.id, 90),
          precioActual: svc.price_90,
          target: { type: 'service', id: svc.id, field: 'price_90' },
        })
      }
    }

    for (const memb of memberships) {
      const cmv =
        avgCmv60 !== null && memb.sessions_qty > 0 ? avgCmv60 * memb.sessions_qty : null
      result.push({
        rowId: `memb_${memb.id}`,
        section: 'membresias',
        nombre: memb.name,
        cmv,
        precioActual: memb.price,
        target: { type: 'membership', id: memb.id },
      })
    }

    for (const prod of products) {
      result.push({
        rowId: `prod_${prod.id}`,
        section: 'productos',
        nombre: prod.name,
        cmv: prod.unit_price,
        precioActual: prod.sale_price ?? 0,
        target: { type: 'product', id: prod.id },
      })
    }

    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, memberships, products, costItems, avgCmv60])

  const visibleRows = filter === 'todos' ? rows : rows.filter((r) => r.section === filter)

  const completados = rows.filter((r) => {
    const v = Number(prices[r.rowId])
    return prices[r.rowId] !== undefined && prices[r.rowId] !== '' && v > 0
  }).length
  const total = rows.length
  const allFilled = total > 0 && completados === total

  function handleBulkApply() {
    const pct = parseFloat(bulkPct)
    if (isNaN(pct) || !bulkPct.trim()) return
    const next: Record<string, string> = {}
    for (const row of rows) {
      const newP = Math.round((row.precioActual * (1 + pct / 100)) / 100) * 100
      next[row.rowId] = String(newP)
    }
    setPrices(next)
  }

  function handleReset() {
    setPrices({})
    setTouched(false)
    setApplySuccess(false)
    setApplyError(null)
  }

  async function handleApply() {
    setApplying(true)
    setApplyError(null)
    try {
      for (const row of rows) {
        const newPrice = parseFloat(prices[row.rowId] ?? '')
        if (!newPrice || newPrice <= 0) continue
        if (row.target.type === 'service') {
          await updateServicePrice.mutateAsync({
            id: row.target.id,
            field: row.target.field,
            price: newPrice,
          })
        } else if (row.target.type === 'membership') {
          await updateMembershipPrice.mutateAsync({ id: row.target.id, price: newPrice })
        } else {
          await updateSupplySalePrice.mutateAsync({ id: row.target.id, salePrice: newPrice })
        }
      }
      setApplySuccess(true)
      setPrices({})
      setTouched(false)
      setShowConfirm(false)
      logAction({
        action: 'UPDATE',
        module: 'compras',
        entityType: 'prices',
        entityName: 'Actualización masiva de precios',
        newValue: { items_updated: total },
      })
    } catch (e) {
      setApplyError((e as Error).message || 'Error al aplicar precios')
    } finally {
      setApplying(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3 mt-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 rounded-md bg-gray-100 animate-pulse" />
        ))}
      </div>
    )
  }

  const SECTIONS: PriceSection[] = ['servicios', 'membresias', 'productos']

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Filter tabs */}
        <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
          {(['todos', ...SECTIONS] as PriceFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-3 py-1 text-xs font-medium rounded-md transition-colors capitalize',
                filter === f
                  ? 'bg-white text-plum-800 shadow-sm'
                  : 'text-muted-foreground hover:text-plum-700',
              )}
            >
              {f === 'todos' ? 'Todos' : SECTION_LABELS[f as PriceSection]}
            </button>
          ))}
        </div>

        {/* Export */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs px-2.5 gap-1"
          onClick={() =>
            exportToExcel(
              visibleRows.map((r) => ({
                'Sección': SECTION_LABELS[r.section as PriceSection] ?? r.section,
                'Nombre': r.nombre,
                'CMV Teórico': r.cmv ?? '',
                'Precio actual': r.precioActual,
              })),
              'analisis-precios.xlsx',
              'Análisis de Precios',
            )
          }
          disabled={visibleRows.length === 0}
        >
          <FileDown className="w-3 h-3" />
          Exportar Excel
        </Button>

        {/* Bulk increase */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-xs text-muted-foreground">Aumentar todo</span>
          <Input
            type="number"
            step="0.1"
            placeholder="%"
            value={bulkPct}
            onChange={(e) => setBulkPct(e.target.value)}
            className="w-16 h-7 text-xs text-right px-2"
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs px-2.5 gap-1"
            onClick={handleBulkApply}
            disabled={!bulkPct.trim()}
          >
            <TrendingUp className="w-3 h-3" />
            Aplicar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs px-2 text-muted-foreground hover:text-plum-800"
            onClick={handleReset}
            title="Limpiar todos los precios nuevos"
          >
            <RotateCcw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Success banner */}
      {applySuccess && (
        <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
          <Check className="w-4 h-4 text-green-600 shrink-0" />
          <span className="text-sm text-green-700 font-medium">
            Precios actualizados correctamente.
          </span>
          <button
            className="ml-auto text-xs text-green-600 hover:underline"
            onClick={() => setApplySuccess(false)}
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground min-w-[180px]">Nombre</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground min-w-[90px]">CMV Teórico</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground min-w-[100px]">Precio actual</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground min-w-[80px]">CMV% act.</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-plum-700 min-w-[120px]">Precio nuevo</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground min-w-[80px]">CMV% nuevo</th>
                <th className="text-right px-3 py-2.5 text-xs font-medium text-muted-foreground min-w-[80px]">Var. precio</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-muted-foreground min-w-[80px]">Var. CMV%</th>
              </tr>
            </thead>
            <tbody>
              {SECTIONS.map((section) => {
                const sectionRows = visibleRows.filter((r) => r.section === section)
                if (filter !== 'todos' && filter !== section) return null
                return (
                  <>
                    {/* Section header */}
                    <tr key={`hdr_${section}`} className="bg-plum-50 border-y border-plum-100">
                      <td
                        colSpan={8}
                        className="px-4 py-1.5 text-[11px] font-bold text-plum-700 uppercase tracking-wider"
                      >
                        {SECTION_LABELS[section]}
                      </td>
                    </tr>

                    {/* Gift cards note inside Servicios section */}
                    {section === 'servicios' && (
                      <tr key="giftcard_note" className="bg-blue-50/50 border-b border-blue-100">
                        <td colSpan={8} className="px-4 py-2 text-xs text-blue-600 italic">
                          🎁 Los precios de gift cards siguen automáticamente el precio del servicio asociado.
                        </td>
                      </tr>
                    )}

                    {sectionRows.length === 0 ? (
                      <tr key={`empty_${section}`}>
                        <td colSpan={8} className="px-4 py-4 text-center text-xs text-muted-foreground">
                          Sin datos
                        </td>
                      </tr>
                    ) : (
                      sectionRows.map((row) => {
                        const nuevoNum = parseFloat(prices[row.rowId] ?? '') || null
                        const cmvActPct = cmvPct(row.cmv, row.precioActual)
                        const cmvNuevoPct = cmvPct(row.cmv, nuevoNum)
                        const varPrecio =
                          nuevoNum && row.precioActual
                            ? ((nuevoNum - row.precioActual) / row.precioActual) * 100
                            : null
                        const varCmv =
                          cmvActPct !== null && cmvNuevoPct !== null
                            ? cmvNuevoPct - cmvActPct
                            : null
                        const isEmpty =
                          touched && (prices[row.rowId] === undefined || prices[row.rowId] === '')

                        return (
                          <tr
                            key={row.rowId}
                            className="border-b last:border-0 hover:bg-gray-50/50"
                          >
                            <td className="px-4 py-2.5 text-sm text-plum-800 font-medium">
                              {row.nombre}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-xs text-muted-foreground">
                              {row.cmv !== null ? formatCurrency(row.cmv) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-sm font-medium text-plum-800">
                              {formatCurrency(row.precioActual)}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <CmvPctBadge pct={cmvActPct} />
                            </td>
                            <td className="px-3 py-2.5">
                              <Input
                                type="number"
                                min="0"
                                step="100"
                                placeholder="Nuevo precio"
                                value={prices[row.rowId] ?? ''}
                                onChange={(e) => {
                                  setPrices((p) => ({ ...p, [row.rowId]: e.target.value }))
                                  if (applySuccess) setApplySuccess(false)
                                }}
                                className={cn(
                                  'h-7 text-xs text-right w-28 ml-auto',
                                  isEmpty && 'border-red-400 focus:ring-red-400',
                                )}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <CmvPctBadge pct={cmvNuevoPct} />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <VarBadge value={varPrecio} type="precio" />
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <VarBadge value={varCmv} type="cmv" />
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Summary bar */}
      <div className="flex items-center gap-4 bg-gray-50 rounded-xl px-4 py-3 border">
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Completados: <span className="font-semibold text-plum-800">{completados} / {total}</span></span>
            {allFilled && <span className="text-green-600 font-medium">✓ Listo para aplicar</span>}
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full bg-plum-600 transition-all"
              style={{ width: total > 0 ? `${(completados / total) * 100}%` : '0%' }}
            />
          </div>
        </div>
        <div className="relative group shrink-0">
          <Button
            onClick={() => {
              if (!allFilled) { setTouched(true); return }
              setShowConfirm(true)
            }}
            className={cn(!allFilled && 'opacity-60')}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            Aplicar precios nuevos
          </Button>
          {!allFilled && (
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap bg-gray-800 text-white text-xs rounded px-2.5 py-1.5">
              Completá todos los precios para continuar
            </div>
          )}
        </div>
      </div>

      {applyError && (
        <p className="text-sm text-red-600 px-1">{applyError}</p>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <Dialog open onOpenChange={() => setShowConfirm(false)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Confirmar actualización de precios</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <p className="text-sm text-muted-foreground">
                Estás por actualizar{' '}
                <span className="font-semibold text-plum-800">{total} precios</span>.
                Esta acción no se puede deshacer fácilmente.
              </p>
              {applyError && <p className="text-sm text-red-600">{applyError}</p>}
              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="flex-1"
                  disabled={applying}
                >
                  Cancelar
                </Button>
                <Button onClick={handleApply} className="flex-1" disabled={applying}>
                  {applying && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Confirmar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── Tab Tesorería ─────────────────────────────────────────────────────────────
function TabTesoreria() {
  const { profile } = useAuth()
  const now = new Date()

  const { data: settings, isLoading: settingsLoading } = useTenantPaymentSettings()
  const updateSettings = useUpdatePaymentSettings()
  const [settingsForm, setSettingsForm] = useState({
    qr_settlement_days: 0,
    qr_settlement_type: 'corridos' as 'corridos' | 'habiles',
    debit_settlement_days: 1,
    debit_settlement_type: 'habiles' as 'corridos' | 'habiles',
    credit_settlement_days: 10,
    credit_settlement_type: 'corridos' as 'corridos' | 'habiles',
  })
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)

  useEffect(() => {
    if (settings) {
      setSettingsForm({
        qr_settlement_days: settings.qr_settlement_days,
        qr_settlement_type: settings.qr_settlement_type,
        debit_settlement_days: settings.debit_settlement_days,
        debit_settlement_type: settings.debit_settlement_type,
        credit_settlement_days: settings.credit_settlement_days,
        credit_settlement_type: settings.credit_settlement_type,
      })
    }
  }, [settings])

  const [year, setYear] = useState(now.getFullYear())
  const [monthNum, setMonthNum] = useState(now.getMonth() + 1)
  const { data: balance, isLoading: balanceLoading } = useMonthlyBalances(year, monthNum)
  const upsertBalance = useUpsertMonthlyBalance()
  const [balanceForm, setBalanceForm] = useState({
    opening_cash: '',
    opening_safe: '',
    opening_bank_transfer: '',
    opening_bank_cards: '',
    notes: '',
  })
  const [balanceSaved, setBalanceSaved] = useState(false)
  const [balanceError, setBalanceError] = useState<string | null>(null)

  useEffect(() => {
    if (balance) {
      setBalanceForm({
        opening_cash: String(balance.opening_cash),
        opening_safe: String(balance.opening_safe),
        opening_bank_transfer: String(balance.opening_bank_transfer),
        opening_bank_cards: String(balance.opening_bank_cards),
        notes: balance.notes ?? '',
      })
    } else if (!balanceLoading) {
      setBalanceForm({ opening_cash: '', opening_safe: '', opening_bank_transfer: '', opening_bank_cards: '', notes: '' })
    }
  }, [balance, balanceLoading])

  async function handleSaveSettings() {
    setSettingsError(null)
    setSettingsSaved(false)
    try {
      await updateSettings.mutateAsync(settingsForm)
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 3000)
    } catch (e: unknown) {
      setSettingsError(e instanceof Error ? e.message : 'Error al guardar.')
    }
  }

  async function handleSaveBalance() {
    setBalanceError(null)
    setBalanceSaved(false)
    try {
      await upsertBalance.mutateAsync({
        year,
        month: monthNum,
        opening_cash: Number(balanceForm.opening_cash) || 0,
        opening_safe: Number(balanceForm.opening_safe) || 0,
        opening_bank_transfer: Number(balanceForm.opening_bank_transfer) || 0,
        opening_bank_cards: Number(balanceForm.opening_bank_cards) || 0,
        declared_by: profile?.id ?? '',
        notes: balanceForm.notes.trim() || undefined,
      })
      setBalanceSaved(true)
      setTimeout(() => setBalanceSaved(false), 3000)
    } catch (e: unknown) {
      setBalanceError(e instanceof Error ? e.message : 'Error al guardar.')
    }
  }

  const settlementRows = [
    {
      label: 'QR / MercadoPago',
      days: settingsForm.qr_settlement_days,
      type: settingsForm.qr_settlement_type,
      setDays: (v: number) => setSettingsForm((p) => ({ ...p, qr_settlement_days: v })),
      setType: (v: 'corridos' | 'habiles') => setSettingsForm((p) => ({ ...p, qr_settlement_type: v })),
    },
    {
      label: 'Débito',
      days: settingsForm.debit_settlement_days,
      type: settingsForm.debit_settlement_type,
      setDays: (v: number) => setSettingsForm((p) => ({ ...p, debit_settlement_days: v })),
      setType: (v: 'corridos' | 'habiles') => setSettingsForm((p) => ({ ...p, debit_settlement_type: v })),
    },
    {
      label: 'Crédito',
      days: settingsForm.credit_settlement_days,
      type: settingsForm.credit_settlement_type,
      setDays: (v: number) => setSettingsForm((p) => ({ ...p, credit_settlement_days: v })),
      setType: (v: 'corridos' | 'habiles') => setSettingsForm((p) => ({ ...p, credit_settlement_type: v })),
    },
  ]

  const balanceFields = [
    { key: 'opening_cash' as const,          icon: '💵', label: 'Cajón',               detail: 'Efectivo disponible en caja diaria' },
    { key: 'opening_safe' as const,          icon: '🔒', label: 'Caja fuerte',          detail: 'Efectivo acumulado depositado' },
    { key: 'opening_bank_transfer' as const, icon: '🏦', label: 'Cuenta transferencias', detail: '' },
    { key: 'opening_bank_cards' as const,    icon: '💳', label: 'Cuenta QR / tarjetas', detail: '' },
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Card 1: Plazos de liquidación */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-plum-800">Plazos de liquidación</CardTitle>
          <p className="text-sm text-muted-foreground">
            Configurá cuántos días tarda en acreditarse cada medio de pago en tu cuenta.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {settingsLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {settlementRows.map((row) => (
                  <div key={row.label} className="flex items-center gap-3 flex-wrap">
                    <span className="w-36 text-sm font-medium text-plum-800 shrink-0">{row.label}</span>
                    <Input
                      type="number"
                      min="0"
                      max="60"
                      className="w-20 h-8 text-sm text-center"
                      value={row.days}
                      onChange={(e) => row.setDays(Number(e.target.value))}
                    />
                    <select
                      className="border border-input rounded-md px-2 py-1.5 text-sm bg-background h-8 focus:outline-none focus:ring-2 focus:ring-plum-800 focus:ring-offset-0"
                      value={row.type}
                      onChange={(e) => row.setType(e.target.value as 'corridos' | 'habiles')}
                    >
                      <option value="corridos">días corridos</option>
                      <option value="habiles">días hábiles</option>
                    </select>
                  </div>
                ))}
              </div>
              {settingsError && <p className="text-sm text-red-600">{settingsError}</p>}
              <div className="flex items-center gap-3 pt-1">
                <Button
                  size="sm"
                  className="bg-plum-700 hover:bg-plum-800 text-white"
                  onClick={handleSaveSettings}
                  disabled={updateSettings.isPending}
                >
                  {updateSettings.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                    : 'Guardar plazos'}
                </Button>
                {settingsSaved && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <Check className="w-4 h-4" /> Guardado
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Card 2: Saldos iniciales del mes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base text-plum-800">Saldos de tesorería</CardTitle>
          <p className="text-sm text-muted-foreground">
            Declarás el saldo real de cada cuenta al inicio de cada mes para que el sistema calcule correctamente el cash flow.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Month / year selector */}
          <div className="flex items-center gap-3">
            <select
              className="border border-input rounded-md px-2 py-1.5 text-sm bg-background h-8 focus:outline-none focus:ring-2 focus:ring-plum-800 focus:ring-offset-0"
              value={monthNum}
              onChange={(e) => setMonthNum(Number(e.target.value))}
            >
              {MONTHS_ES.map((name, i) => (
                <option key={i + 1} value={i + 1}>{name}</option>
              ))}
            </select>
            <Input
              type="number"
              className="w-24 h-8 text-sm"
              value={year}
              min="2020"
              max="2099"
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </div>

          {balanceLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {balanceFields.map(({ key, icon, label, detail }) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-sm flex items-center gap-1.5">
                      <span>{icon}</span>
                      <span>{label}</span>
                      {detail && <span className="text-xs text-muted-foreground">({detail})</span>}
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-9"
                      value={balanceForm[key]}
                      onChange={(e) => setBalanceForm({ ...balanceForm, [key]: e.target.value })}
                      placeholder="0,00"
                    />
                  </div>
                ))}
                <div className="space-y-1">
                  <Label className="text-sm text-muted-foreground">Notas (opcional)</Label>
                  <Input
                    value={balanceForm.notes}
                    onChange={(e) => setBalanceForm({ ...balanceForm, notes: e.target.value })}
                    placeholder="Ej: Saldo declarado manualmente al inicio del mes"
                  />
                </div>
              </div>

              {balance?.declared_at && (
                <p className="text-xs text-muted-foreground">
                  Último guardado:{' '}
                  {new Date(balance.declared_at).toLocaleString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {balance.declared_by === profile?.id ? ' (por vos)' : ''}
                </p>
              )}

              {balanceError && <p className="text-sm text-red-600">{balanceError}</p>}
              <div className="flex items-center gap-3 pt-1">
                <Button
                  size="sm"
                  className="bg-plum-700 hover:bg-plum-800 text-white"
                  onClick={handleSaveBalance}
                  disabled={upsertBalance.isPending}
                >
                  {upsertBalance.isPending
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando...</>
                    : 'Guardar saldos'}
                </Button>
                {balanceSaved && (
                  <span className="flex items-center gap-1 text-sm text-green-700">
                    <Check className="w-4 h-4" /> Guardado
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
type ConfigTab = 'insumos' | 'costos' | 'inventario' | 'precios' | 'general' | 'tesoreria'

export default function Configuracion() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<ConfigTab>('insumos')

  if (profile?.role !== 'owner' && profile?.role !== 'partner_admin' && profile?.role !== 'super_admin') {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">No tenés permiso para acceder a esta sección.</p>
      </div>
    )
  }

  const tabs: { key: ConfigTab; label: string }[] = [
    { key: 'insumos',    label: 'Insumos' },
    { key: 'costos',     label: 'Estructura de Costos' },
    { key: 'inventario', label: 'Inventario' },
    { key: 'precios',    label: 'Análisis de Precios' },
    { key: 'general',    label: 'General' },
    ...(profile?.role === 'owner' ? [{ key: 'tesoreria' as ConfigTab, label: 'Tesorería' }] : []),
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Compras</h1>
        <p className="text-muted-foreground text-sm mt-1">Gestión de insumos y estructura de costos</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'px-5 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === t.key
                  ? 'border-plum-700 text-plum-800'
                  : 'border-transparent text-muted-foreground hover:text-plum-700',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'insumos'    && <TabInsumos />}
      {tab === 'costos'     && <TabCostos onNavigateToInsumos={() => setTab('insumos')} />}
      {tab === 'inventario' && <TabInventario />}
      {tab === 'precios'    && <TabAnalisisPrecios />}
      {tab === 'tesoreria'  && profile?.role === 'owner' && <TabTesoreria />}
      {tab === 'general' && (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <p className="text-sm font-medium">Próximamente</p>
          <p className="text-xs mt-1">Configuración general del centro</p>
        </div>
      )}
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { Plus, Trash2, Pencil, Loader2, Package, PackagePlus, ClipboardList, ChevronDown, ChevronUp, Check } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useServices } from '@/hooks/useAppointments'
import {
  useSupplies,
  useCreateSupply,
  useUpdateSupply,
  useDeleteSupply,
  useAllServiceCostItems,
  useAddCostItem,
  useRemoveCostItem,
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
import { cn, formatCurrency } from '@/lib/utils'
import type { Supply, InventoryCount } from '@/types'

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
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1" />Nuevo insumo
        </Button>
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
function TabCostos() {
  const { data: services = [], isLoading: svLoading } = useServices()
  const { data: costItems = [], isLoading: ciLoading } = useAllServiceCostItems()
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

  if (svLoading || ciLoading) {
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
      setFecha(new Date().toISOString().split('T')[0])
    }
  }, [open])

  const selected = supplies.find((s) => s.id === supplyId)

  async function handleSave() {
    if (!supplyId) { setError('Seleccioná un insumo'); return }
    const quantity = parseFloat(qty) || 0
    if (quantity <= 0) { setError('Cantidad inválida'); return }
    setError('')
    try {
      const today = new Date().toISOString().split('T')[0]
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

// ── Main ──────────────────────────────────────────────────────────────────────
type ConfigTab = 'insumos' | 'costos' | 'inventario' | 'general'

export default function Configuracion() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<ConfigTab>('insumos')

  if (profile?.role !== 'owner') {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Solo el propietario puede acceder a esta sección.</p>
      </div>
    )
  }

  const tabs: { key: ConfigTab; label: string }[] = [
    { key: 'insumos', label: 'Insumos' },
    { key: 'costos', label: 'Estructura de Costos' },
    { key: 'inventario', label: 'Inventario' },
    { key: 'general', label: 'General' },
  ]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Configuración</h1>
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

      {tab === 'insumos' && <TabInsumos />}
      {tab === 'costos' && <TabCostos />}
      {tab === 'inventario' && <TabInventario />}
      {tab === 'general' && (
        <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
          <p className="text-sm font-medium">Próximamente</p>
          <p className="text-xs mt-1">Configuración general del centro</p>
        </div>
      )}
    </div>
  )
}

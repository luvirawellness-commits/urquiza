import { useState, useMemo, useEffect } from 'react'
import {
  Loader2, DollarSign, ChevronLeft, ChevronRight, Wallet,
  TrendingUp, TrendingDown, Receipt, ShoppingCart, CreditCard, Clock, Lock, Landmark, FileDown, FileText,
} from 'lucide-react'
import InvoiceModal from '@/components/InvoiceModal'
import VenderMembresiaModal from '@/components/VenderMembresiaModal'
import { useAuth, useTenantId } from '@/contexts/AuthContext'
import { useClients } from '@/hooks/useClients'
import { useServices } from '@/hooks/useAppointments'
import {
  useTransactionsRange,
  useCompletedAppointmentsForCMV,
  useTodayTransactions,
  useTodayMetrics,
  useInsertTransaction,
  useClientMembership,
} from '@/hooks/useFinanzas'
import { useAllServiceCostItems } from '@/hooks/useSupplies'
import {
  useEmployeeProfiles,
  useAbsencesRange,
  calcMonthScheduleHours,
} from '@/hooks/useRRHH'
import {
  useTreasuryDeclarations, useTreasuryItems, useCreateTreasuryDeclaration,
} from '@/hooks/useTreasury'
import type { TreasuryItem } from '@/hooks/useTreasury'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { cn, formatCurrency, MONTHS_ES, exportToExcel } from '@/lib/utils'
import type { Transaction, ServiceCostItem } from '@/types'

type Tab = 'caja' | 'pl'

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
] as const

const EXPENSE_CATEGORIES_CAJA = [
  { value: 'supplies', label: 'Insumos' },
  { value: 'rent', label: 'Alquiler' },
  { value: 'utilities', label: 'Servicios (agua, luz, internet, alarma)' },
  { value: 'salary_operativo', label: 'Sueldos Operativos (masoterapeutas, recepción, yoga)' },
  { value: 'salary_admin', label: 'Sueldos Administrativos (gestión, administración)' },
  { value: 'social_charges', label: 'Cargas Sociales (CCSS)' },
  { value: 'marketing', label: 'Marketing y Publicidad' },
  { value: 'management', label: 'Gestión (sistemas, contador)' },
  { value: 'bank_fees', label: 'Gastos Bancarios y Comisiones' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'depreciation', label: 'Depreciación' },
  { value: 'withdrawal', label: 'Retiro de Socios' },
  { value: 'other', label: 'Otro' },
]

const PM_LABELS: Record<string, string> = {
  cash: 'Efectivo', transfer: 'Transferencia', qr: 'QR',
  mp: 'Mercado Pago', debit: 'Débito', credit: 'Crédito',
}

const selectCls = 'w-full border border-input rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-plum-800 focus:ring-offset-0'

// ── Section A ──────────────────────────────────────────────────────────────────
function SectionResumenDia() {
  const { data: m, isLoading } = useTodayMetrics()

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <Card key={i}><CardContent className="pt-6 h-20 flex items-center justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></CardContent></Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total cobrado hoy</CardTitle>
        </CardHeader>
        <CardContent><p className="text-2xl font-bold text-plum-800">{formatCurrency(m?.totalCobrado ?? 0)}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Sesiones completadas hoy</CardTitle>
        </CardHeader>
        <CardContent><p className="text-2xl font-bold text-plum-800">{m?.sesionesCompletadas ?? 0}</p></CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Efectivo en caja</CardTitle>
        </CardHeader>
        <CardContent><p className="text-2xl font-bold text-plum-800">{formatCurrency(m?.efectivoEnCaja ?? 0)}</p></CardContent>
      </Card>
    </div>
  )
}

// ── Section B ──────────────────────────────────────────────────────────────────
function SectionRegistrarCobro() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [clientId, setClientId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [useMembership, setUseMembership] = useState(false)
  const [notes, setNotes] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  const { data: clients } = useClients(search || undefined)
  const { data: services } = useServices()
  const { data: membership } = useClientMembership(clientId || null)
  const insertTx = useInsertTransaction()

  const selectedClient = clients?.find((c) => c.id === clientId)
  const selectedService = services?.find((s) => s.id === serviceId)

  function handleServiceChange(sid: string) {
    setServiceId(sid)
    const svc = services?.find((s) => s.id === sid)
    if (svc?.price_60) setAmount(String(svc.price_60))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!clientId || !serviceId || !amount) return
    const today = new Date().toISOString().split('T')[0]
    try {
      await insertTx.mutateAsync({
        type: 'income',
        category: 'session',
        amount: Number(amount),
        payment_method: paymentMethod,
        description: `Sesión: ${selectedService?.name ?? 'Servicio'}`,
        date: today,
        user_id: user!.id,
        status: 'paid',
        is_recurring: false,
      })
      setClientId(''); setSearch(''); setServiceId(''); setAmount('')
      setUseMembership(false); setNotes('')
    } catch (_) { /* error shown below */ }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-plum-800 flex items-center gap-2">
          <Receipt className="w-4 h-4" /> Registrar cobro
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Cliente */}
          <div className="space-y-1">
            <Label>Cliente</Label>
            {selectedClient ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 px-3 py-2 border rounded-md text-sm bg-plum-50 text-plum-800">
                  {selectedClient.first_name} {selectedClient.last_name}
                </div>
                <Button type="button" variant="outline" size="sm"
                  onClick={() => { setClientId(''); setSearch('') }}>
                  Cambiar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Buscar cliente..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setShowDropdown(true) }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                />
                {showDropdown && clients && clients.length > 0 && (
                  <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-md shadow-lg mt-1 max-h-48 overflow-y-auto">
                    {clients.slice(0, 8).map((c) => (
                      <button key={c.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-plum-50 hover:text-plum-800 transition-colors"
                        onMouseDown={() => { setClientId(c.id); setSearch(''); setShowDropdown(false) }}>
                        {c.first_name} {c.last_name}{c.phone ? ` — ${c.phone}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Servicio */}
          <div className="space-y-1">
            <Label>Servicio</Label>
            <select className={selectCls} value={serviceId}
              onChange={(e) => handleServiceChange(e.target.value)} required>
              <option value="">Seleccionar servicio</option>
              {services?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.emoji} {s.name}{s.price_60 ? ` — ${formatCurrency(s.price_60)}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Monto + Medio de pago */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Monto</Label>
              <Input type="number" min="0" step="1" placeholder="0"
                value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Medio de pago</Label>
              <select className={selectCls} value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>{pm.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Membresía */}
          {membership && (
            <div className="flex items-center gap-2">
              <input type="checkbox" id="useMembership" checked={useMembership}
                onChange={(e) => setUseMembership(e.target.checked)}
                className="w-4 h-4 accent-plum-800" />
              <Label htmlFor="useMembership" className="cursor-pointer font-normal">
                Usar membresía activa
              </Label>
            </div>
          )}

          {/* Notas */}
          <div className="space-y-1">
            <Label>Notas</Label>
            <Input placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Button type="submit" className="w-full"
            disabled={insertTx.isPending || !clientId || !serviceId || !amount}>
            {insertTx.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Registrar cobro
          </Button>
          {insertTx.isError && (
            <p className="text-sm text-red-600">{(insertTx.error as Error).message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

// ── Section C ──────────────────────────────────────────────────────────────────
function SectionGastosDelDia() {
  const { user } = useAuth()
  const [category, setCategory] = useState('supplies')
  const [proveedor, setProveedor] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const insertTx = useInsertTransaction()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!amount || !description) return
    const today = new Date().toISOString().split('T')[0]
    try {
      await insertTx.mutateAsync({
        type: 'expense',
        category,
        amount: Number(amount),
        payment_method: paymentMethod,
        description: `${proveedor ? `${proveedor}: ` : ''}${description}`,
        date: today,
        user_id: user!.id,
        status: 'paid',
        is_recurring: false,
      })
      setProveedor(''); setDescription(''); setAmount(''); setCategory('supplies')
    } catch (_) { /* error shown below */ }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-plum-800 flex items-center gap-2">
          <ShoppingCart className="w-4 h-4" /> Gastos del día
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Categoría</Label>
              <select className={selectCls} value={category}
                onChange={(e) => setCategory(e.target.value)}>
                {EXPENSE_CATEGORIES_CAJA.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Proveedor</Label>
              <Input placeholder="Opcional" value={proveedor}
                onChange={(e) => setProveedor(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Descripción</Label>
            <Input placeholder="Detalle del gasto" value={description}
              onChange={(e) => setDescription(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Monto</Label>
              <Input type="number" min="0" step="1" placeholder="0"
                value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Medio de pago</Label>
              <select className={selectCls} value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.value} value={pm.value}>{pm.label}</option>
                ))}
              </select>
            </div>
          </div>

          <Button type="submit" variant="outline" className="w-full"
            disabled={insertTx.isPending || !amount || !description}>
            {insertTx.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
            Registrar gasto
          </Button>
          {insertTx.isError && (
            <p className="text-sm text-red-600">{(insertTx.error as Error).message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

// ── Section D ──────────────────────────────────────────────────────────────────
function SectionMovimientosHoy() {
  const { data: txs, isLoading } = useTodayTransactions()
  const { profile } = useAuth()
  const tenantId = useTenantId()
  const isOwnerOrAdmin = profile?.role === 'owner' || profile?.role === 'partner_admin' || profile?.role === 'super_admin'
  const [invoiceTx, setInvoiceTx] = useState<{ id: string; amount: number; description: string } | null>(null)

  return (
    <div>
      <h2 className="text-base font-semibold text-plum-800 mb-3">
        Movimientos de hoy ({txs?.length ?? 0})
      </h2>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="w-6 h-6 animate-spin text-plum-800" />
        </div>
      ) : !txs || txs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-gray-50 rounded-xl">
          <DollarSign className="w-10 h-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Sin movimientos hoy</p>
        </div>
      ) : (
        <div className="space-y-2">
          {txs.map((tx) => (
            <Card key={tx.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
                    tx.type === 'income' ? 'bg-green-50' : 'bg-red-50',
                  )}>
                    {tx.type === 'income'
                      ? <TrendingUp className="w-3.5 h-3.5 text-green-600" />
                      : <TrendingDown className="w-3.5 h-3.5 text-red-600" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-plum-800">{tx.description}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">
                        {tx.created_at
                          ? new Date(tx.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
                          : tx.date}
                      </span>
                      {tx.payment_method && (
                        <Badge variant="outline" className="text-xs h-4 px-1">
                          {PM_LABELS[tx.payment_method] ?? tx.payment_method}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'font-semibold text-sm tabular-nums',
                    tx.type === 'income' ? 'text-green-600' : 'text-red-600',
                  )}>
                    {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </span>
                  {isOwnerOrAdmin && tx.type === 'income' && (
                    <button
                      title="Emitir factura"
                      onClick={() => setInvoiceTx({ id: tx.id, amount: tx.amount, description: tx.description })}
                      className="ml-1 p-1 rounded hover:bg-plum-50 text-plum-400 hover:text-plum-700 transition-colors"
                    >
                      <FileText className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {invoiceTx && (
        <InvoiceModal
          isOpen={!!invoiceTx}
          onClose={() => setInvoiceTx(null)}
          tenantId={tenantId}
          clientName="Consumidor Final"
          amount={invoiceTx.amount}
          concept={invoiceTx.description}
          transactionId={invoiceTx.id}
        />
      )}
    </div>
  )
}

// ── Cierre de Caja modal ───────────────────────────────────────────────────────
function ModalCierreCaja({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const { data: txs, isLoading } = useTodayTransactions()
  const insertTx = useInsertTransaction()

  const [depositar, setDepositar] = useState('')
  const [ajusteAmt, setAjusteAmt] = useState('0')
  const [ajustePct, setAjustePct] = useState('0')
  const [notas, setNotas] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]

  const totals = useMemo(() => {
    if (!txs) return { ingresos: 0, egresos: 0, efectivo: 0, pmBreakdown: {} as Record<string, number> }
    const ingresos = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0)
    const egresos = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
    const cashIncome = txs
      .filter((t) => t.type === 'income' && t.payment_method === 'cash')
      .reduce((s, t) => s + t.amount, 0)
    const cashExpense = txs
      .filter((t) => t.type === 'expense' && t.payment_method === 'cash')
      .reduce((s, t) => s + t.amount, 0)
    const efectivo = cashIncome - cashExpense
    const pmBreakdown: Record<string, number> = {}
    txs.filter((t) => t.type === 'income').forEach((t) => {
      const pm = t.payment_method ?? 'other'
      pmBreakdown[pm] = (pmBreakdown[pm] ?? 0) + t.amount
    })
    return { ingresos, egresos, efectivo, pmBreakdown }
  }, [txs])

  const depositarNum = Number(depositar) || 0
  const ajusteAmtNum = Number(ajusteAmt) || 0
  const ajustePctNum = Number(ajustePct) || 0
  const efectivoQueda = Math.max(
    0,
    totals.efectivo - depositarNum - ajusteAmtNum - (totals.efectivo * ajustePctNum / 100),
  )

  async function handleConfirm() {
    if (!depositar || depositarNum <= 0) return
    setBusy(true)
    setError(null)
    try {
      const depositPayload = {
        type: 'expense' as const,
        category: 'cash_transfer',
        amount: depositarNum,
        payment_method: 'cash',
        description: `Depósito a caja mayor: ${formatCurrency(depositarNum)}${notas ? ` · ${notas}` : ''}`,
        date: today,
        user_id: user!.id,
        status: 'paid',
        is_recurring: false,
      }
      console.log('[CierreCaja] INSERT - Depósito a caja mayor:', depositPayload)
      await insertTx.mutateAsync(depositPayload)

      setSuccess(
        `Caja cerrada. Depositado a caja mayor: ${formatCurrency(depositarNum)}. Saldo para mañana: ${formatCurrency(efectivoQueda)}`,
      )
    } catch (e) {
      setError((e as Error).message || 'Error al cerrar la caja')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="w-4 h-4" /> Cerrar Caja del día
          </DialogTitle>
          <DialogDescription>
            {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-plum-800" /></div>
        ) : success ? (
          <div className="text-center py-6 space-y-3">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <TrendingUp className="w-6 h-6 text-green-600" />
            </div>
            <p className="font-semibold text-green-700">{success}</p>
            <Button onClick={onClose} className="w-full">Cerrar</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Resumen del día */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-plum-800">Resumen del día</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-green-50 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Ingresos</p>
                  <p className="text-sm font-bold text-green-700 tabular-nums">{formatCurrency(totals.ingresos)}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Egresos</p>
                  <p className="text-sm font-bold text-red-700 tabular-nums">{formatCurrency(totals.egresos)}</p>
                </div>
                <div className="bg-plum-50 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-muted-foreground">Saldo neto</p>
                  <p className={cn('text-sm font-bold tabular-nums', totals.ingresos - totals.egresos >= 0 ? 'text-plum-800' : 'text-red-700')}>
                    {formatCurrency(totals.ingresos - totals.egresos)}
                  </p>
                </div>
              </div>
              {/* Payment method breakdown */}
              {Object.keys(totals.pmBreakdown).length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b">
                        {PAYMENT_METHODS.map((pm) => (
                          <th key={pm.value} className="text-center text-xs font-medium text-muted-foreground py-1.5 px-2">{pm.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {PAYMENT_METHODS.map((pm) => (
                          <td key={pm.value} className="text-center text-xs tabular-nums py-1.5 px-2 text-plum-800 font-medium">
                            {totals.pmBreakdown[pm.value] ? formatCurrency(totals.pmBreakdown[pm.value]) : '—'}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Declaración de efectivo */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-plum-800">Declaración de efectivo</h3>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Efectivo en caja</span>
                <span className="font-semibold text-plum-800 tabular-nums">{formatCurrency(totals.efectivo)}</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Efectivo a depositar *</Label>
                  <Input type="number" min="0" step="1" placeholder="0"
                    value={depositar} onChange={(e) => setDepositar(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Ajuste por monto $</Label>
                    <Input type="number" min="0" step="1" value={ajusteAmt}
                      onChange={(e) => setAjusteAmt(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Ajuste por %</Label>
                    <Input type="number" min="0" max="100" step="1" value={ajustePct}
                      onChange={(e) => setAjustePct(e.target.value)} />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between bg-plum-50 rounded-lg px-3 py-2.5">
                <span className="text-sm font-medium text-plum-800">Efectivo que queda en caja</span>
                <span className="text-lg font-bold text-plum-800 tabular-nums">{formatCurrency(efectivoQueda)}</span>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notas del cierre</Label>
                <Input placeholder="Opcional" value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
              <Button onClick={handleConfirm} className="flex-1"
                disabled={busy || !depositar}>
                {busy
                  ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Cerrando...</>
                  : 'Cerrar caja del día'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Tab Caja ───────────────────────────────────────────────────────────────────
function TabCaja() {
  const [showCierre, setShowCierre] = useState(false)
  const [showVenderMembresia, setShowVenderMembresia] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <SectionResumenDia />
        </div>
        <div className="shrink-0 mt-1 flex gap-2">
          <Button variant="outline" size="sm"
            className="gap-1.5 border-plum-200 text-plum-800 hover:bg-plum-50"
            onClick={() => setShowVenderMembresia(true)}>
            <CreditCard className="w-3.5 h-3.5" /> Vender Membresía
          </Button>
          <Button variant="outline" size="sm"
            className="gap-1.5 border-plum-200 text-plum-800 hover:bg-plum-50"
            onClick={() => setShowCierre(true)}>
            <Lock className="w-3.5 h-3.5" /> Cerrar Caja
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionRegistrarCobro />
        <SectionGastosDelDia />
      </div>
      <SectionMovimientosHoy />
      {showCierre && <ModalCierreCaja onClose={() => setShowCierre(false)} />}
      {showVenderMembresia && (
        <VenderMembresiaModal
          open={showVenderMembresia}
          onClose={() => setShowVenderMembresia(false)}
        />
      )}
    </div>
  )
}

// ── P&L helpers ────────────────────────────────────────────────────────────────
function PLSectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-plum-50">
      <td colSpan={3} className="py-1.5 px-0 text-xs font-bold text-plum-700 uppercase tracking-wider">
        {label}
      </td>
    </tr>
  )
}

function PLRow({
  label, amount, bold, highlight, pct, indent, muted = false,
}: {
  label: string; amount: number; bold?: boolean
  highlight?: 'green' | 'red'; pct?: number; indent?: boolean; muted?: boolean
}) {
  return (
    <tr className={cn(
      'border-b last:border-0',
      highlight === 'green' ? 'bg-green-50' : '',
      highlight === 'red' ? 'bg-red-50' : '',
    )}>
      <td className={cn(
        'py-2 text-sm',
        (indent || muted) ? 'pl-5 text-muted-foreground' : bold ? 'font-semibold text-plum-800' : 'text-plum-800',
        muted ? 'italic' : '',
      )}>
        {label}
      </td>
      <td className={cn(
        'py-2 text-sm text-right tabular-nums whitespace-nowrap pl-6',
        bold ? 'font-semibold' : '',
        muted ? 'text-muted-foreground italic' : '',
        highlight === 'green' ? 'text-green-700' : '',
        highlight === 'red' ? 'text-red-700' : '',
        !highlight && !muted ? (bold ? 'text-plum-800' : 'text-gray-700') : '',
      )}>
        {formatCurrency(amount)}
      </td>
      <td className="py-2 text-xs text-right text-muted-foreground tabular-nums pl-4 w-14">
        {pct !== undefined ? `${pct.toFixed(1)}%` : ''}
      </td>
    </tr>
  )
}

// ── P&L types & helpers ───────────────────────────────────────────────────────

interface PLNumericFields {
  sesiones: number; membresias: number; giftCards: number; productos: number; totalIngresos: number
  cmvTeorico: number; cmvReal: number; diferenciaCMV: number; costoOperativo: number; costoVentaTotal: number
  utilidadBruta: number
  sueldoAdmin: number; alquiler: number; servicios: number; gestion: number; marketing: number
  mantenimiento: number; depreciacion: number; retiroSocios: number; otros: number; royalty: number; totalGastosOp: number
  utilidadOp: number
  gastosBancarios: number; totalGastosFinanc: number
  utilidadAntesImp: number; impuestos: number; utilidadNeta: number
}

type PLMonthData = { month: string } & PLNumericFields
type PeriodType = 'monthly' | 'quarterly' | 'semi-annual' | 'annual'

const MONTHS_ABBR = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function computePLMonth(
  txs: Transaction[],
  appointments: { service_id: string; duration_minutes: number }[],
  costItems: ServiceCostItem[],
): PLNumericFields {
  const inc = txs.filter((t) => t.type === 'income')
  const exp = txs.filter(
    (t) => t.type === 'expense' && !['cash_transfer', 'withdrawal'].includes(t.category ?? ''),
  )
  const sum = (arr: Transaction[]) => arr.reduce((s, t) => s + t.amount, 0)

  const sesiones = sum(inc.filter((t) => t.category === 'session'))
  const membresias = sum(inc.filter((t) => t.category === 'membership'))
  const giftCards = sum(inc.filter((t) => t.category === 'gift_card'))
  const productos = sum(inc.filter((t) => t.category === 'product'))
  const totalIngresos = sesiones + membresias + giftCards + productos

  const cmvTeorico = appointments.reduce((total, appt) => {
    const items = costItems.filter(
      (ci) => ci.service_id === appt.service_id && ci.duration_minutes === appt.duration_minutes,
    )
    return total + items.reduce((s, ci) => {
      const price = ci.supply?.unit_price ?? 0
      const cost = ci.supply?.unit === 'min' ? (price / 60) * ci.quantity : price * ci.quantity
      return s + cost
    }, 0)
  }, 0)
  const cmvReal = sum(exp.filter((t) => t.category === 'supplies'))
  const diferenciaCMV = cmvReal - cmvTeorico
  const costoOperativo = sum(exp.filter((t) => ['salary_operativo', 'salary', 'social_charges'].includes(t.category ?? '')))
  const costoVentaTotal = cmvReal + costoOperativo
  const utilidadBruta = totalIngresos - costoVentaTotal

  const sueldoAdmin = sum(exp.filter((t) => t.category === 'salary_admin'))
  const alquiler = sum(exp.filter((t) => t.category === 'rent'))
  const servicios = sum(exp.filter((t) => t.category === 'utilities'))
  const gestion = sum(exp.filter((t) => t.category === 'management'))
  const marketing = sum(exp.filter((t) => t.category === 'marketing'))
  const mantenimiento = sum(exp.filter((t) => t.category === 'maintenance'))
  const depreciacion = sum(exp.filter((t) => t.category === 'depreciation'))
  const retiroSocios = sum(exp.filter((t) => t.category === 'withdrawal'))
  const otros = sum(exp.filter((t) => t.category === 'other'))
  const royalty = totalIngresos * 0.05
  const totalGastosOp =
    sueldoAdmin + alquiler + servicios + gestion + marketing +
    mantenimiento + depreciacion + retiroSocios + otros + royalty
  const utilidadOp = utilidadBruta - totalGastosOp

  const gastosBancarios = sum(exp.filter((t) => t.category === 'bank_fees'))
  const totalGastosFinanc = gastosBancarios
  const utilidadAntesImp = utilidadOp - totalGastosFinanc
  const impuestos = 0
  const utilidadNeta = utilidadAntesImp - impuestos

  return {
    sesiones, membresias, giftCards, productos, totalIngresos,
    cmvTeorico, cmvReal, diferenciaCMV, costoOperativo, costoVentaTotal,
    utilidadBruta,
    sueldoAdmin, alquiler, servicios, gestion, marketing, mantenimiento, depreciacion, retiroSocios, otros, royalty, totalGastosOp,
    utilidadOp,
    gastosBancarios, totalGastosFinanc,
    utilidadAntesImp, impuestos, utilidadNeta,
  }
}

function sumPLFields(months: PLNumericFields[]): PLNumericFields {
  const init: PLNumericFields = {
    sesiones: 0, membresias: 0, giftCards: 0, productos: 0, totalIngresos: 0,
    cmvTeorico: 0, cmvReal: 0, diferenciaCMV: 0, costoOperativo: 0, costoVentaTotal: 0,
    utilidadBruta: 0,
    sueldoAdmin: 0, alquiler: 0, servicios: 0, gestion: 0, marketing: 0,
    mantenimiento: 0, depreciacion: 0, retiroSocios: 0, otros: 0, royalty: 0, totalGastosOp: 0,
    utilidadOp: 0,
    gastosBancarios: 0, totalGastosFinanc: 0,
    utilidadAntesImp: 0, impuestos: 0, utilidadNeta: 0,
  }
  return months.reduce((acc, m) => {
    ;(Object.keys(acc) as (keyof PLNumericFields)[]).forEach((k) => { acc[k] += m[k] })
    return acc
  }, { ...init })
}

type PLRowDef =
  | { type: 'section'; label: string; signHighlight?: boolean; diffHighlight?: boolean }
  | {
      type: 'item' | 'subtotal' | 'total' | 'info'
      label: string; key: keyof PLNumericFields
      showPct?: boolean; signHighlight?: boolean; diffHighlight?: boolean
    }

const PL_ROWS: PLRowDef[] = [
  { type: 'section', label: 'INGRESOS' },
  { type: 'item', label: 'Sesiones individuales', key: 'sesiones' },
  { type: 'item', label: 'Membresías', key: 'membresias' },
  { type: 'item', label: 'Gift Cards', key: 'giftCards' },
  { type: 'item', label: 'Productos', key: 'productos' },
  { type: 'total', label: 'Total ingresos brutos', key: 'totalIngresos' },
  { type: 'section', label: 'COSTO DE VENTA' },
  { type: 'info', label: 'CMV Teórico', key: 'cmvTeorico' },
  { type: 'item', label: 'CMV Real (insumos)', key: 'cmvReal' },
  { type: 'info', label: 'Diferencia CMV', key: 'diferenciaCMV', diffHighlight: true },
  { type: 'item', label: 'Costo Operativo (Sueldos + CCSS)', key: 'costoOperativo' },
  { type: 'subtotal', label: 'Costo de venta total', key: 'costoVentaTotal' },
  { type: 'total', label: 'UTILIDAD BRUTA', key: 'utilidadBruta', showPct: true, signHighlight: true },
  { type: 'section', label: 'GASTOS OPERATIVOS' },
  { type: 'item', label: 'Sueldo Administrativo', key: 'sueldoAdmin' },
  { type: 'item', label: 'Alquiler', key: 'alquiler' },
  { type: 'item', label: 'Servicios', key: 'servicios' },
  { type: 'item', label: 'Gestión', key: 'gestion' },
  { type: 'item', label: 'Marketing y Publicidad', key: 'marketing' },
  { type: 'item', label: 'Mantenimiento', key: 'mantenimiento' },
  { type: 'item', label: 'Depreciación', key: 'depreciacion' },
  { type: 'item', label: 'Retiro de Socios', key: 'retiroSocios' },
  { type: 'item', label: 'Otros Gastos', key: 'otros' },
  { type: 'item', label: 'Royalty (5%)', key: 'royalty' },
  { type: 'subtotal', label: 'Total Gastos Operativos', key: 'totalGastosOp' },
  { type: 'total', label: 'UTILIDAD DE OPERACIONES', key: 'utilidadOp', showPct: true, signHighlight: true },
  { type: 'section', label: 'GASTOS FINANCIEROS' },
  { type: 'item', label: 'Gastos Bancarios y Comisiones', key: 'gastosBancarios' },
  { type: 'subtotal', label: 'Total Gastos Financieros', key: 'totalGastosFinanc' },
  { type: 'subtotal', label: 'EBITDA', key: 'utilidadAntesImp' },
  { type: 'item', label: 'Impuestos', key: 'impuestos' },
  { type: 'total', label: 'UTILIDAD NETA', key: 'utilidadNeta', showPct: true, signHighlight: true },
]

const fmtC = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

// ── Multi-month P&L table ─────────────────────────────────────────────────────
function PLMultiMonthTable({ months, title }: { months: PLMonthData[]; title: string }) {
  const total = sumPLFields(months)

  function exportPL() {
    const data = PL_ROWS
      .filter((r) => r.type !== 'section')
      .map((r) => {
        const row: Record<string, unknown> = { 'Concepto': r.label }
        months.forEach((m) => { row[m.month] = m[r.key] })
        row['Total'] = total[r.key]
        return row
      })
    exportToExcel(data, `pl-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xlsx`, 'P&L')
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-plum-800">{title}</CardTitle>
          <Button variant="outline" size="sm" onClick={exportPL}>
            <FileDown className="w-4 h-4 mr-1.5" />
            Exportar Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 pb-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left pb-2 pt-3 px-4 min-w-[190px] text-sm font-medium text-muted-foreground">Concepto</th>
              {months.map((m) => {
                const [y, mo] = m.month.split('-')
                return (
                  <th key={m.month} className="text-right pb-2 pt-3 px-3 min-w-[90px] text-muted-foreground font-medium">
                    {MONTHS_ABBR[parseInt(mo) - 1]}<br />
                    <span className="text-[10px] font-normal">{y}</span>
                  </th>
                )
              })}
              <th className="text-right pb-2 pt-3 px-3 min-w-[90px] font-semibold text-plum-800 border-l border-gray-200">
                TOTAL
              </th>
            </tr>
          </thead>
          <tbody>
            {PL_ROWS.map((row, i) => {
              if (row.type === 'section') {
                return (
                  <tr key={i} className="bg-gray-50">
                    <td
                      colSpan={months.length + 2}
                      className="py-1.5 px-4 text-[10px] font-semibold text-plum-700 uppercase tracking-widest"
                    >
                      {row.label}
                    </td>
                  </tr>
                )
              }
              const key = row.key
              const isTotal = row.type === 'total'
              const isSub = row.type === 'subtotal'
              const isMuted = row.type === 'info'
              const totalVal = total[key]
              const totalPct = total.totalIngresos > 0
                ? ((totalVal / total.totalIngresos) * 100).toFixed(1) + '%'
                : '—'

              function cellColor(val: number): string {
                if (row.signHighlight) return val >= 0 ? 'text-green-700' : 'text-red-600'
                if (row.diffHighlight) return val <= 0 ? 'text-green-700' : 'text-red-600'
                if (isMuted) return 'text-muted-foreground'
                if (isTotal || isSub) return 'text-plum-800'
                return 'text-gray-700'
              }

              return (
                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className={cn(
                    'py-1.5 px-4',
                    isMuted ? 'text-muted-foreground italic text-[11px]' : '',
                    !isMuted && row.type === 'item' ? 'pl-8 text-gray-700' : '',
                    !isMuted && (isTotal || isSub) ? 'font-semibold text-plum-800' : '',
                  )}>
                    {row.label}
                  </td>
                  {months.map((m) => {
                    const val = m[key]
                    const pct = m.totalIngresos > 0
                      ? ((val / m.totalIngresos) * 100).toFixed(1) + '%'
                      : '—'
                    return (
                      <td key={m.month} className="py-1.5 px-3 text-right tabular-nums">
                        <div className={cn(
                          (isTotal || isSub) ? 'font-semibold' : '',
                          isMuted ? 'italic' : '',
                          cellColor(val),
                        )}>
                          {fmtC(val)}
                        </div>
                        {(isTotal || isSub) && (
                          <div className="text-[10px] text-muted-foreground">{pct}</div>
                        )}
                      </td>
                    )
                  })}
                  <td className="py-1.5 px-3 text-right tabular-nums border-l border-gray-200">
                    <div className={cn(
                      (isTotal || isSub) ? 'font-semibold' : '',
                      isMuted ? 'italic' : '',
                      cellColor(totalVal),
                    )}>
                      {fmtC(totalVal)}
                    </div>
                    {(isTotal || isSub) && (
                      <div className="text-[10px] text-muted-foreground">{totalPct}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

// ── Treasury helpers ───────────────────────────────────────────────────────────
type TreasuryTheoreticals = { cash: number; transfer: number; mpQr: number; cards: number; cajaMayor: number }

function TreasurySectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-gray-50">
      <td colSpan={4} className="py-1.5 text-[10px] font-semibold text-plum-700 uppercase tracking-widest">
        {label}
      </td>
    </tr>
  )
}

function TreasuryItemRow({
  label, theoretical, declared, onDeclaredChange,
}: {
  label: string; theoretical: number; declared: string
  onDeclaredChange: (val: string) => void
}) {
  const diff = (Number(declared) || 0) - theoretical
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3 text-sm text-gray-700">{label}</td>
      <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
        {formatCurrency(theoretical)}
      </td>
      <td className="py-2 px-3">
        <Input type="number" min="0" step="1" value={declared}
          onChange={(e) => onDeclaredChange(e.target.value)}
          className="text-right h-7 text-sm w-28 ml-auto" />
      </td>
      <td className={cn(
        'py-2 pl-3 text-sm text-right tabular-nums font-medium w-28',
        diff === 0 ? 'text-gray-500' : diff > 0 ? 'text-green-700' : 'text-red-600',
      )}>
        {diff > 0 ? '+' : ''}{formatCurrency(diff)}
      </td>
    </tr>
  )
}

// ── Nueva Declaración modal ────────────────────────────────────────────────────
function NuevaDeclaracionModal({
  month, theoreticals, onClose,
}: {
  month: string; theoreticals: TreasuryTheoreticals; onClose: () => void
}) {
  const { user } = useAuth()
  const createDeclaration = useCreateTreasuryDeclaration()
  const [cashDeclared, setCashDeclared] = useState(String(Math.max(0, Math.round(theoreticals.cash))))
  const [bankAccounts, setBankAccounts] = useState<{ label: string; declared: string }[]>([
    { label: 'Transferencias', declared: String(Math.max(0, Math.round(theoreticals.transfer))) },
  ])
  const [mpQrDeclared, setMpQrDeclared] = useState(String(Math.max(0, Math.round(theoreticals.mpQr))))
  const [cardsDeclared, setCardsDeclared] = useState(String(Math.max(0, Math.round(theoreticals.cards))))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  function updateBankAccount(i: number, field: 'label' | 'declared', value: string) {
    setBankAccounts((prev) => prev.map((ba, idx) => idx === i ? { ...ba, [field]: value } : ba))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return
    setError(null)
    const items = [
      { category: 'cash', label: 'Efectivo en caja', theoretical_amount: theoreticals.cash, declared_amount: Number(cashDeclared) || 0 },
      ...bankAccounts.map((ba, i) => ({
        category: 'transfer',
        label: ba.label || `Cuenta ${i + 1}`,
        theoretical_amount: i === 0 ? theoreticals.transfer : 0,
        declared_amount: Number(ba.declared) || 0,
      })),
      { category: 'mp_qr', label: 'MP / QR', theoretical_amount: theoreticals.mpQr, declared_amount: Number(mpQrDeclared) || 0 },
      { category: 'cards', label: 'Tarjetas', theoretical_amount: theoreticals.cards, declared_amount: Number(cardsDeclared) || 0 },
    ]
    try {
      await createDeclaration.mutateAsync({ month, declared_by: user.id, notes: notes || undefined, items })
      onClose()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const [y, mo] = month.split('-')

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Nueva Declaración de Tesorería
          </DialogTitle>
          <DialogDescription>{MONTHS_ES[parseInt(mo) - 1]} {y}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left text-xs text-muted-foreground font-medium pb-2">Concepto</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 px-3 min-w-[100px]">Teórico</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 px-3 min-w-[110px]">Declarado</th>
                  <th className="text-right text-xs text-muted-foreground font-medium pb-2 pl-3 min-w-[100px]">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                <TreasurySectionHeader label="Efectivo" />
                <TreasuryItemRow
                  label="Efectivo en caja" theoretical={theoreticals.cash}
                  declared={cashDeclared} onDeclaredChange={setCashDeclared}
                />
                {theoreticals.cajaMayor > 0 && (
                  <tr className="border-b last:border-0 bg-amber-50/40">
                    <td className="py-2 pr-3 text-sm text-gray-600">
                      <span className="flex items-center gap-1.5">
                        <Landmark className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        Caja Mayor (depósitos acumulados)
                      </span>
                    </td>
                    <td className="py-2 px-3 text-sm text-right tabular-nums text-amber-700 font-medium">
                      {formatCurrency(theoreticals.cajaMayor)}
                    </td>
                    <td className="py-2 px-3 text-sm text-right text-muted-foreground italic">solo lectura</td>
                    <td className="py-2 pl-3 text-sm text-right text-muted-foreground">—</td>
                  </tr>
                )}

                <TreasurySectionHeader label="Cuentas bancarias" />
                {bankAccounts.map((ba, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-2 pr-3">
                      <Input value={ba.label}
                        onChange={(e) => updateBankAccount(i, 'label', e.target.value)}
                        placeholder={`Cuenta ${i + 1}`} className="h-7 text-sm" />
                    </td>
                    <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
                      {formatCurrency(i === 0 ? theoreticals.transfer : 0)}
                    </td>
                    <td className="py-2 px-3">
                      <Input type="number" min="0" step="1" value={ba.declared}
                        onChange={(e) => updateBankAccount(i, 'declared', e.target.value)}
                        className="text-right h-7 text-sm w-28 ml-auto" />
                    </td>
                    <td className="py-2 pl-3">
                      {(() => {
                        const theoretical = i === 0 ? theoreticals.transfer : 0
                        const diff = (Number(ba.declared) || 0) - theoretical
                        return (
                          <div className="flex items-center justify-end gap-2">
                            <span className={cn(
                              'text-sm tabular-nums font-medium',
                              diff === 0 ? 'text-gray-500' : diff > 0 ? 'text-green-700' : 'text-red-600',
                            )}>
                              {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                            </span>
                            {i > 0 && (
                              <button type="button"
                                onClick={() => setBankAccounts((p) => p.filter((_, idx) => idx !== i))}
                                className="text-muted-foreground hover:text-red-500 text-xl leading-none ml-1">
                                ×
                              </button>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                ))}

                <TreasurySectionHeader label="Medios electrónicos" />
                <TreasuryItemRow
                  label="MP / QR" theoretical={theoreticals.mpQr}
                  declared={mpQrDeclared} onDeclaredChange={setMpQrDeclared}
                />
                <TreasuryItemRow
                  label="Tarjetas (débito + crédito)" theoretical={theoreticals.cards}
                  declared={cardsDeclared} onDeclaredChange={setCardsDeclared}
                />
              </tbody>
            </table>
          </div>

          <Button type="button" variant="outline" size="sm"
            onClick={() => setBankAccounts((p) => [...p, { label: '', declared: '' }])}
            className="text-xs gap-1">
            + Agregar cuenta bancaria
          </Button>

          <div className="space-y-1">
            <Label className="text-xs">Notas</Label>
            <Input placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">Cancelar</Button>
            <Button type="submit" className="flex-1" disabled={createDeclaration.isPending}>
              {createDeclaration.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Guardar declaración
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Section Balance de Tesorería ───────────────────────────────────────────────
function SectionBalanceTesoreria({ txs, month }: { txs: Transaction[]; month: string }) {
  const { user } = useAuth()
  const [showModal, setShowModal] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: declarations, isLoading } = useTreasuryDeclarations(month)
  const { data: expandedItems, isLoading: expandedLoading } = useTreasuryItems(expandedId)

  const theoreticals = useMemo((): TreasuryTheoreticals => {
    const cajaMayor = txs
      .filter((t) => t.type === 'expense' && t.category === 'cash_transfer')
      .reduce((s, t) => s + t.amount, 0)
    const netPm = (methods: string[], excludeCashTransfer = false) => {
      const inc = txs
        .filter((t) => t.type === 'income' && methods.includes(t.payment_method ?? ''))
        .reduce((s, t) => s + t.amount, 0)
      const exp = txs
        .filter(
          (t) =>
            t.type === 'expense' &&
            methods.includes(t.payment_method ?? '') &&
            (!excludeCashTransfer || t.category !== 'cash_transfer'),
        )
        .reduce((s, t) => s + t.amount, 0)
      return inc - exp
    }
    return {
      cash: netPm(['cash'], true),
      transfer: netPm(['transfer']),
      mpQr: netPm(['mp', 'qr']),
      cards: netPm(['debit', 'credit']),
      cajaMayor,
    }
  }, [txs])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-plum-800 flex items-center gap-2">
            <Wallet className="w-4 h-4" /> Balance de Tesorería
          </CardTitle>
          <Button size="sm" variant="outline" className="gap-1 text-xs h-7 px-2.5"
            onClick={() => setShowModal(true)}>
            + Nueva declaración
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !declarations || declarations.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground bg-gray-50 rounded-xl">
            <Wallet className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">Sin declaraciones este mes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {declarations.map((d) => {
              const isExpanded = expandedId === d.id
              return (
                <div key={d.id} className="border rounded-lg overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-plum-800">
                        {new Date(d.declared_at).toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })}
                        {' '}
                        <span className="text-muted-foreground font-normal text-xs">
                          {new Date(d.declared_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </span>
                      {d.declared_by === user?.id && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1">por mí</Badge>
                      )}
                    </div>
                    <ChevronRight className={cn(
                      'w-4 h-4 text-muted-foreground transition-transform',
                      isExpanded && 'rotate-90',
                    )} />
                  </button>

                  {isExpanded && (
                    <div className="border-t bg-gray-50/50 px-4 pb-4">
                      {expandedLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : expandedItems ? (
                        <>
                          <table className="w-full mt-3">
                            <thead>
                              <tr className="border-b">
                                <th className="text-left text-xs text-muted-foreground font-medium pb-2">Concepto</th>
                                <th className="text-right text-xs text-muted-foreground font-medium pb-2 px-3">Teórico</th>
                                <th className="text-right text-xs text-muted-foreground font-medium pb-2 px-3">Declarado</th>
                                <th className="text-right text-xs text-muted-foreground font-medium pb-2 pl-3">Diferencia</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expandedItems.map((item: TreasuryItem) => {
                                const diff = item.declared_amount - item.theoretical_amount
                                return (
                                  <tr key={item.id} className="border-b last:border-0">
                                    <td className="py-2 text-sm text-gray-700">{item.label}</td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums text-muted-foreground">
                                      {formatCurrency(item.theoretical_amount)}
                                    </td>
                                    <td className="py-2 px-3 text-sm text-right tabular-nums">
                                      {formatCurrency(item.declared_amount)}
                                    </td>
                                    <td className={cn(
                                      'py-2 pl-3 text-sm text-right tabular-nums font-medium',
                                      diff === 0 ? 'text-gray-500' : diff > 0 ? 'text-green-700' : 'text-red-600',
                                    )}>
                                      {diff > 0 ? '+' : ''}{formatCurrency(diff)}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                            {expandedItems.length > 0 && (() => {
                              const totalDiff = expandedItems.reduce(
                                (s: number, i: TreasuryItem) => s + (i.declared_amount - i.theoretical_amount), 0,
                              )
                              return (
                                <tfoot>
                                  <tr className="border-t-2">
                                    <td colSpan={3} className="pt-2 text-sm font-semibold text-plum-800">
                                      Total diferencia
                                    </td>
                                    <td className={cn(
                                      'pt-2 pl-3 text-sm text-right tabular-nums font-bold',
                                      totalDiff === 0 ? 'text-gray-500' : totalDiff > 0 ? 'text-green-700' : 'text-red-600',
                                    )}>
                                      {totalDiff > 0 ? '+' : ''}{formatCurrency(totalDiff)}
                                    </td>
                                  </tr>
                                </tfoot>
                              )
                            })()}
                          </table>
                          {d.notes && (
                            <p className="text-xs text-muted-foreground mt-2 italic">Nota: {d.notes}</p>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {showModal && (
        <NuevaDeclaracionModal
          month={month}
          theoreticals={theoreticals}
          onClose={() => setShowModal(false)}
        />
      )}
    </Card>
  )
}

// ── Tab P&L ────────────────────────────────────────────────────────────────────
function TabPL() {
  const now = new Date()
  const [periodType, setPeriodType] = useState<PeriodType>('monthly')
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [quarter, setQuarter] = useState<1 | 2 | 3 | 4>(
    Math.ceil((now.getMonth() + 1) / 3) as 1 | 2 | 3 | 4,
  )
  const [half, setHalf] = useState<1 | 2>(now.getMonth() < 6 ? 1 : 2)
  const [allTenants, setAllTenants] = useState(false)

  const months = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0')
    if (periodType === 'monthly') return [`${year}-${pad(month)}`]
    if (periodType === 'quarterly') {
      const start = (quarter - 1) * 3 + 1
      return Array.from({ length: 3 }, (_, i) => `${year}-${pad(start + i)}`)
    }
    if (periodType === 'semi-annual') {
      const start = half === 1 ? 1 : 7
      return Array.from({ length: 6 }, (_, i) => `${year}-${pad(start + i)}`)
    }
    return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`)
  }, [periodType, year, month, quarter, half])

  const startDate = `${months[0]}-01`
  const endDate = useMemo(() => {
    const [y, m] = months[months.length - 1].split('-').map(Number)
    return new Date(y, m, 0).toISOString().split('T')[0]
  }, [months])

  const { data: txs, isLoading: txLoading } = useTransactionsRange(startDate, endDate, !allTenants)
  const { data: rawAppts, isLoading: apptLoading } = useCompletedAppointmentsForCMV(startDate, endDate, !allTenants)
  const { data: costItems } = useAllServiceCostItems()
  const isLoading = txLoading || apptLoading

  const monthlyPL = useMemo((): PLMonthData[] | null => {
    if (!txs) return null
    const appts = rawAppts ?? []
    const items = costItems ?? []
    return months.map((m) => ({
      month: m,
      ...computePLMonth(
        txs.filter((t) => t.date.startsWith(m)),
        appts.filter((a) => a.scheduled_at.startsWith(m)),
        items,
      ),
    }))
  }, [txs, rawAppts, costItems, months])

  const panels = useMemo(() => {
    if (periodType !== 'monthly' || !txs || txs.length === 0) return null
    const inc = txs.filter((t) => t.type === 'income')
    const sum = (arr: typeof txs) => arr.reduce((s, t) => s + t.amount, 0)
    const weeks = [
      { label: 'Semana 1', from: 1, to: 7 },
      { label: 'Semana 2', from: 8, to: 14 },
      { label: 'Semana 3', from: 15, to: 21 },
      { label: 'Semana 4', from: 22, to: 31 },
    ]
    const cashFlow = weeks.map((w) => {
      const inW = sum(txs.filter((t) => {
        const d = parseInt(t.date.split('-')[2])
        return t.type === 'income' && d >= w.from && d <= w.to
      }))
      const exW = sum(txs.filter((t) => {
        const d = parseInt(t.date.split('-')[2])
        return t.type === 'expense' && d >= w.from && d <= w.to
      }))
      return { label: w.label, ingresos: inW, egresos: exW, saldo: inW - exW }
    })
    const pmBreakdown: Record<string, number> = {}
    inc.forEach((t) => {
      const pm = t.payment_method ?? 'other'
      pmBreakdown[pm] = (pmBreakdown[pm] ?? 0) + t.amount
    })
    const svcMap: Record<string, { count: number; total: number }> = {}
    inc.filter((t) => t.category === 'session').forEach((t) => {
      const match = t.description?.match(/^Sesión:\s*(.+)$/)
      const name = match ? match[1].trim() : (t.description ?? 'Servicio')
      if (!svcMap[name]) svcMap[name] = { count: 0, total: 0 }
      svcMap[name].count++
      svcMap[name].total += t.amount
    })
    const serviceRanking = Object.entries(svcMap)
      .map(([name, { count, total }]) => ({ name, count, total, avg: count > 0 ? total / count : 0 }))
      .sort((a, b) => b.total - a.total)
    return { cashFlow, pmBreakdown, serviceRanking }
  }, [periodType, txs])

  function prevPeriod() {
    if (periodType === 'monthly') {
      if (month === 1) { setMonth(12); setYear((y) => y - 1) } else setMonth((m) => m - 1)
    } else if (periodType === 'quarterly') {
      if (quarter === 1) { setQuarter(4); setYear((y) => y - 1) } else setQuarter((q) => (q - 1) as 1 | 2 | 3 | 4)
    } else if (periodType === 'semi-annual') {
      if (half === 1) { setHalf(2); setYear((y) => y - 1) } else setHalf(1)
    } else { setYear((y) => y - 1) }
  }
  function nextPeriod() {
    if (periodType === 'monthly') {
      if (month === 12) { setMonth(1); setYear((y) => y + 1) } else setMonth((m) => m + 1)
    } else if (periodType === 'quarterly') {
      if (quarter === 4) { setQuarter(1); setYear((y) => y + 1) } else setQuarter((q) => (q + 1) as 1 | 2 | 3 | 4)
    } else if (periodType === 'semi-annual') {
      if (half === 2) { setHalf(1); setYear((y) => y + 1) } else setHalf(2)
    } else { setYear((y) => y + 1) }
  }

  const periodLabel =
    periodType === 'monthly' ? `${MONTHS_ES[month - 1]} ${year}`
    : periodType === 'quarterly' ? `Q${quarter} ${year}`
    : periodType === 'semi-annual' ? `H${half} — ${year}`
    : `Año ${year}`

  const pl = monthlyPL?.[0] ?? null

  // ── Unused var shim so we keep old destructuring lint clean ──
  return (
    <div className="space-y-6">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5">
          {(['monthly', 'quarterly', 'semi-annual', 'annual'] as PeriodType[]).map((t) => (
            <button
              key={t}
              onClick={() => setPeriodType(t)}
              className={cn(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                periodType === t
                  ? 'bg-white text-plum-800 shadow-sm'
                  : 'text-muted-foreground hover:text-plum-700',
              )}
            >
              {t === 'monthly' ? 'Mensual' : t === 'quarterly' ? 'Trimestral' : t === 'semi-annual' ? 'Semestral' : 'Anual'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="w-7 h-7" onClick={prevPeriod}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <span className="text-sm font-medium text-plum-800 min-w-[144px] text-center">
            {periodLabel}
          </span>
          <Button variant="outline" size="icon" className="w-7 h-7" onClick={nextPeriod}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-1 gap-0.5 ml-auto">
          <button
            onClick={() => setAllTenants(false)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              !allTenants ? 'bg-white text-plum-800 shadow-sm' : 'text-muted-foreground hover:text-plum-700',
            )}
          >
            Urquiza
          </button>
          <button
            onClick={() => setAllTenants(true)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              allTenants ? 'bg-white text-plum-800 shadow-sm' : 'text-muted-foreground hover:text-plum-700',
            )}
          >
            Marca
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
        </div>
      ) : !monthlyPL ? null
        : periodType !== 'monthly' ? (
          <PLMultiMonthTable months={monthlyPL} title={`Estado de Resultados — ${periodLabel}`} />
        ) : !txs || txs.length === 0 || !pl ? (
          <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Sin datos para {periodLabel}</p>
          </div>
        ) : (
          <>
            {/* Single-month P&L table */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base text-plum-800">
                    Estado de Resultados — {periodLabel}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (!pl) return
                      exportToExcel(
                        PL_ROWS.filter((r) => r.type !== 'section').map((r) => ({
                          'Concepto': r.label,
                          'Monto': pl[r.key],
                        })),
                        `pl-${periodLabel.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.xlsx`,
                        'P&L',
                      )
                    }}
                  >
                    <FileDown className="w-4 h-4 mr-1.5" />
                    Exportar Excel
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left text-xs text-muted-foreground font-medium pb-2">Concepto</th>
                      <th className="text-right text-xs text-muted-foreground font-medium pb-2 pl-6">Monto</th>
                      <th className="text-right text-xs text-muted-foreground font-medium pb-2 pl-4 w-14">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PL_ROWS.map((row, i) => {
                      if (row.type === 'section') return <PLSectionHeader key={i} label={row.label} />
                      const val = pl[row.key]
                      const pct = row.showPct && pl.totalIngresos > 0
                        ? (val / pl.totalIngresos) * 100
                        : undefined
                      const highlight: 'green' | 'red' | undefined = row.signHighlight
                        ? (val >= 0 ? 'green' : 'red')
                        : row.diffHighlight
                          ? (val <= 0 ? 'green' : 'red')
                          : undefined
                      return (
                        <PLRow
                          key={i}
                          label={row.label}
                          amount={val}
                          indent={row.type === 'item'}
                          bold={row.type === 'total' || row.type === 'subtotal'}
                          pct={pct}
                          highlight={highlight}
                          muted={row.type === 'info'}
                        />
                      )
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Panels (monthly only) */}
            {panels && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base text-plum-800">Cash Flow del mes</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left text-xs text-muted-foreground font-medium pb-2 w-24"></th>
                          {panels.cashFlow.map((w) => (
                            <th key={w.label} className="text-right text-xs text-muted-foreground font-medium pb-2">
                              {w.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-b">
                          <td className="py-2 text-sm text-plum-800">Ingresos</td>
                          {panels.cashFlow.map((w) => (
                            <td key={w.label} className="py-2 text-sm text-right tabular-nums text-green-600">
                              {formatCurrency(w.ingresos)}
                            </td>
                          ))}
                        </tr>
                        <tr className="border-b">
                          <td className="py-2 text-sm text-plum-800">Egresos</td>
                          {panels.cashFlow.map((w) => (
                            <td key={w.label} className="py-2 text-sm text-right tabular-nums text-red-600">
                              {formatCurrency(w.egresos)}
                            </td>
                          ))}
                        </tr>
                        <tr>
                          <td className="py-2 text-sm font-semibold text-plum-800">Saldo neto</td>
                          {panels.cashFlow.map((w) => (
                            <td key={w.label} className={cn(
                              'py-2 text-sm text-right font-semibold tabular-nums',
                              w.saldo >= 0 ? 'text-green-700' : 'text-red-700',
                            )}>
                              {formatCurrency(w.saldo)}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base text-plum-800">Breakdown por medio de pago</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {Object.keys(panels.pmBreakdown).length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin datos</p>
                      ) : (
                        <div className="space-y-2.5">
                          {PAYMENT_METHODS.map((pm) => {
                            const amt = panels.pmBreakdown[pm.value] ?? 0
                            if (!amt) return null
                            return (
                              <div key={pm.value} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-3.5 h-3.5 text-muted-foreground" />
                                  <span className="text-sm">{pm.label}</span>
                                </div>
                                <span className="text-sm font-medium text-plum-800 tabular-nums">
                                  {formatCurrency(amt)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base text-plum-800">Rentabilidad por servicio</CardTitle>
                    </CardHeader>
                    <CardContent className="overflow-x-auto">
                      {panels.serviceRanking.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Sin datos</p>
                      ) : (
                        <table className="w-full">
                          <thead>
                            <tr className="border-b">
                              <th className="text-left text-xs text-muted-foreground font-medium pb-2">Servicio</th>
                              <th className="text-right text-xs text-muted-foreground font-medium pb-2">Ses.</th>
                              <th className="text-right text-xs text-muted-foreground font-medium pb-2">Facturación</th>
                              <th className="text-right text-xs text-muted-foreground font-medium pb-2">Ticket</th>
                            </tr>
                          </thead>
                          <tbody>
                            {panels.serviceRanking.map((s) => (
                              <tr key={s.name} className="border-b last:border-0">
                                <td className="py-2 text-sm text-plum-800 max-w-[120px] truncate">{s.name}</td>
                                <td className="py-2 text-sm text-right text-gray-600">{s.count}</td>
                                <td className="py-2 text-sm text-right tabular-nums font-medium text-plum-800">
                                  {formatCurrency(s.total)}
                                </td>
                                <td className="py-2 text-sm text-right tabular-nums text-gray-600">
                                  {formatCurrency(s.avg)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      {!isLoading && monthlyPL && (
        <SectionProductividadOperativa
          months={months}
          txs={txs ?? []}
          startDate={startDate}
          endDate={endDate}
        />
      )}
      {!isLoading && periodType === 'monthly' && (
        <SectionBalanceTesoreria txs={txs ?? []} month={months[0]} />
      )}
    </div>
  )
}

// ── Productividad Operativa ───────────────────────────────────────────────────

function ProductividadBadge({ pct }: { pct: number }) {
  if (pct <= 0) return <span className="text-muted-foreground text-xs">—</span>
  const cls =
    pct >= 100 ? 'bg-green-100 text-green-700' :
    pct >= 80  ? 'bg-yellow-100 text-yellow-700' :
                 'bg-red-100 text-red-700'
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[11px] font-semibold', cls)}>
      {pct.toFixed(1)}%
    </span>
  )
}

type EmpMonthDetail = { name: string; horasNetas: number; tarifa: number; costoTeorico: number }

type ProdMonthData = {
  yearMonth: string
  costoTeorico: number
  costoReal: number
  gap: number
  productividad: number
  hasHourlyEmployees: boolean
  employeeDetails: EmpMonthDetail[]
}

function SectionProductividadOperativa({
  months,
  txs,
  startDate,
  endDate,
}: {
  months: string[]
  txs: Transaction[]
  startDate: string
  endDate: string
}) {
  const [showDetail, setShowDetail] = useState(false)
  const { data: employees, isLoading: empLoading } = useEmployeeProfiles()
  const { data: allAbsences, isLoading: absLoading } = useAbsencesRange(startDate, endDate)
  const isLoading = empLoading || absLoading

  const monthlyData = useMemo((): ProdMonthData[] | null => {
    if (!employees || !allAbsences) return null
    return months.map((yearMonth) => {
      const [y, m] = yearMonth.split('-').map(Number)
      const monthStart = `${yearMonth}-01`
      const monthEnd = new Date(y, m, 0).toISOString().split('T')[0]
      const monthAbsences = allAbsences.filter((a) => a.date >= monthStart && a.date <= monthEnd)
      const hourlyEmps = employees.filter((e) => e.active && e.position?.contract_type === 'hourly')
      const employeeDetails: EmpMonthDetail[] = hourlyEmps.map((emp) => {
        const horasSchedule = calcMonthScheduleHours(emp.user?.schedule, y, m)
        const horasAusentes = monthAbsences
          .filter((a) => a.user_id === emp.user_id && a.deduct_from_salary)
          .reduce((s, a) => s + a.hours_absent, 0)
        const horasNetas = Math.max(0, horasSchedule - horasAusentes)
        const tarifa = emp.position?.hourly_rate ?? 0
        return { name: emp.user?.full_name ?? '—', horasNetas, tarifa, costoTeorico: horasNetas * tarifa }
      })
      const costoTeorico = employeeDetails.reduce((s, e) => s + e.costoTeorico, 0)
      const costoReal = txs
        .filter((t) => t.date.startsWith(yearMonth) && t.type === 'expense' && ['salary_operativo', 'salary', 'social_charges'].includes(t.category ?? ''))
        .reduce((s, t) => s + t.amount, 0)
      return {
        yearMonth, costoTeorico, costoReal,
        gap: costoReal - costoTeorico,
        productividad: costoReal > 0 ? (costoTeorico / costoReal) * 100 : 0,
        hasHourlyEmployees: hourlyEmps.length > 0,
        employeeDetails,
      }
    })
  }, [employees, allAbsences, txs, months])

  const totals = useMemo(() => {
    if (!monthlyData) return null
    const costoTeorico = monthlyData.reduce((s, m) => s + m.costoTeorico, 0)
    const costoReal    = monthlyData.reduce((s, m) => s + m.costoReal, 0)
    return {
      costoTeorico, costoReal,
      gap: costoReal - costoTeorico,
      productividad: costoReal > 0 ? (costoTeorico / costoReal) * 100 : 0,
      hasHourlyEmployees: monthlyData.some((m) => m.hasHourlyEmployees),
    }
  }, [monthlyData])

  const aggregatedEmployees = useMemo((): EmpMonthDetail[] => {
    if (!monthlyData) return []
    const map = new Map<string, EmpMonthDetail>()
    for (const md of monthlyData) {
      for (const ed of md.employeeDetails) {
        const existing = map.get(ed.name)
        if (existing) {
          existing.horasNetas += ed.horasNetas
          existing.costoTeorico += ed.costoTeorico
        } else {
          map.set(ed.name, { ...ed })
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => b.costoTeorico - a.costoTeorico)
  }, [monthlyData])

  const isMulti = months.length > 1

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-plum-800 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Productividad Operativa
        </CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0 pb-4">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !monthlyData || !totals ? null
        : !totals.hasHourlyEmployees ? (
          <div className="text-center py-8 text-muted-foreground text-sm px-4">
            Sin datos de RRHH para el período seleccionado
          </div>
        ) : isMulti ? (
          /* ── Multi-month view ── */
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left pb-2 pt-3 px-4 min-w-[190px] text-sm font-medium text-muted-foreground">Concepto</th>
                  {monthlyData.map((md) => {
                    const [y, mo] = md.yearMonth.split('-')
                    return (
                      <th key={md.yearMonth} className="text-right pb-2 pt-3 px-3 min-w-[90px] text-muted-foreground font-medium">
                        {MONTHS_ABBR[parseInt(mo) - 1]}<br />
                        <span className="text-[10px] font-normal">{y}</span>
                      </th>
                    )
                  })}
                  <th className="text-right pb-2 pt-3 px-3 min-w-[90px] font-semibold text-plum-800 border-l border-gray-200">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-gray-50">
                  <td colSpan={months.length + 2} className="py-1.5 px-4 text-[10px] font-semibold text-plum-700 uppercase tracking-widest">
                    PRODUCTIVIDAD OPERATIVA
                  </td>
                </tr>

                {/* Costo Teórico */}
                <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 px-4 pl-8 text-gray-700">Costo Operativo Teórico</td>
                  {monthlyData.map((md) => (
                    <td key={md.yearMonth} className="py-1.5 px-3 text-right tabular-nums text-gray-700">
                      {md.hasHourlyEmployees
                        ? fmtC(md.costoTeorico)
                        : <span className="text-muted-foreground text-[10px]">Sin datos</span>}
                    </td>
                  ))}
                  <td className="py-1.5 px-3 text-right tabular-nums font-semibold text-plum-800 border-l border-gray-200">
                    {fmtC(totals.costoTeorico)}
                  </td>
                </tr>

                {/* Costo Real */}
                <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 px-4 pl-8 text-gray-700">Costo Operativo Real</td>
                  {monthlyData.map((md) => (
                    <td key={md.yearMonth} className="py-1.5 px-3 text-right tabular-nums text-gray-700">
                      {fmtC(md.costoReal)}
                    </td>
                  ))}
                  <td className="py-1.5 px-3 text-right tabular-nums font-semibold text-plum-800 border-l border-gray-200">
                    {fmtC(totals.costoReal)}
                  </td>
                </tr>

                {/* GAP */}
                <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 px-4 font-semibold text-plum-800">GAP (Real − Teórico)</td>
                  {monthlyData.map((md) => (
                    <td key={md.yearMonth} className={cn(
                      'py-1.5 px-3 text-right tabular-nums font-semibold',
                      md.gap <= 0 ? 'text-green-700' : 'text-red-600',
                    )}>
                      {md.gap > 0 ? '+' : ''}{fmtC(md.gap)}
                    </td>
                  ))}
                  <td className={cn(
                    'py-1.5 px-3 text-right tabular-nums font-semibold border-l border-gray-200',
                    totals.gap <= 0 ? 'text-green-700' : 'text-red-600',
                  )}>
                    {totals.gap > 0 ? '+' : ''}{fmtC(totals.gap)}
                  </td>
                </tr>

                {/* % Productividad */}
                <tr className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="py-1.5 px-4 font-semibold text-plum-800">% Productividad</td>
                  {monthlyData.map((md) => (
                    <td key={md.yearMonth} className="py-1.5 px-3 text-right">
                      <ProductividadBadge pct={md.productividad} />
                    </td>
                  ))}
                  <td className="py-1.5 px-3 text-right border-l border-gray-200">
                    <ProductividadBadge pct={totals.productividad} />
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Employee breakdown */}
            {aggregatedEmployees.length > 0 && (
              <div className="px-4 mt-3">
                <button
                  onClick={() => setShowDetail((v) => !v)}
                  className="text-xs text-plum-700 underline underline-offset-2 hover:text-plum-900 transition-colors"
                >
                  {showDetail ? 'Ocultar detalle' : 'Ver detalle por empleado'}
                </button>
                {showDetail && <EmpDetailTable employees={aggregatedEmployees} />}
              </div>
            )}
          </>
        ) : (
          /* ── Single-month view ── */
          <>
            <table className="w-full">
              <tbody>
                <tr className="bg-plum-50">
                  <td colSpan={3} className="py-1.5 px-0 text-xs font-bold text-plum-700 uppercase tracking-wider">
                    PRODUCTIVIDAD OPERATIVA
                  </td>
                </tr>
                <PLRow label="Costo Operativo Teórico" amount={totals.costoTeorico} indent />
                <PLRow label="Costo Operativo Real" amount={totals.costoReal} indent />
                <PLRow
                  label="GAP (Real − Teórico)"
                  amount={totals.gap}
                  bold
                  highlight={totals.gap <= 0 ? 'green' : 'red'}
                />
                <tr className="border-b last:border-0">
                  <td className="py-2 text-sm font-semibold text-plum-800">% Productividad</td>
                  <td className="py-2 text-sm text-right pl-6">
                    <ProductividadBadge pct={totals.productividad} />
                  </td>
                  <td className="py-2 pl-4 w-14" />
                </tr>
              </tbody>
            </table>

            {/* Employee breakdown */}
            {aggregatedEmployees.length > 0 && (
              <div className="px-4 mt-3">
                <button
                  onClick={() => setShowDetail((v) => !v)}
                  className="text-xs text-plum-700 underline underline-offset-2 hover:text-plum-900 transition-colors"
                >
                  {showDetail ? 'Ocultar detalle' : 'Ver detalle por empleado'}
                </button>
                {showDetail && <EmpDetailTable employees={aggregatedEmployees} />}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function EmpDetailTable({ employees }: { employees: EmpMonthDetail[] }) {
  return (
    <div className="mt-3 rounded-lg border overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Empleado</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hs netas</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Tarifa/h</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Costo teórico</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((ed) => (
            <tr key={ed.name} className="border-b last:border-0 hover:bg-gray-50/50">
              <td className="px-3 py-2 text-gray-700">{ed.name}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{ed.horasNetas.toFixed(1)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-600">{fmtC(ed.tarifa)}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium text-plum-800">{fmtC(ed.costoTeorico)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Finanzas() {
  const { profile, permissions } = useAuth()

  // Use permissions from roles table; fall back to role-name check while loading
  const showCaja = permissions !== null
    ? permissions.caja === true
    : ['owner', 'partner_admin', 'therapist'].includes(profile?.role ?? '')

  const showPL = permissions !== null
    ? permissions.finanzas === true
    : ['owner', 'partner_admin'].includes(profile?.role ?? '')

  const [activeTab, setActiveTab] = useState<Tab>('caja')

  // Once permissions resolve, land on the first visible tab
  useEffect(() => {
    if (permissions !== null) {
      if (!showCaja && showPL) setActiveTab('pl')
    }
  }, [permissions]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibleTabs = [
    { key: 'caja' as Tab, label: 'Caja',          show: showCaja },
    { key: 'pl'   as Tab, label: 'P&L y Reportes', show: showPL  },
  ].filter((t) => t.show)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-plum-800">Finanzas</h1>
        <p className="text-muted-foreground text-sm mt-1">Gestión financiera del centro</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-gray-200">
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              activeTab === t.key
                ? 'border-plum-800 text-plum-800'
                : 'border-transparent text-muted-foreground hover:text-plum-800',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'caja' && showCaja && <TabCaja />}
      {activeTab === 'pl'   && showPL   && <TabPL />}
    </div>
  )
}

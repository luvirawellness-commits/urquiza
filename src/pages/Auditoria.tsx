import { Fragment, useState } from 'react'
import { getArgentinaDateString } from '../utils/dateUtils'
import { Loader2, ScrollText, FileDown } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useTenantId } from '@/contexts/AuthContext'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn, exportToExcel } from '@/lib/utils'

const PAGE_SIZE = 50

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700',
  UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700',
  LOGIN: 'bg-gray-100 text-gray-600',
  LOGOUT: 'bg-gray-100 text-gray-600',
  VIEW: 'bg-slate-100 text-slate-600',
}

const MODULE_COLORS: Record<string, string> = {
  auth: 'bg-slate-100 text-slate-700',
  clientes: 'bg-purple-100 text-purple-700',
  agenda: 'bg-blue-100 text-blue-700',
  finanzas: 'bg-green-100 text-green-700',
  membresias: 'bg-amber-100 text-amber-700',
  compras: 'bg-orange-100 text-orange-700',
}

function formatDateTime(ts: string): string {
  const d = new Date(ts)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

type AuditLogRow = {
  id: string
  user_id?: string | null
  user_name?: string | null
  action: string
  module: string
  entity_type?: string | null
  entity_id?: string | null
  entity_name?: string | null
  old_value?: Record<string, unknown> | null
  new_value?: Record<string, unknown> | null
  created_at: string
}

export default function Auditoria() {
  const tenantId = useTenantId()

  const [fromDate, setFromDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return getArgentinaDateString(d)
  })
  const [toDate, setToDate] = useState(() => getArgentinaDateString())
  const [moduleFilter, setModuleFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [userFilter, setUserFilter] = useState('')
  const [page, setPage] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function resetPage() { setPage(0) }

  const { data: usersData = [] } = useQuery({
    queryKey: ['admin-users', tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, full_name').order('full_name')
      if (error) throw error
      return data as { id: string; full_name: string }[]
    },
    enabled: !!tenantId,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', tenantId, fromDate, toDate, moduleFilter, actionFilter, userFilter, page],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' })
        .eq('tenant_id', tenantId)
        .gte('created_at', `${fromDate}T00:00:00`)
        .lte('created_at', `${toDate}T23:59:59`)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

      if (moduleFilter) query = query.eq('module', moduleFilter)
      if (actionFilter) query = query.eq('action', actionFilter)
      if (userFilter) query = query.eq('user_id', userFilter)

      const { data: rows, count, error } = await query
      if (error) throw error
      return { rows: (rows ?? []) as AuditLogRow[], count: count ?? 0 }
    },
    enabled: !!tenantId,
  })

  const rows = data?.rows ?? []
  const totalCount = data?.count ?? 0
  const pageCount = Math.ceil(totalCount / PAGE_SIZE)

  const selectCls = 'border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none w-full h-8'

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Auditoría</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro de acciones del sistema</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            exportToExcel(
              rows.map((r) => ({
                'Fecha y hora': r.created_at,
                'Usuario': r.user_name ?? '',
                'Acción': r.action,
                'Módulo': r.module,
                'Detalle': r.entity_name ?? '',
              })),
              `auditoria-${fromDate}-${toDate}.xlsx`,
              'Auditoría',
            )
          }}
          disabled={rows.length === 0}
        >
          <FileDown className="w-4 h-4 mr-1.5" />
          Exportar Excel
        </Button>
      </div>

      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Desde</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); resetPage() }}
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none w-full h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Hasta</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); resetPage() }}
                  className="border border-input rounded-md px-2 py-1.5 text-sm bg-background focus:outline-none w-full h-8"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Módulo</label>
                <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); resetPage() }} className={selectCls}>
                  <option value="">Todos</option>
                  <option value="clientes">Clientes</option>
                  <option value="agenda">Agenda</option>
                  <option value="finanzas">Finanzas</option>
                  <option value="membresias">Membresías</option>
                  <option value="compras">Compras</option>
                  <option value="auth">Auth</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Acción</label>
                <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); resetPage() }} className={selectCls}>
                  <option value="">Todas</option>
                  <option value="CREATE">Crear</option>
                  <option value="UPDATE">Actualizar</option>
                  <option value="DELETE">Eliminar</option>
                  <option value="LOGIN">Login</option>
                  <option value="LOGOUT">Logout</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Usuario</label>
                <select value={userFilter} onChange={(e) => { setUserFilter(e.target.value); resetPage() }} className={selectCls}>
                  <option value="">Todos</option>
                  {usersData.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {isLoading ? (
              <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-plum-800" /></div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5 whitespace-nowrap">Fecha y hora</th>
                    <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Usuario</th>
                    <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Acción</th>
                    <th className="text-center text-xs text-muted-foreground font-medium px-4 py-2.5">Módulo</th>
                    <th className="text-left text-xs text-muted-foreground font-medium px-4 py-2.5">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <Fragment key={row.id}>
                      <tr
                        className="border-b hover:bg-gray-50/50 cursor-pointer"
                        onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                      >
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {formatDateTime(row.created_at)}
                        </td>
                        <td className="px-4 py-3 text-sm text-plum-800">{row.user_name ?? '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', ACTION_COLORS[row.action] ?? 'bg-gray-100 text-gray-600')}>
                            {row.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', MODULE_COLORS[row.module] ?? 'bg-gray-100 text-gray-600')}>
                            {row.module}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 max-w-xs truncate">{row.entity_name ?? '—'}</td>
                      </tr>
                      {expandedId === row.id && (
                        <tr className="border-b bg-gray-50/70">
                          <td colSpan={5} className="px-6 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              {row.entity_type && (
                                <div className="md:col-span-2">
                                  <span className="font-medium text-muted-foreground">Entidad: </span>
                                  <span className="text-gray-700">{row.entity_type}{row.entity_id ? ` · ${row.entity_id}` : ''}</span>
                                </div>
                              )}
                              {row.old_value && (
                                <div>
                                  <p className="font-medium text-muted-foreground mb-1">Valor anterior:</p>
                                  <pre className="bg-white border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                                    {JSON.stringify(row.old_value, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {row.new_value && (
                                <div>
                                  <p className="font-medium text-muted-foreground mb-1">Valor nuevo:</p>
                                  <pre className="bg-white border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                                    {JSON.stringify(row.new_value, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {!row.old_value && !row.new_value && !row.entity_type && (
                                <p className="text-muted-foreground md:col-span-2">Sin detalles adicionales.</p>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="text-center py-12 text-muted-foreground">
                          <ScrollText className="w-10 h-10 mx-auto mb-2 opacity-30" />
                          <p className="text-sm">Sin registros de auditoría para este período</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {pageCount > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {totalCount} registros · Página {page + 1} de {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                disabled={page >= pageCount - 1}
              >
                Siguiente
              </Button>
            </div>
          </div>
        )}
        {totalCount > 0 && pageCount <= 1 && (
          <p className="text-xs text-muted-foreground text-right">{totalCount} registro{totalCount !== 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  )
}

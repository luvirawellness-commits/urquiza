import { useState } from 'react'
import { TrendingUp, TrendingDown, DollarSign, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTransactions } from '@/hooks/useFinanzas'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency, formatDate, MONTHS_ES } from '@/lib/utils'

function SummaryCard({
  title, amount, icon: Icon, color, bgColor,
}: {
  title: string; amount: number; icon: React.ElementType; color: string; bgColor: string
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${bgColor}`}>
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${amount >= 0 ? 'text-plum-800' : 'text-red-600'}`}>
          {formatCurrency(Math.abs(amount))}
        </div>
      </CardContent>
    </Card>
  )
}

export default function Finanzas() {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const monthStr = `${year}-${String(month).padStart(2, '0')}`
  const { data: transactions, isLoading } = useTransactions(monthStr)

  const income = transactions?.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0) ?? 0
  const expenses = transactions?.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0) ?? 0
  const balance = income - expenses

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-plum-800">Finanzas</h1>
          <p className="text-muted-foreground text-sm mt-1">Resumen de ingresos y egresos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prevMonth} className="w-8 h-8">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium text-plum-800 min-w-32 text-center">
            {MONTHS_ES[month - 1]} {year}
          </span>
          <Button variant="outline" size="icon" onClick={nextMonth} className="w-8 h-8">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard title="Ingresos" amount={income} icon={TrendingUp} color="text-green-600" bgColor="bg-green-50" />
        <SummaryCard title="Egresos" amount={expenses} icon={TrendingDown} color="text-red-600" bgColor="bg-red-50" />
        <SummaryCard title="Balance" amount={balance} icon={DollarSign} color={balance >= 0 ? 'text-plum-800' : 'text-red-600'} bgColor="bg-plum-50" />
      </div>

      {/* P&L bar */}
      {(income > 0 || expenses > 0) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">Ingresos vs. Egresos</span>
              <span className={`font-semibold ${balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {balance >= 0 ? '+' : ''}{formatCurrency(balance)}
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-plum-800 to-gold-500 rounded-full transition-all duration-500"
                style={{ width: income > 0 ? `${Math.min((income / Math.max(income, expenses)) * 100, 100)}%` : '0%' }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>0</span>
              <span>{formatCurrency(Math.max(income, expenses))}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transactions list */}
      <div>
        <h2 className="text-lg font-semibold text-plum-800 mb-3">
          Movimientos ({transactions?.length ?? 0})
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-plum-800" />
          </div>
        ) : transactions?.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-xl">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Sin movimientos este mes</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions?.map((tx) => (
              <Card key={tx.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                      tx.type === 'income' ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      {tx.type === 'income'
                        ? <TrendingUp className="w-4 h-4 text-green-600" />
                        : <TrendingDown className="w-4 h-4 text-red-600" />
                      }
                    </div>
                    <div>
                      <p className="text-sm font-medium text-plum-800">{tx.description}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{formatDate(tx.date)}</span>
                        <Badge variant="outline" className="text-xs">{tx.category}</Badge>
                      </div>
                    </div>
                  </div>
                  <span className={`font-semibold text-sm ${tx.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {tx.type === 'income' ? '+' : '-'}{formatCurrency(tx.amount)}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

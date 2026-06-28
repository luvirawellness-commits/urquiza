import type { PaymentSettings } from '@/hooks/useTreasury'

export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

export function isHoliday(date: Date, holidays: string[]): boolean {
  const iso = date.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  return holidays.includes(iso)
}

export function addBusinessDays(startDate: Date, days: number, holidays: string[]): Date {
  const result = new Date(startDate)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    if (!isWeekend(result) && !isHoliday(result, holidays)) {
      added++
    }
  }
  return result
}

export function addCalendarDays(startDate: Date, days: number): Date {
  const result = new Date(startDate)
  result.setDate(result.getDate() + days)
  return result
}

// Payment methods that settle same-day (no lag)
const SAME_DAY_METHODS = new Set(['cash', 'transfer'])

// Map transaction payment_method to settlement config key
function resolveMethod(
  paymentMethod: string,
): 'debit' | 'credit' | 'qr' | null {
  switch (paymentMethod) {
    case 'debit':  return 'debit'
    case 'credit': return 'credit'
    case 'qr':
    case 'mp':     return 'qr'
    default:       return null
  }
}

export function getSettlementDate(
  transactionDate: Date,
  paymentMethod: string,
  settings: PaymentSettings,
  holidays: string[],
): Date {
  if (SAME_DAY_METHODS.has(paymentMethod)) {
    return new Date(transactionDate)
  }

  const method = resolveMethod(paymentMethod)
  if (!method) return new Date(transactionDate)

  const days = settings[`${method}_settlement_days` as keyof PaymentSettings] as number
  const type = settings[`${method}_settlement_type` as keyof PaymentSettings] as 'corridos' | 'habiles'

  if (days === 0) return new Date(transactionDate)

  return type === 'habiles'
    ? addBusinessDays(transactionDate, days, holidays)
    : addCalendarDays(transactionDate, days)
}

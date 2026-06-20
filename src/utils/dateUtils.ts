/**
 * Returns today's date as a YYYY-MM-DD string in Argentina time (America/Argentina/Buenos_Aires, UTC-3).
 * Use this instead of new Date().toISOString().split('T')[0], which returns the UTC date and
 * will give tomorrow's date for any event that happens after 21:00 ART (= 00:00 UTC next day).
 */
export function getArgentinaDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
  })
}

/**
 * Returns the full ISO 8601 timestamp (UTC). Use this for storing exact moments in time
 * (e.g. created_at, scheduled_at). Only DATE-ONLY fields need getArgentinaDateString.
 */
export function getArgentinaTimestamp(date: Date = new Date()): string {
  return date.toISOString()
}

/**
 * Returns the last calendar day of a month as a YYYY-MM-DD string.
 * Timezone-independent: uses local day arithmetic instead of toISOString(),
 * avoiding the UTC-offset ambiguity present in new Date(y, m, 0).toISOString().split('T')[0].
 * @param year  Full year (e.g. 2026)
 * @param month 1-based month (1 = January, 12 = December)
 */
export function getArgentinaMonthEnd(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

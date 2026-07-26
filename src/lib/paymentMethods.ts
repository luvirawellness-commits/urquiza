// Canonical payment-method list, consolidated from what was previously four
// independent copies (Agenda.tsx, VenderMembresiaModal.tsx, Productos.tsx —
// all identical — plus GiftCards.tsx, which also had 'other'). 'other' is
// kept here rather than dropped: it's already saved on real transaction rows
// via the gift card flow.
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'qr', label: 'QR' },
  { value: 'mp', label: 'Mercado Pago' },
  { value: 'debit', label: 'Débito' },
  { value: 'credit', label: 'Crédito' },
  { value: 'other', label: 'Otro' },
] as const

export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]['value']

// Methods that trigger automatic ARCA invoicing (no user prompt). Cash and
// 'other' are deliberately excluded — those always ask before issuing.
export const ELECTRONIC_PAYMENT_METHODS = ['transfer', 'qr', 'mp', 'debit', 'credit'] as const

export function isElectronicPayment(method: string): boolean {
  return (ELECTRONIC_PAYMENT_METHODS as readonly string[]).includes(method)
}

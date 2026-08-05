// Argentine mobile number convention used across this app for stored phone
// numbers (clients.phone, client_profiles.phone): exactly 10 digits, area
// code + number, no leading 0 trunk prefix, no 15 mobile prefix, no 54
// country code — e.g. "1123456789" for an 11 (Buenos Aires) number. This is
// the format formatArgentinaPhone() in whatsapp-reminders assumes when it
// reconstructs the WhatsApp E.164 address (+549...) from a stored number.

export function validateArgentinePhone(phone: string): string | null {
  const digits = phone.trim()

  if (!/^\d{10}$/.test(digits)) {
    return 'El teléfono debe tener exactamente 10 dígitos, sin espacios, guiones ni símbolos. Ej: 1123456789'
  }
  if (digits.startsWith('15')) {
    return 'No incluyas el prefijo "15". Ej: 1123456789'
  }
  if (digits.startsWith('54')) {
    return 'No incluyas el código de país "54". Ej: 1123456789'
  }

  return null
}

export const DEFAULT_REMINDER_MESSAGE =
  'Hola {nombre}, recordá que tenés una cita en MASAJES LUVIRA WELLNESS el día {fecha} a las {hora}.\n\n' +
  'Servicio: {servicio}\n' +
  'Profesional: {profesional}\n' +
  'Dirección: {direccion}\n' +
  'Cómo llegar: {maps_url}'

export const DEFAULT_REVIEW_MESSAGE =
  '¡Hola! 😊 ¿Cómo estás? Queremos saber cómo te sentís estos días luego del masaje en LUVIRA.\n\n' +
  'Si tu experiencia cumplió con tus expectativas, te invitamos a dejarnos una reseña.\n\n' +
  'https://g.page/r/Ceg8aie6OAmvEBE/review\n\n' +
  'Tu opinión es una referencia muy valiosa para quienes están buscando un espacio profesional donde recibir un masaje de calidad.\n\n' +
  '¡Gracias por confiar en nosotros! 🤍'

export function applyWhatsAppTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match)
}

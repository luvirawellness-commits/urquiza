export type AppModule =
  | 'dashboard'
  | 'agenda'
  | 'clientes'
  | 'caja'
  | 'finanzas'
  | 'membresias'
  | 'gift_cards'
  | 'facturacion'
  | 'rrhh'
  | 'productos'
  | 'configuracion'
  | 'usuarios'

export type AccessLevel = 'full' | 'readonly' | 'none'

export interface ModulePermission {
  access: AccessLevel
  ownDataOnly?: boolean
}

export const ROLE_PERMISSIONS: Record<string, Record<AppModule, ModulePermission>> = {
  owner: {
    dashboard:     { access: 'full' },
    agenda:        { access: 'full' },
    clientes:      { access: 'full' },
    caja:          { access: 'full' },
    finanzas:      { access: 'full' },
    membresias:    { access: 'full' },
    gift_cards:    { access: 'full' },
    facturacion:   { access: 'full' },
    rrhh:          { access: 'full' },
    productos:     { access: 'full' },
    configuracion: { access: 'full' },
    usuarios:      { access: 'full' },
  },
  partner_admin: {
    dashboard:     { access: 'full' },
    agenda:        { access: 'full' },
    clientes:      { access: 'full' },
    caja:          { access: 'full' },
    finanzas:      { access: 'full' },
    membresias:    { access: 'full' },
    gift_cards:    { access: 'full' },
    facturacion:   { access: 'full' },
    rrhh:          { access: 'full' },
    productos:     { access: 'full' },
    configuracion: { access: 'none' },
    usuarios:      { access: 'full' },
  },
  receptionist: {
    dashboard:     { access: 'full' },
    agenda:        { access: 'full' },
    clientes:      { access: 'full' },
    caja:          { access: 'full' },
    finanzas:      { access: 'none' },
    membresias:    { access: 'full' },
    gift_cards:    { access: 'full' },
    facturacion:   { access: 'full' },
    rrhh:          { access: 'none' },
    productos:     { access: 'full' },
    configuracion: { access: 'none' },
    usuarios:      { access: 'none' },
  },
  therapist: {
    dashboard:     { access: 'none' },
    agenda:        { access: 'readonly', ownDataOnly: true },
    clientes:      { access: 'none' },
    caja:          { access: 'none' },
    finanzas:      { access: 'none' },
    membresias:    { access: 'none' },
    gift_cards:    { access: 'none' },
    facturacion:   { access: 'none' },
    rrhh:          { access: 'none' },
    productos:     { access: 'none' },
    configuracion: { access: 'none' },
    usuarios:      { access: 'none' },
  },
}

export function canAccess(role: string, module: AppModule): boolean {
  const perms = ROLE_PERMISSIONS[role]
  if (!perms) return false
  return perms[module]?.access !== 'none'
}

export function getAccessLevel(role: string, module: AppModule): AccessLevel {
  return ROLE_PERMISSIONS[role]?.[module]?.access ?? 'none'
}

export function isOwnDataOnly(role: string, module: AppModule): boolean {
  return ROLE_PERMISSIONS[role]?.[module]?.ownDataOnly ?? false
}

export function getDefaultRouteForRole(role: string): string {
  const checks: [AppModule, string][] = [
    ['dashboard', '/dashboard'],
    ['agenda', '/agenda'],
    ['clientes', '/clientes'],
    ['caja', '/finanzas'],
  ]
  for (const [mod, path] of checks) {
    if (canAccess(role, mod)) return path
  }
  return '/dashboard'
}

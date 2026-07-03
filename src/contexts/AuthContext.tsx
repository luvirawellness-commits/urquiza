import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { UserProfile, Tenant } from '@/types'

const TENANT_KEY = 'luvira_current_tenant'
const LAST_ACTIVITY_KEY = 'luvira_last_activity'
const INACTIVITY_TIMEOUT = 8 * 60 * 60 * 1000 // 8 hours

const ALL_PERM_KEYS = [
  'dashboard', 'agenda', 'clientes', 'caja', 'finanzas',
  'gift_cards', 'productos', 'compras', 'rrhh', 'configuracion',
]

interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  currentTenantId: string
  currentTenant: Tenant | null
  availableTenants: Tenant[]
  permissions: Record<string, boolean> | null
  switchTenant: (tenantId: string) => Promise<void>
  refreshTenants: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [availableTenants, setAvailableTenants] = useState<Tenant[]>([])
  const [currentTenantId, setCurrentTenantId] = useState<string>('')
  const [permissions, setPermissions] = useState<Record<string, boolean> | null>(null)

  const currentTenant = availableTenants.find((t) => t.id === currentTenantId) ?? null

  async function fetchPermissionsForRole(
    roleName: string,
    tenantId: string,
  ): Promise<Record<string, boolean> | null> {
    if (roleName === 'owner' || roleName === 'super_admin') {
      return Object.fromEntries(ALL_PERM_KEYS.map((k) => [k, true]))
    }
    if (!tenantId) return null

    const { data: roleRows } = await supabase
      .from('roles')
      .select('permissions, tenant_id')
      .eq('name', roleName)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)

    if (!roleRows?.length) return null
    // Prefer tenant-specific row over system (null tenant_id) row
    const row =
      roleRows.find((r) => r.tenant_id === tenantId) ??
      roleRows.find((r) => r.tenant_id === null)
    return (row?.permissions as Record<string, boolean>) ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchProfileAndTenants(userId: string, userEmail?: string, appMetadata?: Record<string, any>) {
    // ── 1. Profile ──────────────────────────────────────────────────────────
    // maybeSingle() returns null (not 406) when RLS hides the row or it doesn't exist yet
    const { data: profileData } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolvedProfile: any = profileData

    // User exists in auth but not in public.users yet — build a stub from auth data
    if (!resolvedProfile) {
      resolvedProfile = {
        id: userId,
        email: userEmail ?? '',
        full_name: userEmail ?? '',
        role: 'therapist',
        tenant_id: null,
        default_tenant_id: null,
        color_hex: '#7C3AED',
        active: true,
      }
    }

    // Fall back to email if full_name is blank
    if (!resolvedProfile.full_name && userEmail) {
      resolvedProfile = { ...resolvedProfile, full_name: userEmail }
    }

    // app_metadata.role takes precedence over the users table for super_admin.
    // This lets us grant super_admin via Supabase auth without touching the users table.
    const appRole = appMetadata?.role as string | undefined
    if (appRole === 'super_admin') {
      resolvedProfile = { ...resolvedProfile, role: 'super_admin' }
    }

    setProfile(resolvedProfile as UserProfile)

    // ── 2. Tenants via user_tenants ─────────────────────────────────────────
    // ISSUE 1: use aliased join so nested data comes back as `tenant`, not `tenants`
    const { data: userTenants } = await supabase
      .from('user_tenants')
      .select(`
        tenant_id,
        role,
        active,
        tenant:tenants (
          id,
          name,
          slug,
          address,
          phone,
          active,
          trial_ends_at,
          caja_fondo_fijo
        )
      `)
      .eq('user_id', userId)
      .eq('active', true)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tenants: Tenant[] = (userTenants ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((ut: any) => ut.tenant)
      .filter(Boolean) as Tenant[]

    // ── 3. Fallback: user_tenants not seeded → read tenant from users row ───
    if (tenants.length === 0) {
      const { data: profileWithTenant } = await supabase
        .from('users')
        .select('*, tenant:tenants(*)')
        .eq('id', userId)
        .maybeSingle()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fallback = (profileWithTenant as any)?.tenant
      if (fallback) tenants = [fallback as Tenant]
    }

    console.log('[DEBUG] user_tenants raw data:', JSON.stringify(userTenants))
    console.log('[DEBUG] availableTenants after mapping:', tenants.map((t) => ({ id: t.id, name: t.name })))

    setAvailableTenants(tenants)

    // ── 4. Resolve active tenant ID (sync, before any setState) ─────────────
    const stored = localStorage.getItem(TENANT_KEY)
    const defaultId = resolvedProfile?.default_tenant_id ?? resolvedProfile?.tenant_id
    let resolvedTenantId = ''

    if (stored && tenants.some((t) => t.id === stored)) {
      resolvedTenantId = stored
    } else if (defaultId && tenants.some((t) => t.id === defaultId)) {
      resolvedTenantId = defaultId
      localStorage.setItem(TENANT_KEY, defaultId)
    } else if (tenants.length > 0) {
      resolvedTenantId = tenants[0].id
      localStorage.setItem(TENANT_KEY, tenants[0].id)
    } else if (defaultId) {
      // user_tenants not seeded yet but we know the tenant from users.tenant_id
      resolvedTenantId = defaultId
      localStorage.setItem(TENANT_KEY, defaultId)
    }

    if (resolvedTenantId) setCurrentTenantId(resolvedTenantId)

    // ── 5. Permissions ───────────────────────────────────────────────────────
    // super_admin gets all permissions immediately, regardless of tenant context
    if (resolvedProfile?.role === 'super_admin') {
      setPermissions(Object.fromEntries(ALL_PERM_KEYS.map((k) => [k, true])))
    } else if (resolvedProfile?.role && resolvedTenantId) {
      const perms = await fetchPermissionsForRole(resolvedProfile.role, resolvedTenantId)
      if (perms) setPermissions(perms)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfileAndTenants(session.user.id, session.user.email ?? undefined, session.user.app_metadata)
          .finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfileAndTenants(session.user.id, session.user.email ?? undefined, session.user.app_metadata)
      } else {
        setProfile(null)
        setAvailableTenants([])
        setCurrentTenantId('')
        setPermissions(null)
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Inactivity timeout (8 h) ─────────────────────────────────────────────
  useEffect(() => {
    if (!user) return

    let lastThrottle = 0

    function updateActivity() {
      const now = Date.now()
      if (now - lastThrottle >= 60_000) {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
        lastThrottle = now
      }
    }

    async function handleInactivity() {
      sessionStorage.setItem('luvira_session_expired', 'true')
      localStorage.removeItem(TENANT_KEY)
      localStorage.removeItem(LAST_ACTIVITY_KEY)
      await supabase.auth.signOut()
      // onAuthStateChange handles clearing React state
    }

    function checkInactivity() {
      const ts = localStorage.getItem(LAST_ACTIVITY_KEY)
      if (ts && Date.now() - Number(ts) > INACTIVITY_TIMEOUT) {
        void handleInactivity()
      }
    }

    // Initial check in case the app was idle before this mount
    checkInactivity()
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()))
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll'] as const
    events.forEach((ev) => window.addEventListener(ev, updateActivity, { passive: true }))

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') checkInactivity()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', checkInactivity)

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, updateActivity))
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', checkInactivity)
      localStorage.removeItem(LAST_ACTIVITY_KEY)
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function switchTenant(tenantId: string) {
    setCurrentTenantId(tenantId)
    localStorage.setItem(TENANT_KEY, tenantId)
    queryClient.invalidateQueries()

    // Re-fetch permissions for the new tenant context
    if (profile?.role) {
      const perms = await fetchPermissionsForRole(profile.role, tenantId)
      setPermissions(perms)
    }
  }

  async function refreshTenants() {
    if (!user) return
    const { data: userTenants, error } = await supabase
      .from('user_tenants')
      .select(`
        tenant_id,
        role,
        active,
        tenant:tenants (
          id, name, slug, address, phone, active, trial_ends_at, caja_fondo_fijo
        )
      `)
      .eq('user_id', user.id)
      .eq('active', true)

    if (error) {
      console.error('[refreshTenants] fetch failed, keeping previous availableTenants:', error)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh: Tenant[] = ((userTenants ?? []) as any[])
      .map((ut) => ut.tenant)
      .filter(Boolean) as Tenant[]

    console.log('[refreshTenants] fresh tenant data:', fresh.map((t) => ({ id: t.id, caja_fondo_fijo: t.caja_fondo_fijo })))

    if (fresh.length > 0) {
      setAvailableTenants(fresh)
    } else {
      console.warn('[refreshTenants] fetch returned no tenants, keeping previous availableTenants')
    }

    // Other screens (Configuración → Admin, Super Admin) cache tenant rows via
    // React Query; invalidate those too so they don't show a stale value if the
    // user navigates there without a full page reload.
    queryClient.invalidateQueries({ queryKey: ['tenants'] })
    queryClient.invalidateQueries({ queryKey: ['sa-tenants'] })
  }

  async function signIn(email: string, password: string) {
    const { data: authData, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && authData.user) {
      supabase
        .from('users')
        .select('tenant_id, default_tenant_id, full_name')
        .eq('id', authData.user.id)
        .maybeSingle()
        .then(({ data: userRow }) => {
          const tid = userRow?.default_tenant_id ?? userRow?.tenant_id
          if (tid) {
            supabase.from('audit_logs').insert({
              tenant_id: tid,
              user_id: authData.user!.id,
              user_name: userRow?.full_name ?? email,
              action: 'LOGIN',
              module: 'auth',
            }).then(() => {})
          }
        })
    }
    return { error: error as Error | null }
  }

  async function signOut() {
    if (user && currentTenantId) {
      supabase.from('audit_logs').insert({
        tenant_id: currentTenantId,
        user_id: user.id,
        user_name: profile?.full_name ?? '',
        action: 'LOGOUT',
        module: 'auth',
      }).then(() => {})
    }
    localStorage.removeItem(TENANT_KEY)
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{
      user, session, profile, loading,
      currentTenantId, currentTenant, availableTenants,
      permissions,
      switchTenant, refreshTenants,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function useTenantId() {
  return useAuth().currentTenantId
}

export function usePermissions() {
  return useAuth().permissions
}

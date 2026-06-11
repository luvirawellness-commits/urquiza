import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { UserProfile, Tenant } from '@/types'

const TENANT_KEY = 'luvira_current_tenant'

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
    if (roleName === 'owner') {
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

  async function fetchProfileAndTenants(userId: string, userEmail?: string) {
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
          active
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
    if (resolvedProfile?.role && resolvedTenantId) {
      const perms = await fetchPermissionsForRole(resolvedProfile.role, resolvedTenantId)
      if (perms) setPermissions(perms)
    }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfileAndTenants(session.user.id, session.user.email ?? undefined)
          .finally(() => setLoading(false))
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfileAndTenants(session.user.id, session.user.email ?? undefined)
      } else {
        setProfile(null)
        setAvailableTenants([])
        setCurrentTenantId('')
        setPermissions(null)
      }
    })

    return () => subscription.unsubscribe()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      switchTenant, signIn, signOut,
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

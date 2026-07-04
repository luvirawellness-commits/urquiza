import { useState, Fragment } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Eye, EyeOff, Plus, Trash2, Loader2, Check, ChevronRight, ChevronLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4

type ServiceItem = { tempId: string; name: string; price_60: number; price_90: number }

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_SERVICES: ServiceItem[] = [
  { tempId: 's1', name: 'Masaje Relajante',         price_60: 0, price_90: 0 },
  { tempId: 's2', name: 'Masaje Descontracturante',  price_60: 0, price_90: 0 },
  { tempId: 's3', name: 'Masaje a Cuatro Manos',     price_60: 0, price_90: 0 },
  { tempId: 's4', name: 'Masaje Circulatorio',       price_60: 0, price_90: 0 },
  { tempId: 's5', name: 'Drenaje Linfático',         price_60: 0, price_90: 0 },
  { tempId: 's6', name: 'Masaje Craneofacial',       price_60: 0, price_90: 0 },
]

const TIMEZONES = [
  { value: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires (GMT-3)' },
  { value: 'America/Argentina/Cordoba',      label: 'Córdoba (GMT-3)' },
  { value: 'America/Montevideo',             label: 'Montevideo (GMT-3)' },
  { value: 'America/Sao_Paulo',             label: 'São Paulo (GMT-3)' },
  { value: 'America/Santiago',              label: 'Santiago (GMT-4)' },
  { value: 'America/Lima',                  label: 'Lima (GMT-5)' },
  { value: 'America/Bogota',               label: 'Bogotá (GMT-5)' },
  { value: 'America/Mexico_City',           label: 'Ciudad de México (GMT-6)' },
]

const STEP_LABELS: Record<number, string> = {
  1: 'Tu cuenta',
  2: 'Tu local',
  3: 'Tus servicios',
  4: '¡Todo listo!',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// Maps the register-tenant Edge Function's (often English, Supabase-Auth-sourced)
// error text to a Spanish message the user can act on, and flags whether the
// email field specifically should be highlighted.
function mapRegistrationError(raw: string): { message: string; isEmailError: boolean } {
  const lower = raw.toLowerCase()
  if (lower.includes('unable to validate email') || lower.includes('invalid format')) {
    return {
      message: 'El email ingresado no es válido. Verificá que tenga el formato correcto (ej: nombre@dominio.com)',
      isEmailError: true,
    }
  }
  if (lower.includes('already registered') || lower.includes('already exists') || lower.includes('duplicate')) {
    return {
      message: 'Este email ya está registrado. Intentá iniciar sesión.',
      isEmailError: true,
    }
  }
  return {
    message: 'Ocurrió un error al registrar tu cuenta. Verificá los datos e intentá nuevamente.',
    isEmailError: false,
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Registro() {
  const navigate = useNavigate()

  // Step
  const [step, setStep] = useState<Step>(1)

  // Step 1 — Tu cuenta
  const [fullName,        setFullName]        = useState('')
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [tenantName,      setTenantName]      = useState('')
  const [showPwd,         setShowPwd]         = useState(false)
  const [showConfirmPwd,  setShowConfirmPwd]  = useState(false)

  // Step 2 — Tu local
  const [address,  setAddress]  = useState('')
  const [phone,    setPhone]    = useState('')
  const [timezone, setTimezone] = useState('America/Argentina/Buenos_Aires')
  const [slug,     setSlug]     = useState('')

  // Step 3 — Tus servicios
  const [services, setServices] = useState<ServiceItem[]>(DEFAULT_SERVICES)

  // UI
  const [error,      setError]      = useState('')
  const [emailError, setEmailError] = useState(false)
  const [loading,    setLoading]    = useState(false)

  // ── Slug sync from tenant name ──────────────────────────────────────────────
  function handleTenantNameChange(value: string) {
    setTenantName(value)
    setSlug(toSlug(value))
  }

  // ── Step navigation ─────────────────────────────────────────────────────────
  function goStep2() {
    if (!fullName.trim())                       return setError('El nombre completo es obligatorio.')
    if (!email.trim() || !isValidEmail(email))  return setError('Ingresá un email válido.')
    if (password.length < 8)                    return setError('La contraseña debe tener al menos 8 caracteres.')
    if (password !== confirmPassword)           return setError('Las contraseñas no coinciden.')
    if (!tenantName.trim())                     return setError('El nombre del centro es obligatorio.')
    setError('')
    setStep(2)
  }

  function goStep3() {
    if (!address.trim())       return setError('La dirección es obligatoria.')
    if (!phone.trim())         return setError('El teléfono es obligatorio.')
    if (!slug.trim())          return setError('El identificador (slug) es obligatorio.')
    if (!isValidSlug(slug))    return setError('El slug solo puede tener letras minúsculas, números y guiones (ej: mi-centro).')
    setError('')
    setStep(3)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  function applyRegistrationError(rawMessage: string) {
    const { message, isEmailError } = mapRegistrationError(rawMessage)
    setError(message)
    setEmailError(isEmailError)
    // The email field lives on step 1 — jump back there so the highlighted
    // field is actually visible when the error is about the email.
    if (isEmailError) setStep(1)
  }

  async function handleSubmit() {
    if (services.length === 0)               return setError('Agregá al menos un servicio.')
    if (services.some((s) => !s.name.trim())) return setError('Todos los servicios deben tener nombre.')
    setError('')
    setEmailError(false)
    setLoading(true)

    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-tenant`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({
            email:       email.trim(),
            password,
            full_name:   fullName.trim(),
            tenant_name: tenantName.trim(),
            slug:        slug.trim(),
            address:     address.trim(),
            phone:       phone.trim(),
            timezone,
            services:    services.map((s) => ({ name: s.name.trim(), price_60: s.price_60, price_90: s.price_90 })),
          }),
        },
      )

      const responseText = await res.text()
      console.log('[DEBUG] register-tenant status:', res.status)
      console.log('[DEBUG] register-tenant response:', responseText)

      if (!res.ok) {
        let rawMessage = responseText
        try {
          const parsed = JSON.parse(responseText)
          if (parsed?.error) rawMessage = parsed.error
        } catch {
          // Response wasn't JSON — fall back to the raw text as-is.
        }
        applyRegistrationError(rawMessage)
        return
      }

      const result = JSON.parse(responseText)
      if (!result.success) {
        applyRegistrationError(result.error || 'Error al crear la cuenta.')
        return
      }

      // Auto-login
      await supabase.auth.signInWithPassword({ email: email.trim(), password })
      setStep(4)
    } catch (e) {
      applyRegistrationError(e instanceof Error ? e.message : 'Error al crear la cuenta.')
    } finally {
      setLoading(false)
    }
  }

  // ── Service helpers ─────────────────────────────────────────────────────────
  function addService() {
    setServices((prev) => [
      ...prev,
      { tempId: `custom-${Date.now()}`, name: '', price_60: 0, price_90: 0 },
    ])
  }

  function removeService(tempId: string) {
    setServices((prev) => prev.filter((s) => s.tempId !== tempId))
  }

  function updateService(tempId: string, field: Exclude<keyof ServiceItem, 'tempId'>, value: string | number) {
    setServices((prev) => prev.map((s) => s.tempId === tempId ? { ...s, [field]: value } : s))
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-plum-800 flex items-center justify-center p-4 py-10">
      <div className="w-full max-w-lg">

        {/* Brand */}
        <div className="text-center mb-6">
          <img
            src="/icons/icon-192.png"
            alt="Luvira OS"
            className="w-14 h-14 mx-auto mb-3"
            style={{ borderRadius: '37%' }}
          />
          <h1 className="text-white text-xl font-semibold">Luvira OS</h1>
          <p className="text-plum-300 text-sm mt-0.5">Registrá tu centro de bienestar</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">

          {/* Progress indicator (steps 1–3) */}
          {step < 4 && (
            <div className="mb-6">
              <div className="flex items-center mb-3">
                {([1, 2, 3, 4] as Step[]).map((s, i) => (
                  <Fragment key={s}>
                    <div
                      className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                        s < step  ? 'bg-plum-700 text-white'
                        : s === step ? 'bg-plum-700 text-white ring-2 ring-plum-200 ring-offset-1'
                        : 'bg-gray-100 text-gray-400',
                      )}
                    >
                      {s < step ? <Check className="w-3.5 h-3.5" /> : s}
                    </div>
                    {i < 3 && (
                      <div className={cn('h-0.5 flex-1 mx-1.5', s < step ? 'bg-plum-700' : 'bg-gray-200')} />
                    )}
                  </Fragment>
                ))}
              </div>
              <div>
                <p className="text-base font-semibold text-plum-800">{STEP_LABELS[step]}</p>
                <p className="text-xs text-muted-foreground">Paso {step} de 4</p>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}

          {/* ── Step 1: Tu cuenta ─────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nombre completo *</Label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="María González"
                  autoComplete="name"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(false) }}
                  placeholder="tu@email.com"
                  autoComplete="email"
                  className={cn(emailError && 'border-red-500 focus-visible:ring-red-500')}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Contraseña * <span className="font-normal text-muted-foreground">(mín. 8 caracteres)</span></Label>
                <div className="relative">
                  <Input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Confirmar contraseña *</Label>
                <div className="relative">
                  <Input
                    type={showConfirmPwd ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showConfirmPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Nombre del centro / local *</Label>
                <Input
                  value={tenantName}
                  onChange={(e) => handleTenantNameChange(e.target.value)}
                  placeholder="Luvira Wellness"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <Button onClick={goStep2}>
                  Siguiente <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 2: Tu local ──────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Dirección *</Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Av. Corrientes 1234, CABA"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Teléfono / WhatsApp *</Label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+54 11 1234-5678"
                />
              </div>

              <div className="space-y-1.5">
                <Label>Zona horaria</Label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label>Identificador único *</Label>
                <Input
                  value={slug}
                  onChange={(e) =>
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '')
                        .replace(/--+/g, '-'),
                    )
                  }
                  placeholder="mi-centro-wellness"
                />
                <p className="text-xs text-muted-foreground">
                  Solo minúsculas, números y guiones. Se usa como identificador único en el sistema.
                </p>
              </div>

              <div className="pt-2 flex justify-between">
                <Button variant="outline" onClick={() => { setError(''); setStep(1) }}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
                </Button>
                <Button onClick={goStep3}>
                  Siguiente <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: Tus servicios ─────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  Los precios los podés completar después desde Configuración.
                </p>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-[1fr_90px_90px_32px] gap-2 px-0.5">
                <p className="text-xs font-medium text-muted-foreground">Servicio</p>
                <p className="text-xs font-medium text-muted-foreground">Precio 60min</p>
                <p className="text-xs font-medium text-muted-foreground">Precio 90min</p>
                <div />
              </div>

              {/* Service rows */}
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {services.map((s) => (
                  <div key={s.tempId} className="grid grid-cols-[1fr_90px_90px_32px] gap-2 items-center">
                    <Input
                      value={s.name}
                      onChange={(e) => updateService(s.tempId, 'name', e.target.value)}
                      placeholder="Nombre del servicio"
                      className="h-9 text-sm"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={s.price_60}
                      onChange={(e) => updateService(s.tempId, 'price_60', parseFloat(e.target.value) || 0)}
                      className="h-9 text-sm text-right"
                      placeholder="0"
                    />
                    <Input
                      type="number"
                      min={0}
                      value={s.price_90}
                      onChange={(e) => updateService(s.tempId, 'price_90', parseFloat(e.target.value) || 0)}
                      className="h-9 text-sm text-right"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => removeService(s.tempId)}
                      className="w-8 h-9 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={addService}
                className="flex items-center gap-1.5 text-sm text-plum-700 hover:text-plum-900 font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Agregar servicio
              </button>

              <div className="pt-2 flex justify-between">
                <Button variant="outline" onClick={() => { setError(''); setStep(2) }}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Atrás
                </Button>
                <Button onClick={handleSubmit} disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creando tu cuenta...
                    </>
                  ) : (
                    'Crear cuenta'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: ¡Todo listo! ──────────────────────────────────────── */}
          {step === 4 && (
            <div className="text-center space-y-5 py-4">
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-plum-800">¡Todo listo!</h2>
                <p className="text-sm text-gray-600 leading-relaxed max-w-xs mx-auto">
                  Tu cuenta fue creada con éxito. Tenés 7 días de prueba gratuita para explorar Luvira OS.
                </p>
              </div>
              <Button className="w-full" size="lg" onClick={() => navigate('/dashboard')}>
                Ir al sistema →
              </Button>
            </div>
          )}

          {/* Login link (steps 1–3 only) */}
          {step < 4 && (
            <p className="text-xs text-muted-foreground text-center mt-6">
              ¿Ya tenés cuenta?{' '}
              <Link to="/auth" className="text-plum-600 hover:underline font-medium">
                Iniciá sesión
              </Link>
            </p>
          )}
        </div>

        <p className="text-center text-plum-400 text-xs mt-6">
          © {new Date().getFullYear()} Luvira Wellness · Buenos Aires
        </p>
      </div>
    </div>
  )
}

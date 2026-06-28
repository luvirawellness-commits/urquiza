import { useState, useEffect, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { rateLimiter } from '@/lib/rateLimiter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react'

function formatTimeLeft(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function Auth() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [locked, setLocked] = useState(false)
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  // On mount: show session expiry notice + check existing lock
  useEffect(() => {
    if (sessionStorage.getItem('luvira_session_expired')) {
      sessionStorage.removeItem('luvira_session_expired')
      setSessionExpired(true)
    }

    const lockStatus = rateLimiter.isLocked()
    if (lockStatus.locked) {
      setLocked(true)
      const attempts = rateLimiter.getAttempts()
      if (attempts.lockedUntil) {
        setTimeLeft(attempts.lockedUntil - Date.now())
      }
      setError(
        `Demasiados intentos fallidos. Intentá de nuevo en ${lockStatus.remainingMinutes} minuto${lockStatus.remainingMinutes !== 1 ? 's' : ''}.`,
      )
    }
  }, [])

  // Countdown timer — ticks every second while locked
  useEffect(() => {
    if (!locked) return
    const interval = setInterval(() => {
      const attempts = rateLimiter.getAttempts()
      if (!attempts.lockedUntil) {
        setLocked(false)
        setTimeLeft(null)
        setError(null)
        return
      }
      const remaining = attempts.lockedUntil - Date.now()
      if (remaining <= 0) {
        rateLimiter.reset()
        setLocked(false)
        setTimeLeft(null)
        setError(null)
      } else {
        setTimeLeft(remaining)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [locked])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSessionExpired(false)

    const lockStatus = rateLimiter.isLocked()
    if (lockStatus.locked) {
      setError(
        `Demasiados intentos fallidos. Intentá de nuevo en ${lockStatus.remainingMinutes} minuto${lockStatus.remainingMinutes !== 1 ? 's' : ''}.`,
      )
      return
    }

    setError(null)
    setLoading(true)
    const { error: signInError } = await signIn(email, password)
    setLoading(false)

    if (signInError) {
      const result = rateLimiter.recordFailedAttempt()
      if (result.locked) {
        setLocked(true)
        const attempts = rateLimiter.getAttempts()
        if (attempts.lockedUntil) setTimeLeft(attempts.lockedUntil - Date.now())
        setError('Cuenta bloqueada por 15 minutos por demasiados intentos fallidos.')
      } else {
        setError(
          `Contraseña incorrecta. Te quedan ${result.remainingAttempts} intento${result.remainingAttempts !== 1 ? 's' : ''} antes de bloquearte.`,
        )
      }
    } else {
      rateLimiter.recordSuccessfulLogin()
      navigate('/dashboard')
    }
  }

  return (
    <div className="min-h-screen bg-plum-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img
            src="/icons/icon-192.png"
            alt="Luvira OS"
            className="w-16 h-16 mx-auto mb-4"
            style={{ borderRadius: '37%' }}
          />
          <h1 className="text-white text-2xl font-semibold">Luvira OS</h1>
          <p className="text-plum-300 text-sm mt-1">Sistema integral 360</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-plum-800 text-xl font-semibold mb-1">Iniciar sesión</h2>
          <p className="text-muted-foreground text-sm mb-6">Ingresá tu email y contraseña</p>

          {/* Session expiry notice */}
          {sessionExpired && (
            <div className="bg-blue-50 border border-blue-200 text-blue-700 text-sm rounded-lg px-4 py-3 mb-4">
              Tu sesión expiró por inactividad. Por favor iniciá sesión nuevamente.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={locked}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="pr-10"
                  disabled={locked}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {/*
               * TODO: Password strength indicator (for future "change password" flow)
               * Check: length >= 8, has uppercase, has number or special char.
               * Show: red "Contraseña débil" / yellow "Contraseña regular" / green "Contraseña segura"
               * Only render when user is on a change-password screen, not on login.
               */}
            </div>

            {error && (
              <div
                className={`border text-sm rounded-lg px-4 py-3 ${
                  locked
                    ? 'bg-amber-50 border-amber-200 text-amber-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                <div className="flex items-start gap-2">
                  {locked && <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  <div>
                    <p>{error}</p>
                    {locked && timeLeft !== null && (
                      <p className="font-mono font-bold text-lg mt-1 tracking-widest">
                        {formatTimeLeft(timeLeft)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading || locked}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Ingresando...
                </>
              ) : locked ? (
                <>
                  <Lock className="w-4 h-4 mr-2" />
                  Bloqueado
                </>
              ) : (
                'Ingresar'
              )}
            </Button>
          </form>

          {/* Registration link */}
          <p className="text-sm text-center mt-5 text-muted-foreground">
            ¿No tenés cuenta?{' '}
            <Link to="/registro" className="text-plum-600 hover:underline font-medium">
              Registrá tu centro gratis →
            </Link>
          </p>

          {/* Privacy notice */}
          <p className="text-xs text-muted-foreground text-center mt-4 leading-relaxed">
            Al iniciar sesión aceptás nuestros{' '}
            <span className="text-plum-600">Términos y Condiciones</span> y la{' '}
            <span className="text-plum-600">Política de Privacidad</span> de Luvira OS.
            <br />
            Los datos son procesados conforme a la Ley 25.326.
          </p>
        </div>

        <p className="text-center text-plum-400 text-xs mt-6">
          © {new Date().getFullYear()} Luvira OS · Buenos Aires
        </p>
      </div>
    </div>
  )
}

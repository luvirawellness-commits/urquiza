import { useState, useEffect } from 'react'
import { X, Smartphone } from 'lucide-react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const STORAGE_KEY  = 'pwa-install-dismissed'
const DISMISS_DAYS = 7

export function InstallPWABanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Don't show if dismissed within the last 7 days
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const daysSince = (Date.now() - new Date(stored).getTime()) / 86_400_000
      if (daysSince < DISMISS_DAYS) return
    }

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
  }, [])

  function handleDismiss() {
    setVisible(false)
    localStorage.setItem(STORAGE_KEY, new Date().toISOString())
  }

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setVisible(false)
    setDeferredPrompt(null)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div
        className="flex items-center gap-3 rounded-xl px-4 py-3 shadow-xl"
        style={{ backgroundColor: '#3D0E1A' }}
      >
        <Smartphone className="w-5 h-5 shrink-0 text-yellow-400 opacity-90" />
        <p className="flex-1 text-sm leading-tight text-white">
          <span className="font-semibold">Instalá Luvira OS</span>{' '}
          en tu celular para acceso rápido
        </p>
        <button
          onClick={handleInstall}
          className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ color: '#3D0E1A' }}
        >
          Instalar
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Cerrar"
          className="shrink-0 text-white/50 transition-colors hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

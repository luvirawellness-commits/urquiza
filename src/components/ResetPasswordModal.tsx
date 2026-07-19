import { useState } from 'react'
import { Loader2, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ResetPasswordModalProps {
  targetUser: { full_name?: string | null; email: string }
  onClose: () => void
}

export default function ResetPasswordModal({ targetUser, onClose }: ResetPasswordModalProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSendResetEmail() {
    setSending(true)
    setError(null)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(targetUser.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al enviar el email de recuperación')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Resetear contraseña de {targetUser.full_name || targetUser.email}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {sent ? (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2.5">
              Se envió el email de recuperación a {targetUser.email}
            </p>
          ) : (
            <div className="border rounded-lg p-3.5 space-y-2">
              <p className="text-sm font-medium text-plum-800">Enviar email de recuperación</p>
              <p className="text-xs text-muted-foreground">
                Le llegará un enlace a {targetUser.email} para que elija una nueva contraseña.
              </p>
              {error && <p className="text-xs text-red-600">{error}</p>}
              <Button
                size="sm"
                onClick={handleSendResetEmail}
                disabled={sending}
                className="bg-plum-800 hover:bg-plum-700 text-white"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
                Enviar email de recuperación
              </Button>
            </div>
          )}

          <div className="border rounded-lg p-3.5 space-y-1.5 opacity-70">
            <p className="text-sm font-medium text-gray-500">Establecer nueva contraseña</p>
            <p className="text-xs text-muted-foreground">
              Para cambiar la contraseña directamente, usá el panel de Supabase.
            </p>
          </div>

          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={onClose}>Cerrar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

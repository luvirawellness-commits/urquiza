import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  open: boolean
  onCancel: () => void
  onConfirm: (invoiceType: 'A' | 'B', receptorCuit?: string) => void
  busy?: boolean
}

function isValidCuit(value: string): boolean {
  return /^\d{11}$/.test(value.replace(/\D/g, ''))
}

// Shown when the tenant is Responsable Inscripto and the sale must be
// invoiced as Factura A (requires the receptor's CUIT — the one deliberate
// exception to never collecting client documents) or Factura B (no document,
// same as C). Reused by every auto/cash-invoice flow — do not duplicate this
// per screen.
export default function InvoiceTypeChoiceModal({ open, onCancel, onConfirm, busy }: Props) {
  const [choice, setChoice] = useState<'A' | null>(null)
  const [cuit, setCuit] = useState('')

  function reset() {
    setChoice(null)
    setCuit('')
  }

  function handleCancel() {
    reset()
    onCancel()
  }

  function handleChooseB() {
    reset()
    onConfirm('B')
  }

  function handleConfirmA() {
    if (!isValidCuit(cuit)) return
    const digits = cuit.replace(/\D/g, '')
    reset()
    onConfirm('A', digits)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Tipo de comprobante</DialogTitle>
          <DialogDescription>Este local es Responsable Inscripto — elegí el tipo de factura a emitir.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={choice === 'A' ? undefined : 'outline'}
              className={choice === 'A' ? 'flex-1 bg-plum-700 hover:bg-plum-800 text-white' : 'flex-1'}
              onClick={() => setChoice('A')}
              disabled={busy}
            >
              Factura A
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={handleChooseB}
              disabled={busy}
            >
              Factura B
            </Button>
          </div>

          {choice === 'A' && (
            <div className="space-y-1.5">
              <Label htmlFor="invoice-choice-cuit">CUIT del receptor *</Label>
              <Input
                id="invoice-choice-cuit"
                value={cuit}
                onChange={(e) => setCuit(e.target.value)}
                placeholder="20123456789"
                maxLength={13}
                autoFocus
              />
              {cuit.length > 0 && !isValidCuit(cuit) && (
                <p className="text-xs text-red-600">El CUIT debe tener 11 dígitos.</p>
              )}
              <Button
                type="button"
                className="w-full bg-plum-700 hover:bg-plum-800 text-white"
                onClick={handleConfirmA}
                disabled={!isValidCuit(cuit) || busy}
              >
                Confirmar Factura A
              </Button>
            </div>
          )}

          <Button type="button" variant="ghost" className="w-full text-muted-foreground" onClick={handleCancel} disabled={busy}>
            Cancelar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

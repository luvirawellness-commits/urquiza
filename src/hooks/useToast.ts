import { useEffect, useState } from 'react'

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: 'default' | 'destructive'
}

const TOAST_REMOVE_DELAY = 4000

let toastCount = 0
let memoryToasts: Toast[] = []
const listeners: Array<(toasts: Toast[]) => void> = []

function emit() {
  listeners.forEach((listener) => listener(memoryToasts))
}

function dismiss(id: string) {
  memoryToasts = memoryToasts.filter((t) => t.id !== id)
  emit()
}

export function toast({ title, description, variant = 'default' }: Omit<Toast, 'id'>) {
  const id = String(++toastCount)
  memoryToasts = [...memoryToasts, { id, title, description, variant }]
  emit()
  setTimeout(() => dismiss(id), TOAST_REMOVE_DELAY)
  return id
}

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>(memoryToasts)

  useEffect(() => {
    listeners.push(setToasts)
    return () => {
      const i = listeners.indexOf(setToasts)
      if (i > -1) listeners.splice(i, 1)
    }
  }, [])

  return { toasts, toast, dismiss }
}

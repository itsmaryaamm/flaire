import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { useT } from './i18n'

type ToastKind = 'success' | 'error' | 'info'

/** Optional link shown under the message, e.g. "Open policy" to /policy. */
export interface ToastAction {
  label: string
  to: string
}

interface Toast {
  id: number
  kind: ToastKind
  message: string
  action?: ToastAction
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind, action?: ToastAction) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string, action?: ToastAction) => void
}

const ToastContext = createContext<ToastApi | null>(null)

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const tr = useT()
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info', action?: ToastAction) => {
      const id = ++counter
      setToasts((t) => [...t, { id, kind, message, action }])
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : action ? 6000 : 3500)
    },
    [dismiss],
  )

  const value = useMemo<ToastApi>(
    () => ({
      toast,
      success: (m) => toast(m, 'success'),
      error: (m) => toast(m, 'error'),
      info: (m, action) => toast(m, 'info', action),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-20 md:bottom-4 end-4 start-4 md:start-auto z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-card border px-3.5 py-2.5 text-sm shadow-lg bg-white md:min-w-[280px] md:max-w-sm ${
              t.kind === 'success'
                ? 'border-success/30 text-success'
                : t.kind === 'error'
                  ? 'border-danger/40 text-danger'
                  : 'border-line-strong text-ink'
            }`}
          >
            {t.kind === 'success' ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            ) : t.kind === 'error' ? (
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            ) : (
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
            )}
            <span className="flex-1">
              {t.message}
              {t.action && (
                <Link to={t.action.to} onClick={() => dismiss(t.id)} className="block mt-1 text-xs font-semibold text-brand hover:underline">
                  {t.action.label}
                </Link>
              )}
            </span>
            <button
              onClick={() => dismiss(t.id)}
              className="text-neutral-400 hover:text-neutral-700"
              aria-label={tr('common.dismiss')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

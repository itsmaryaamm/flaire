import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Circle, Rocket, X } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'
import { useFetch } from '../../lib/useFetch'
import { useToast } from '../../lib/toast'
import type { OnboardingStatus } from '../../types'

const ROWS: { key: keyof OnboardingStatus['steps']; label: string; to: string }[] = [
  { key: 'company', label: 'Company', to: '/welcome' },
  { key: 'department', label: 'Budget', to: '/settings#advanced' },
  { key: 'card', label: 'Card', to: '/employees' },
  { key: 'agent', label: 'Employee', to: '/employees' },
  { key: 'claude_connected', label: 'Claude connected', to: '/settings#connect' },
  { key: 'first_request', label: 'First request', to: '/employees' },
  { key: 'two_factor', label: '2FA', to: '/settings#security' },
]

/** Compact checklist shown above the KPIs until setup is complete or the owner dismisses it. */
export function GettingStartedCard() {
  const toast = useToast()
  const { data, setData } = useFetch(() => api.get<OnboardingStatus>('/onboarding/status').then((r) => r.data), [])
  const [hidden, setHidden] = useState(false)
  const [dismissing, setDismissing] = useState(false)

  if (!data || hidden) return null
  // Hidden once everything is ticked, and once the owner has dismissed it (onboarding_done).
  if (data.complete || data.onboarding_done) return null

  const doneCount = ROWS.filter((r) => data.steps[r.key]).length

  const dismiss = async () => {
    setDismissing(true)
    try {
      await api.post('/onboarding/dismiss')
      setHidden(true)
      setData((prev) => (prev ? { ...prev, onboarding_done: true } : prev))
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setDismissing(false)
    }
  }

  return (
    <section className="card-lg p-5 border-brand/30 bg-gradient-to-br from-white to-brand-tint">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <Rocket className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-bold">Getting started</h3>
            <span className="mono-label tnum">
              {doneCount} of {ROWS.length}
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">A few steps and your employees can spend safely.</p>
          <ul className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-1.5">
            {ROWS.map((r) => {
              const done = data.steps[r.key]
              return (
                <li key={r.key} className="flex items-center gap-2 text-sm">
                  {done ? (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-success-tint text-success">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-lavender-deep text-neutral-400">
                      <Circle className="h-2.5 w-2.5" />
                    </span>
                  )}
                  {done ? (
                    <span className="text-neutral-500 line-through decoration-neutral-300">{r.label}</span>
                  ) : (
                    <Link to={r.to} className="font-semibold text-ink hover:text-brand hover:underline">
                      {r.label}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <Link to="/welcome" className="btn-primary text-xs">
              Finish setup
            </Link>
            <button type="button" className="btn-ghost text-xs" onClick={dismiss} disabled={dismissing}>
              <X className="h-3.5 w-3.5" /> Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

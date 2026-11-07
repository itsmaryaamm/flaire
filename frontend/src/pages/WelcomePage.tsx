import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Circle, LogOut, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { PENDING_COMPANY_KEY, useAuth } from '../lib/auth'
import type { Company, ConnectorInfo, OnboardingStatus } from '../types'
import { CopyBox } from '../components/CopyBox'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'

const TOTAL = 4

function readPendingCompany(): string {
  try {
    return localStorage.getItem(PENDING_COMPANY_KEY) ?? ''
  } catch {
    return ''
  }
}

function clearPendingCompany() {
  try {
    localStorage.removeItem(PENDING_COMPANY_KEY)
  } catch {
    // ignore
  }
}

function Progress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2" aria-label={`Step ${step} of ${TOTAL}`}>
      {Array.from({ length: TOTAL }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-pill transition-colors ${i < step ? 'bg-brand' : 'bg-lavender-deep'}`}
        />
      ))}
    </div>
  )
}

function StepShell({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card-lg p-8 sm:p-10">
      <Progress step={step} />
      <div className="mono-label mt-6">
        Step {step} of {TOTAL}
      </div>
      <h1 className="text-3xl font-extrabold tracking-tightest mt-2 mb-6">{title}</h1>
      {children}
    </div>
  )
}

/* ---------- Step 1: company ---------- */

function CompanyStep({ onDone }: { onDone: () => void }) {
  const { user, refresh } = useAuth()
  const [companyName, setCompanyName] = useState(readPendingCompany)
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post<{ company: Company; next: string }>('/onboarding/company', {
        company_name: companyName.trim(),
        full_name: fullName.trim() || undefined,
      })
      clearPendingCompany()
      await refresh()
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell step={1} title="Name your company">
      <p className="text-neutral-600 mb-6">This is the workspace your AI employees will spend from. You can rename it later.</p>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="w-company">Company name</label>
          <input id="w-company" className="input text-base py-2.5" required autoFocus value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nawah Tech" />
        </div>
        <div>
          <label className="label" htmlFor="w-name">Your name</label>
          <input id="w-name" className="input text-base py-2.5" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Sara" autoComplete="name" />
        </div>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full text-base py-3" disabled={busy || !companyName.trim()}>
          {busy && <Spinner />} Create company
        </button>
      </form>
    </StepShell>
  )
}

/* ---------- Step 2: first budget ---------- */

function BudgetStep({ onDone }: { onDone: () => void }) {
  const [department, setDepartment] = useState('Marketing')
  const [budget, setBudget] = useState('5000')
  const [extras, setExtras] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/onboarding/quickstart', {
        department_name: department.trim() || 'Marketing',
        monthly_budget: Math.round(Number(budget) * 100),
        card_limit: extras ? 10_000 * 100 : undefined,
        create_agent: extras,
      })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell step={2} title="Set a first budget">
      <p className="text-neutral-600 mb-6">AI employees can only spend inside this.</p>
      <form onSubmit={submit} className="space-y-5">
        <div>
          <label className="label" htmlFor="w-dept">Department</label>
          <input id="w-dept" className="input text-base py-2.5" required value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="w-budget">Monthly budget (SAR)</label>
          <input
            id="w-budget"
            className="input text-base py-2.5 tnum"
            type="number"
            min={0}
            step={100}
            required
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <label className="flex items-start gap-3 rounded-card border border-line bg-lavender px-4 py-3 text-sm cursor-pointer">
          <input type="checkbox" className="mt-1 accent-brand" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
          <span>
            <span className="font-semibold">Also create a simulated SNB card (SAR 10,000) and a Marketing AI employee</span>
            <span className="block text-xs text-neutral-500 mt-0.5">Fastest way to see a purchase request flow end to end. No real money moves.</span>
          </span>
        </label>
        <ErrorNote message={error} />
        <button type="submit" className="btn-primary w-full text-base py-3" disabled={busy || Number(budget) < 0}>
          {busy && <Spinner />} Save budget
        </button>
        <button type="button" className="btn-ghost w-full text-xs" onClick={onDone} disabled={busy}>
          Skip for now
        </button>
      </form>
    </StepShell>
  )
}

/* ---------- Step 3: connect Claude ---------- */

function ConnectStep({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<ConnectorInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<ConnectorInfo>('/connector-info')
      .then((r) => !cancelled && setInfo(r.data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <StepShell step={3} title="Connect your Claude">
      <p className="text-neutral-600 mb-6">Add Flaire as a connector in Claude. Each Claude signs in as one AI employee and spends only within that employee's limits.</p>
      {error && <ErrorNote message={error} className="mb-4" />}
      {!info && !error && (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2 mb-4">
          <Spinner /> Loading connector details
        </div>
      )}
      {info && (
        <div className="space-y-4 mb-6">
          <div>
            <div className="label">Connector URL</div>
            <CopyBox value={info.url} />
          </div>
          <ol className="space-y-2 text-sm text-neutral-600">
            {info.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-bold tnum">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      <button type="button" className="btn-primary w-full text-base py-3" onClick={onDone}>
        I've connected it
      </button>
      <button type="button" className="btn-ghost w-full text-xs mt-2" onClick={onDone}>
        Do this later
      </button>
    </StepShell>
  )
}

/* ---------- Step 4: ready ---------- */

const CHECKS: { key: keyof OnboardingStatus['steps']; label: string }[] = [
  { key: 'company', label: 'Company created' },
  { key: 'department', label: 'First budget set' },
  { key: 'card', label: 'A card to pay from' },
  { key: 'agent', label: 'An AI employee' },
  { key: 'claude_connected', label: 'Claude connected' },
  { key: 'first_request', label: 'First purchase request' },
  { key: 'two_factor', label: 'Two-factor authentication' },
]

function ReadyStep() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<OnboardingStatus>('/onboarding/status')
      .then((r) => !cancelled && setStatus(r.data))
      .catch((err) => !cancelled && setError(errorMessage(err)))
    // Pull the latest company (onboarding flags) into context before leaving the walkthrough.
    refresh().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [refresh])

  const steps = status?.steps

  return (
    <StepShell step={4} title="You're ready">
      <p className="text-neutral-600 mb-6">Here is where you stand. Anything unticked can be finished from the dashboard whenever you like.</p>
      {error && <ErrorNote message={error} className="mb-4" />}
      {!status && !error && (
        <div className="flex items-center gap-2 text-sm text-neutral-500 py-2 mb-4">
          <Spinner /> Checking your setup
        </div>
      )}
      {steps && (
        <ul className="space-y-2 mb-6">
          {CHECKS.map((c) => {
            const done = steps[c.key]
            return (
              <li key={c.key} className="flex items-center gap-3 text-sm">
                {done ? (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-tint text-success">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-lavender-deep text-neutral-400">
                    <Circle className="h-3 w-3" />
                  </span>
                )}
                <span className={done ? 'font-semibold' : 'text-neutral-600'}>{c.label}</span>
              </li>
            )
          })}
        </ul>
      )}
      {steps && !steps.two_factor && (
        <div className="flex items-start gap-2 rounded-card border border-line bg-lavender px-4 py-3 text-xs text-neutral-600 mb-6">
          <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0 text-brand" />
          <span>Approvals are only as safe as your account. Turn on 2FA in Settings, under Security, when you have a minute.</span>
        </div>
      )}
      <div className="flex flex-col sm:flex-row gap-3">
        <button type="button" className="btn-primary flex-1 text-base py-3" onClick={() => navigate('/')}>
          Open dashboard
        </button>
        <button type="button" className="btn-secondary flex-1 text-base py-3" onClick={() => navigate('/m')}>
          Open phone view
        </button>
      </div>
    </StepShell>
  )
}

/* ---------- Page ---------- */

export default function WelcomePage() {
  const { company, user, logout } = useAuth()
  const navigate = useNavigate()
  // Users who already have a company (returning via "restart walkthrough") skip the company step.
  const [step, setStep] = useState<number>(() => (company ? 2 : 1))

  useEffect(() => {
    if (company && step === 1) setStep(2)
  }, [company, step])

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center px-4 py-10 sm:py-16">
      <img src="/flaire-logo.png" alt="Flaire" className="h-9 w-auto mb-10" />
      <div className="w-full max-w-lg">
        {step === 1 && <CompanyStep onDone={() => setStep(2)} />}
        {step === 2 && <BudgetStep onDone={() => setStep(3)} />}
        {step === 3 && <ConnectStep onDone={() => setStep(4)} />}
        {step === 4 && <ReadyStep />}
      </div>
      <div className="mt-8 flex items-center gap-3 text-xs text-neutral-500">
        <span className="truncate max-w-[220px]">{user?.email}</span>
        <button type="button" className="inline-flex items-center gap-1 text-brand font-semibold hover:underline" onClick={signOut}>
          <LogOut className="h-3 w-3" /> Sign out
        </button>
      </div>
      <p className="mt-4 font-mono text-[11px] text-neutral-500">Simulation · no real money moves</p>
    </div>
  )
}

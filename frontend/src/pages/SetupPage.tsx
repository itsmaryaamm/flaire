import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, LogOut, ShieldCheck } from 'lucide-react'
import { api, errorMessage } from '../lib/api'
import { PENDING_COMPANY_KEY, useAuth } from '../lib/auth'
import { LanguageSwitch, useT } from '../lib/i18n'
import { toHalalas } from '../lib/money'
import type { SetupStatus } from '../lib/onboarding'
import type { Agent, AgentCreateInput, Company, Department } from '../types'
import { ConnectAiPanel } from '../components/ConnectAiPanel'
import { CopyBox } from '../components/CopyBox'
import { ErrorNote } from '../components/ErrorNote'
import { Spinner } from '../components/Spinner'
import { StatusPill } from '../components/StatusPill'
import { TwoFactorSetup } from '../components/TwoFactorSetup'
import { AsaRow } from '../components/settings/AsaRow'

type StepId = 'company' | 'twofa' | 'card' | 'employee' | 'connect' | 'test' | 'finish'

const ALL_STEPS: StepId[] = ['company', 'twofa', 'card', 'employee', 'connect', 'test', 'finish']
const APPROVER_ROLES = ['owner', 'admin', 'finance']
const TEST_PROMPT = 'Launch a SAR 300 Google Ads test'

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

/** Is a step already satisfied according to /onboarding/status? Finishing the wizard counts the optional ones as done. */
function stepDone(step: StepId, s: SetupStatus | null): boolean {
  if (!s) return false
  switch (step) {
    case 'company':
      return s.steps.company
    case 'twofa':
      return s.steps.twofa
    case 'card':
      return s.steps.card || s.onboarding_done
    case 'employee':
      return s.steps.employee || s.onboarding_done
    case 'connect':
      return s.steps.connected || s.onboarding_done
    case 'test':
      return s.steps.first_purchase || s.onboarding_done
    case 'finish':
      return false
  }
}

/* ------------------------------------------------------------------ frame */

function StepFrame({
  title,
  why,
  children,
  canContinue,
  onContinue,
  onBack,
  continueLabel,
  secondary,
  busy = false,
}: {
  title: string
  why: string
  children: ReactNode
  canContinue: boolean
  onContinue: () => void
  onBack: (() => void) | null
  continueLabel?: string
  /** Optional second action (for example "Do this later"). */
  secondary?: { label: string; onClick: () => void } | null
  busy?: boolean
}) {
  const t = useT()
  return (
    <div className="card-lg p-6 sm:p-8">
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tightest">{title}</h1>
      <p className="text-sm text-neutral-600 mt-2 mb-6">{why}</p>
      {children}
      <div className="mt-8 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-line pt-5">
        <div>
          {onBack && (
            <button type="button" className="btn-ghost" onClick={onBack} disabled={busy}>
              <ArrowLeft className="h-4 w-4 rtl-flip" /> {t('common.back')}
            </button>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          {secondary && (
            <button type="button" className="btn-secondary" onClick={secondary.onClick} disabled={busy}>
              {secondary.label}
            </button>
          )}
          <button type="button" className="btn-primary" onClick={onContinue} disabled={!canContinue || busy}>
            {continueLabel ?? t('common.continue')} <ArrowRight className="h-4 w-4 rtl-flip" />
          </button>
        </div>
      </div>
    </div>
  )
}

function DoneNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-card border border-line bg-success-tint px-4 py-3 text-sm text-success">
      <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ steps */

interface StepProps {
  status: SetupStatus | null
  onBack: (() => void) | null
  /** Advance after the step is satisfied; refreshes status first. */
  advance: () => Promise<void>
  refreshStatus: () => Promise<SetupStatus | null>
}

function CompanyStep({ status, onBack, advance }: StepProps) {
  const t = useT()
  const { user, refresh } = useAuth()
  const done = stepDone('company', status)
  const [companyName, setCompanyName] = useState(readPendingCompany)
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [budget, setBudget] = useState('5000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const cents = toHalalas(budget)
    if (Number.isNaN(cents) || cents < 0) {
      setError(t('common.validAmount'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post<{ company: Company; next: string }>('/onboarding/company', {
        company_name: companyName.trim(),
        full_name: fullName.trim() || undefined,
      })
      clearPendingCompany()
      // The budget lives on the first department; the first AI employee joins it.
      try {
        await api.post<Department>('/departments', { name: 'Marketing', monthly_budget: cents })
      } catch {
        // Older backend or a race: the employee step creates the department if it is still missing.
      }
      await refresh()
      await advance()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepFrame
      title={t('setup.companyTitle')}
      why={t('setup.companyWhy')}
      canContinue={done}
      onContinue={() => void advance()}
      onBack={onBack}
      busy={busy}
    >
      {done ? (
        <DoneNote>{t('setup.companyDone')}</DoneNote>
      ) : (
        <form onSubmit={submit} className="space-y-4" id="setup-company-form">
          <div>
            <label className="label" htmlFor="s-company">{t('auth.companyName')}</label>
            <input id="s-company" className="input" required autoFocus value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Nawah Tech" />
          </div>
          <div>
            <label className="label" htmlFor="s-name">{t('auth.yourName')}</label>
            <input id="s-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Sara" autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="s-budget">{t('settings.monthlyBudgetSar')}</label>
            <input id="s-budget" className="input tnum" inputMode="decimal" required value={budget} onChange={(e) => setBudget(e.target.value)} />
            <p className="text-xs text-neutral-500 mt-1">{t('setup.budgetHint')}</p>
          </div>
          <ErrorNote message={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy || !companyName.trim()}>
            {busy && <Spinner />} {t('auth.createCompany')}
          </button>
        </form>
      )}
    </StepFrame>
  )
}

function TwoFaStep({ status, onBack, advance }: StepProps) {
  const t = useT()
  const { user } = useAuth()
  const done = stepDone('twofa', status) || !!user?.totp_enabled
  return (
    <StepFrame title={t('setup.twofaTitle')} why={t('setup.twofaWhy')} canContinue={done} onContinue={() => void advance()} onBack={onBack}>
      <div className="flex items-center gap-2 rounded-input border border-line bg-lavender px-3 py-2 text-xs text-neutral-600 mb-4">
        <ShieldCheck className="h-4 w-4 text-brand shrink-0" /> {t('setup.twofaRequiredLine')}
      </div>
      {done ? <DoneNote>{t('security.2faOn')}</DoneNote> : <TwoFactorSetup autoStart onEnabled={() => void advance()} />}
    </StepFrame>
  )
}

function CardStep({ status, onBack, advance, refreshStatus }: StepProps) {
  const t = useT()
  const { company, setCompany } = useAuth()
  const configured = !!company?.lithic_configured || !!status?.steps.card
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [asaKey, setAsaKey] = useState(0)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim()) return
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.patch<Company>('/company', { lithic_api_key: key.trim() })
      setCompany(data)
      setKey('')
      setAsaKey((k) => k + 1)
      await refreshStatus()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepFrame
      title={t('setup.cardTitle')}
      why={t('setup.cardWhy')}
      canContinue={configured}
      onContinue={() => void advance()}
      onBack={onBack}
      secondary={configured ? null : { label: t('welcome.doLater'), onClick: () => void advance() }}
      busy={busy}
    >
      <div className="flex items-center gap-2 text-sm mb-4">
        <span className="text-neutral-600">{t('setup.cardStatus')}:</span>
        {configured ? <StatusPill tone="green" dot>{t('setup.configured')}</StatusPill> : <StatusPill tone="neutral">{t('setup.notConfigured')}</StatusPill>}
      </div>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className="label" htmlFor="s-lithic">{t('setup.lithicKeyLabel')}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="s-lithic"
              className="input font-mono"
              type="password"
              autoComplete="off"
              placeholder={configured ? t('settings.lithicReplace') : t('settings.lithicPaste')}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <button type="submit" className="btn-primary" disabled={busy || !key.trim()}>
              {busy && <Spinner />} {t('common.save')}
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-1.5">{t('setup.lithicHint')}</p>
        </div>
        <ErrorNote message={error} />
      </form>
      <div key={asaKey}>
        <AsaRow />
      </div>
    </StepFrame>
  )
}

function EmployeeStep({ status, onBack, advance }: StepProps) {
  const t = useT()
  const { company } = useAuth()
  const already = stepDone('employee', status)
  const [name, setName] = useState('Marketing AI')
  const [monthly, setMonthly] = useState('5000')
  const [perPurchase, setPerPurchase] = useState('1000')
  const [threshold, setThreshold] = useState('1000')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Agent | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const m = toHalalas(monthly)
    const p = toHalalas(perPurchase)
    const th = toHalalas(threshold)
    if ([m, p, th].some((n) => Number.isNaN(n) || n < 0)) {
      setError(t('employees.limitsValid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      let departments = (await api.get<Department[]>('/departments')).data
      if (!departments.length) {
        const { data } = await api.post<Department>('/departments', { name: 'Marketing', monthly_budget: m })
        departments = [data]
      }
      const payload: AgentCreateInput = {
        name: name.trim(),
        role: 'marketing',
        department_id: departments[0].id,
        per_transaction_limit: p,
        monthly_limit: m,
        approval_threshold: th,
        allowed_categories: ['advertising', 'software'],
        blocked_merchants: ['Gift card'],
        max_requests_per_hour: 10,
        cost_center_id: null,
        gl_code: null,
      }
      const { data } = await api.post<{ agent: Agent; api_key: string }>('/agents', payload)
      let agent = data.agent
      if (!agent.card && company?.lithic_configured) {
        // Newer backend: issue the employee card explicitly. Older backend issues it on create or not at all.
        try {
          const res = await api.post<Agent | { agent?: Agent }>(`/agents/${agent.id}/card`)
          const body = res.data as { agent?: Agent; card?: Agent['card'] }
          if (body?.agent) agent = body.agent
          else if (body?.card) agent = { ...agent, card: body.card }
        } catch {
          // No card yet; it can be issued from the employee page later.
        }
      }
      setCreated(agent)
      await advance()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepFrame
      title={t('setup.employeeTitle')}
      why={t('setup.employeeWhy')}
      canContinue={already || !!created}
      onContinue={() => void advance()}
      onBack={onBack}
      busy={busy}
    >
      {already || created ? (
        <DoneNote>{created ? t('setup.employeeCreated', { name: created.name }) : t('setup.employeeExists')}</DoneNote>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label" htmlFor="s-agent-name">{t('team.name')}</label>
            <input id="s-agent-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t('employees.namePlaceholder')} />
          </div>
          <fieldset className="rounded-card border border-line p-4 space-y-3">
            <legend className="px-1 mono-label">{t('employees.spendingLimits')}</legend>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label" htmlFor="s-monthly">{t('setup.monthlyLimit')}</label>
                <input id="s-monthly" className="input tnum" inputMode="decimal" required value={monthly} onChange={(e) => setMonthly(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="s-per">{t('setup.perPurchaseLimit')}</label>
                <input id="s-per" className="input tnum" inputMode="decimal" required value={perPurchase} onChange={(e) => setPerPurchase(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="s-threshold">{t('setup.approvalThreshold')}</label>
                <input id="s-threshold" className="input tnum" inputMode="decimal" required value={threshold} onChange={(e) => setThreshold(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-neutral-500">{t('setup.limitsHint')}</p>
          </fieldset>
          <ErrorNote message={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
            {busy && <Spinner />} {t('employees.createEmployee')}
          </button>
        </form>
      )}
    </StepFrame>
  )
}

function ConnectStep({ status, onBack, advance, refreshStatus }: StepProps) {
  const t = useT()
  const connected = !!status?.steps.connected
  const [checking, setChecking] = useState(false)
  const [notYet, setNotYet] = useState(false)
  const stop = useRef(false)

  useEffect(() => {
    stop.current = false
    return () => {
      stop.current = true
    }
  }, [])

  const check = async () => {
    setChecking(true)
    setNotYet(false)
    // Poll for up to about 45 seconds: the OAuth handshake in Claude or ChatGPT takes a moment to land.
    for (let i = 0; i < 15 && !stop.current; i++) {
      const s = await refreshStatus()
      if (s?.steps.connected) {
        setChecking(false)
        await advance()
        return
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
    if (!stop.current) {
      setChecking(false)
      setNotYet(true)
    }
  }

  return (
    <StepFrame title={t('setup.connectTitle')} why={t('setup.connectWhy')} canContinue={connected} onContinue={() => void advance()} onBack={onBack} busy={checking}>
      {connected ? (
        <DoneNote>{t('setup.connectDone')}</DoneNote>
      ) : (
        <>
          <ConnectAiPanel />
          <div className="mt-5">
            <button type="button" className="btn-primary w-full" onClick={check} disabled={checking}>
              {checking ? <Spinner /> : <Check className="h-4 w-4" />} {checking ? t('setup.checkingConnection') : t('welcome.connectedIt')}
            </button>
            {notYet && <p className="text-xs text-warn mt-2">{t('setup.notConnectedYet')}</p>}
          </div>
        </>
      )}
    </StepFrame>
  )
}

function TestStep({ status, onBack, advance, refreshStatus }: StepProps) {
  const t = useT()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const received = !!status?.steps.first_purchase
  const [opening, setOpening] = useState(false)

  // Live status while this step is open.
  useEffect(() => {
    if (received) return
    const timer = window.setInterval(() => void refreshStatus(), 4000)
    return () => window.clearInterval(timer)
  }, [received, refreshStatus])

  const openActivity = async () => {
    setOpening(true)
    try {
      await api.post('/onboarding/dismiss').catch(() => undefined)
      await refresh()
      navigate('/activity')
    } finally {
      setOpening(false)
    }
  }

  return (
    <StepFrame title={t('setup.testTitle')} why={t('setup.testWhy')} canContinue onContinue={() => void advance()} onBack={onBack}>
      <ol className="space-y-3 text-sm text-neutral-600">
        <li className="flex gap-3">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-bold tnum">1</span>
          <div className="flex-1 min-w-0">
            <p className="pt-0.5 mb-2">{t('setup.testAsk')}</p>
            <CopyBox value={TEST_PROMPT} mono={false} />
          </div>
        </li>
        <li className="flex gap-3">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-bold tnum">2</span>
          <span className="pt-0.5">{t('setup.testWhatHappens')}</span>
        </li>
      </ol>
      <div className="mt-5 flex flex-wrap items-center gap-2 rounded-card border border-line bg-lavender px-4 py-3 text-sm">
        <span className="text-neutral-600">{t('setup.testStatus')}:</span>
        {received ? (
          <StatusPill tone="green" dot>{t('setup.testReceived')}</StatusPill>
        ) : (
          <span className="inline-flex items-center gap-2 text-neutral-600">
            <Spinner className="h-3.5 w-3.5" /> {t('setup.testWaiting')}
          </span>
        )}
        <button type="button" className="btn-ghost text-xs ms-auto" onClick={openActivity} disabled={opening}>
          {opening && <Spinner className="h-3.5 w-3.5" />} {t('setup.openActivity')}
        </button>
      </div>
    </StepFrame>
  )
}

function FinishStep({ onBack }: { onBack: (() => void) | null }) {
  const t = useT()
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [busy, setBusy] = useState(false)

  const go = async () => {
    setBusy(true)
    try {
      await api.post('/onboarding/dismiss').catch(() => undefined)
      await refresh()
      navigate('/', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card-lg p-6 sm:p-8 text-center">
      <span className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full bg-success-tint text-success">
        <Check className="h-7 w-7" />
      </span>
      <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tightest mt-5">{t('setup.finishTitle')}</h1>
      <p className="text-sm text-neutral-600 mt-2 max-w-md mx-auto">{t('setup.finishBody')}</p>
      <button type="button" className="btn-primary mt-7 text-base px-6 py-3" onClick={go} disabled={busy}>
        {busy && <Spinner />} {t('setup.goToFlaire')} <ArrowRight className="h-4 w-4 rtl-flip" />
      </button>
      {onBack && (
        <div className="mt-4">
          <button type="button" className="btn-ghost text-xs" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 rtl-flip" /> {t('common.back')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export default function SetupPage() {
  const t = useT()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { user, company, onboarding, needsOnboarding, refreshOnboarding, logout } = useAuth()

  // People who cannot set the company up (invited viewers, department heads) only have the mandatory 2FA step.
  const steps = useMemo<StepId[]>(() => {
    const canSetup = needsOnboarding || !company || (user?.role ? APPROVER_ROLES.includes(user.role) : true)
    return canSetup ? ALL_STEPS : ['twofa', 'finish']
  }, [needsOnboarding, company, user?.role])

  const firstOpen = useCallback(
    (s: SetupStatus | null): StepId => {
      if (needsOnboarding || !company) return 'company'
      return steps.find((id) => id !== 'finish' && !stepDone(id, s)) ?? 'finish'
    },
    [needsOnboarding, company, steps],
  )

  const [current, setCurrent] = useState<StepId | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Pick the starting step once the status is known (or straight away when there is no company yet).
  useEffect(() => {
    if (current) return
    const wanted = params.get('step')
    if (wanted === 'twofa' || wanted === '2fa') {
      setCurrent('twofa')
      return
    }
    if (needsOnboarding || !company) {
      setCurrent('company')
      return
    }
    if (onboarding) {
      setCurrent(firstOpen(onboarding))
      return
    }
    refreshOnboarding()
      .then((s) => setCurrent(firstOpen(s)))
      .catch((err) => setLoadError(errorMessage(err)))
  }, [current, params, needsOnboarding, company, onboarding, firstOpen, refreshOnboarding])

  const index = current ? steps.indexOf(current) : -1
  const total = steps.length

  const goTo = useCallback(
    (id: StepId) => {
      setCurrent(id)
      if (params.has('step')) setParams({}, { replace: true })
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [params, setParams],
  )

  const advance = useCallback(async () => {
    const s = await refreshOnboarding()
    const i = current ? steps.indexOf(current) : -1
    // Next step that is still open; skip the ones already satisfied (returning users, or 2FA-only visits).
    const next = steps.slice(i + 1).find((id) => id === 'finish' || !stepDone(id, s)) ?? 'finish'
    goTo(next)
  }, [current, steps, refreshOnboarding, goTo])

  const back = index > 0 ? () => goTo(steps[index - 1]) : null

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  const stepLabel = (id: StepId) => t(`setup.nav.${id}`)

  const props: StepProps = { status: onboarding, onBack: back, advance, refreshStatus: refreshOnboarding }

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <header className="border-b border-line bg-white">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <img src="/flaire-logo.png" alt="Flaire" className="h-7 w-auto" />
          <div className="flex items-center gap-3">
            <LanguageSwitch />
          </div>
        </div>
        {/* Progress bar */}
        <div className="h-1 bg-lavender-deep">
          <div className="h-1 bg-brand transition-all" style={{ width: `${index < 0 ? 0 : Math.round(((index + 1) / total) * 100)}%` }} />
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-6 sm:py-10">
        {loadError && <ErrorNote message={loadError} className="mb-4" />}
        {!current ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-neutral-500">
            <Spinner /> {t('welcome.checking')}
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:gap-10">
            {/* Vertical stepper */}
            <aside>
              <div className="mono-label mb-3">{t('welcome.stepOf', { step: index + 1, total })}</div>
              <ol className="hidden lg:block space-y-1">
                {steps.map((id, i) => {
                  const done = stepDone(id, onboarding) || i < index
                  const active = id === current
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => (done || i <= index ? goTo(id) : undefined)}
                        disabled={!done && i > index}
                        className={`w-full flex items-center gap-3 rounded-input px-2.5 py-2 text-sm text-start transition-colors ${active ? 'bg-brand-light text-brand font-semibold' : done ? 'text-ink hover:bg-lavender' : 'text-neutral-400'}`}
                      >
                        <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tnum ${done && !active ? 'bg-success-tint text-success' : active ? 'bg-brand text-white' : 'bg-lavender-deep text-neutral-500'}`}>
                          {done && !active ? <Check className="h-3.5 w-3.5" /> : i + 1}
                        </span>
                        {stepLabel(id)}
                      </button>
                    </li>
                  )
                })}
              </ol>
              {/* Mobile: dots */}
              <div className="flex lg:hidden items-center gap-1.5">
                {steps.map((id, i) => (
                  <span key={id} className={`h-1.5 flex-1 rounded-pill ${i <= index ? 'bg-brand' : 'bg-lavender-deep'}`} />
                ))}
              </div>
              <div className="lg:hidden mt-2 text-sm font-semibold">{stepLabel(current)}</div>
            </aside>

            <div className="min-w-0">
              {current === 'company' && <CompanyStep {...props} />}
              {current === 'twofa' && <TwoFaStep {...props} />}
              {current === 'card' && <CardStep {...props} />}
              {current === 'employee' && <EmployeeStep {...props} />}
              {current === 'connect' && <ConnectStep {...props} />}
              {current === 'test' && <TestStep {...props} />}
              {current === 'finish' && <FinishStep onBack={back} />}
            </div>
          </div>
        )}
      </main>

      <footer className="py-6">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
          <span className="truncate max-w-[240px]">{user?.email}</span>
          <div className="flex items-center gap-4">
            <button type="button" className="inline-flex items-center gap-1 text-brand font-semibold hover:underline" onClick={signOut}>
              <LogOut className="h-3 w-3 rtl-flip" /> {t('auth.signOut')}
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

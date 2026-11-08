import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bot, Check, CreditCard, Fingerprint, Link2, Lock, ShieldCheck, Smartphone, UserCheck } from 'lucide-react'
import { LanguageSwitch, useT } from '../lib/i18n'

function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-5xl px-4 sm:px-6 ${className}`}>{children}</div>
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="mono-label text-brand">{children}</div>
}

/** Public home for logged-out visitors. Logged-in users never see this; the app lives at / for them. */
export default function LandingPage() {
  const t = useT()

  const steps = [
    { icon: Link2, title: t('landing.step1Title'), body: t('landing.step1Body') },
    { icon: CreditCard, title: t('landing.step2Title'), body: t('landing.step2Body') },
    { icon: Smartphone, title: t('landing.step3Title'), body: t('landing.step3Body') },
  ]

  const checks = [
    { title: t('landing.checkLimits'), body: t('landing.checkLimitsBody') },
    { title: t('landing.checkCategories'), body: t('landing.checkCategoriesBody') },
    { title: t('landing.checkSuppliers'), body: t('landing.checkSuppliersBody') },
    { title: t('landing.checkSplit'), body: t('landing.checkSplitBody') },
    { title: t('landing.checkChains'), body: t('landing.checkChainsBody') },
    { title: t('landing.checkKill'), body: t('landing.checkKillBody') },
  ]

  const security = [
    { icon: Lock, text: t('landing.secNoCardNumbers') },
    { icon: Fingerprint, text: t('landing.secLedger') },
    { icon: ShieldCheck, text: t('landing.sec2fa') },
  ]

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-3">
          <Link to="/" aria-label="Flaire" className="shrink-0">
            <img src="/flaire-logo.png" alt="Flaire" className="h-8 w-auto" />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link to="/login" className="btn-ghost text-sm">
              {t('auth.signIn')}
            </Link>
            <Link to="/register" className="btn-primary text-sm">
              {t('auth.createAccount')}
            </Link>
          </nav>
        </Container>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(123,47,242,0.16),transparent)]" aria-hidden="true" />
          <Container className="relative pt-16 pb-14 sm:pt-24 sm:pb-20 text-center">
            <Eyebrow>{t('landing.eyebrow')}</Eyebrow>
            <h1 className="mt-4 text-4xl sm:text-6xl font-extrabold tracking-tightest leading-[1.05] max-w-3xl mx-auto">
              {t('landing.heroTitle')}
            </h1>
            <p className="mt-5 text-base sm:text-lg text-neutral-600 max-w-2xl mx-auto">{t('landing.heroBody')}</p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/register" className="btn-primary w-full sm:w-auto text-base px-6 py-3">
                {t('auth.createAccount')} <ArrowRight className="h-4 w-4 rtl-flip" />
              </Link>
              <Link to="/login" className="btn-secondary w-full sm:w-auto text-base px-6 py-3">
                {t('auth.signIn')}
              </Link>
            </div>

            {/* A plain illustration of the flow: no numbers, no logos. */}
            <div className="mt-12 sm:mt-16 mx-auto max-w-2xl card-lg p-4 sm:p-6 text-start">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 items-stretch">
                <div className="rounded-card bg-lavender p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                    <Bot className="h-4 w-4 text-brand" /> {t('landing.flowAi')}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{t('landing.flowAiLine')}</p>
                </div>
                <div className="rounded-card bg-brand text-white p-4 shadow-primary">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white/80">
                    <ShieldCheck className="h-4 w-4" /> Flaire
                  </div>
                  <ul className="mt-2 space-y-1 text-sm">
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> {t('landing.flowCheck1')}</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> {t('landing.flowCheck2')}</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" /> {t('landing.flowCheck3')}</li>
                  </ul>
                </div>
                <div className="rounded-card bg-lavender p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600">
                    <UserCheck className="h-4 w-4 text-brand" /> {t('landing.flowHuman')}
                  </div>
                  <p className="mt-2 text-sm font-semibold">{t('landing.flowHumanLine')}</p>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* How it works */}
        <section className="py-14 sm:py-20 border-t border-line bg-white">
          <Container>
            <Eyebrow>{t('landing.howEyebrow')}</Eyebrow>
            <h2 className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tightest max-w-2xl">{t('landing.howTitle')}</h2>
            <ol className="mt-8 grid gap-4 sm:grid-cols-3">
              {steps.map((s, i) => (
                <li key={i} className="card p-5">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-card bg-brand-light text-brand">
                      <s.icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="font-mono text-xs text-neutral-400 tnum">0{i + 1}</span>
                  </div>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-sm text-neutral-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </Container>
        </section>

        {/* What Flaire checks */}
        <section className="py-14 sm:py-20 border-t border-line">
          <Container>
            <Eyebrow>{t('landing.checksEyebrow')}</Eyebrow>
            <h2 className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tightest max-w-2xl">{t('landing.checksTitle')}</h2>
            <p className="mt-3 text-neutral-600 max-w-2xl">{t('landing.checksBody')}</p>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {checks.map((c, i) => (
                <li key={i} className="flex gap-3 rounded-card border border-line bg-white p-4">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success-tint text-success">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <div className="font-semibold">{c.title}</div>
                    <p className="text-sm text-neutral-600 mt-0.5">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Container>
        </section>

        {/* Who approves */}
        <section className="py-14 sm:py-20 border-t border-line bg-white">
          <Container className="grid gap-8 lg:grid-cols-2 lg:items-center">
            <div>
              <Eyebrow>{t('landing.whoEyebrow')}</Eyebrow>
              <h2 className="mt-3 text-2xl sm:text-4xl font-extrabold tracking-tightest">{t('landing.whoTitle')}</h2>
              <p className="mt-3 text-neutral-600">{t('landing.whoBody')}</p>
            </div>
            <div className="card-lg p-5 sm:p-6">
              <ul className="space-y-4">
                {[t('landing.whoPoint1'), t('landing.whoPoint2'), t('landing.whoPoint3')].map((p, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand text-xs font-bold tnum">{i + 1}</span>
                    <span className="text-sm pt-1">{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>

        {/* Security */}
        <section className="py-14 sm:py-20 border-t border-line">
          <Container>
            <div className="rounded-card-lg bg-brand-deep text-white p-6 sm:p-10">
              <Eyebrow>
                <span className="text-white/70">{t('landing.secEyebrow')}</span>
              </Eyebrow>
              <h2 className="mt-3 text-2xl sm:text-3xl font-extrabold tracking-tightest">{t('landing.secTitle')}</h2>
              <ul className="mt-6 grid gap-4 sm:grid-cols-3">
                {security.map((s, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-card bg-white/10">
                      <s.icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm text-white/90 pt-1.5">{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Container>
        </section>

        {/* Final call */}
        <section className="py-14 sm:py-20 border-t border-line bg-white">
          <Container className="text-center">
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tightest">{t('landing.ctaTitle')}</h2>
            <p className="mt-3 text-neutral-600 max-w-xl mx-auto">{t('landing.ctaBody')}</p>
            <div className="mt-7 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/register" className="btn-primary w-full sm:w-auto text-base px-6 py-3">
                {t('auth.createAccount')}
              </Link>
              <Link to="/login" className="btn-secondary w-full sm:w-auto text-base px-6 py-3">
                {t('auth.signIn')}
              </Link>
            </div>
          </Container>
        </section>
      </main>

      <footer className="border-t border-line py-8">
        <Container className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/flaire-mark.png" alt="" className="h-6 w-6" />
            <span className="text-sm text-neutral-600">{t('landing.footerLine')}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/login" className="text-sm text-neutral-600 hover:text-ink">
              {t('auth.signIn')}
            </Link>
            <LanguageSwitch />
          </div>
        </Container>
      </footer>
    </div>
  )
}

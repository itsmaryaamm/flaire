import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { en } from './locales/en'
import { ar } from './locales/ar'
import { getLocale, setLocalePref } from './prefs'
import type { Locale } from './prefs'
import { setMoneyLocale } from './money'

export type { Locale }

export type Vars = Record<string, string | number>

const DICTS: Record<Locale, Record<string, string>> = { en, ar }

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`))
}

/** Pure lookup: ar falls back to en, en falls back to the key itself. */
export function translate(locale: Locale, key: string, vars?: Vars): string {
  const hit = DICTS[locale][key] ?? DICTS.en[key] ?? key
  return interpolate(hit, vars)
}

export type TFn = (key: string, vars?: Vars) => string

interface I18n {
  locale: Locale
  dir: 'ltr' | 'rtl'
  t: TFn
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18n | null>(null)

function applyToDocument(locale: Locale) {
  const el = document.documentElement
  el.dir = locale === 'ar' ? 'rtl' : 'ltr'
  el.lang = locale
  setMoneyLocale(locale)
}

// Apply before first render so money formatting and direction are right from the first paint.
applyToDocument(getLocale())

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getLocale)

  useEffect(() => {
    applyToDocument(locale)
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    setLocalePref(next)
    setLocaleState(next)
  }, [])

  const t = useCallback<TFn>((key, vars) => translate(locale, key, vars), [locale])

  const value = useMemo<I18n>(() => ({ locale, dir: locale === 'ar' ? 'rtl' : 'ltr', t, setLocale }), [locale, t, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider')
  return ctx
}

export function useT(): TFn {
  return useI18n().t
}

/** Intl locale tag for dates: Gregorian calendar and Western digits in Arabic too. */
export function dateLocaleTag(locale: Locale): string {
  return locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB'
}

/** Small EN | ع switch. */
export function LanguageSwitch({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n()
  const btn = (value: Locale, label: string) => (
    <button
      type="button"
      onClick={() => setLocale(value)}
      aria-pressed={locale === value}
      className={`rounded-pill px-3 py-1 text-xs font-semibold transition-colors ${locale === value ? 'bg-brand-light text-brand' : 'text-neutral-600 hover:bg-lavender'}`}
    >
      {label}
    </button>
  )
  return (
    <div className={`inline-flex rounded-pill border border-line bg-white p-0.5 ${className}`} role="group" aria-label="Language">
      {btn('en', 'EN')}
      {btn('ar', 'ع')}
    </div>
  )
}

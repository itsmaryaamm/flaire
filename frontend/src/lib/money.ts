import type { Locale } from './prefs'

/** The locale money is rendered in. Set by the i18n provider; defaults to English before it mounts. */
let currentLocale: Locale = 'en'

export function setMoneyLocale(locale: Locale) {
  currentLocale = locale
}

export function moneyLocale(): Locale {
  return currentLocale
}

const AR_SUFFIX = 'ر.س'

function arabicNumber(value: number, opts: Intl.NumberFormatOptions): string {
  // ar-SA with Western (latn) digits, currency parts stripped so the riyal mark can sit after the number.
  const parts = new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', numberingSystem: 'latn', ...opts }).formatToParts(value)
  return parts
    .filter((p) => p.type !== 'currency' && p.type !== 'literal')
    .map((p) => (p.type === 'compact' ? ` ${p.value}` : p.value))
    .join('')
    .trim()
}

/** Formats integer halalas as "SAR 1,234.50" (en) or "1,234.50 ر.س" (ar). */
export function sar(halalas: number | null | undefined, opts?: { compact?: boolean }): string {
  const value = (halalas ?? 0) / 100
  const compact = !!opts?.compact && Math.abs(value) >= 10_000
  if (currentLocale === 'ar') {
    const n = compact
      ? arabicNumber(value, { notation: 'compact', maximumFractionDigits: 1 })
      : arabicNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return `${n} ${AR_SUFFIX}`
  }
  if (compact) {
    return `SAR ${new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
  }
  return `SAR ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

/** Formats halalas as a plain number string without the currency, e.g. "1,234.50". Western digits in both languages. */
export function sarNumber(halalas: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((halalas ?? 0) / 100)
}

/** Converts a SAR string typed by a user ("1,234.5", "SAR 500", "500 ر.س") into integer halalas. */
export function toHalalas(sarString: string | number): number {
  if (typeof sarString === 'number') return Math.round(sarString * 100)
  const cleaned = sarString.replace(/sar/i, '').replace(AR_SUFFIX, '').replace(/[,\s]/g, '').trim()
  if (cleaned === '') return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100)
}

/** Converts halalas into a plain decimal string for input default values, e.g. 150000 -> "1500". */
export function fromHalalas(halalas: number | null | undefined): string {
  const v = (halalas ?? 0) / 100
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0
  return Math.min(100, Math.max(0, Math.round((part / whole) * 100)))
}

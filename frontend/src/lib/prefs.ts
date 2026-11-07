/** Small per-device preferences kept in localStorage. Every access is guarded: storage may be blocked or throw. */

export const PREFER_FULL_KEY = 'flaire:prefer-full'
export const VIEW_MODE_KEY = 'flaire:view-mode'
export const LOCALE_KEY = 'flaire:locale'

export type ViewMode = 'my' | 'admin'
export type Locale = 'en' | 'ar'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // storage unavailable, ignore
  }
}

export function prefersFullDashboard(): boolean {
  return read(PREFER_FULL_KEY) === '1'
}

export function setPreferFullDashboard(on: boolean) {
  write(PREFER_FULL_KEY, on ? '1' : null)
}

/** "My view" or "Admin view" on Home. Defaults to admin for roles that have it; the Layout decides who may use it. */
export function getViewMode(): ViewMode {
  return read(VIEW_MODE_KEY) === 'my' ? 'my' : 'admin'
}

export function setViewMode(mode: ViewMode) {
  write(VIEW_MODE_KEY, mode)
}

export function getLocale(): Locale {
  return read(LOCALE_KEY) === 'ar' ? 'ar' : 'en'
}

export function setLocalePref(locale: Locale) {
  write(LOCALE_KEY, locale)
}

/** Phone-sized viewport (below Tailwind's sm breakpoint). */
export function isNarrowViewport(): boolean {
  try {
    return window.innerWidth < 640
  } catch {
    return false
  }
}
